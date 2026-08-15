import { generateKeyPairSync, type KeyObject } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import {
    ChangeControl,
    Ed25519Keyring,
    canonicalDigest,
    changeRequestPayload,
    changeVotePayload,
    signEd25519,
    timestamp,
    type AccountId,
    type ChangeRequest,
} from "../../src/index.js";
import { freshScenario } from "../helpers/scenario.js";

function setupControl() {
    const { protocol, actors, markets } = freshScenario();
    const signers = new Map<AccountId, KeyObject>();
    const keyring = new Ed25519Keyring();
    for (const account of [actors.governance, actors.keeper, actors.treasury]) {
        const pair = generateKeyPairSync("ed25519");
        signers.set(account, pair.privateKey);
        keyring.register(account, pair.publicKey);
    }
    const control = new ChangeControl(protocol.accounts, keyring, 70n, 60n);
    control.configureReviewer(actors.governance, 40n);
    control.configureReviewer(actors.keeper, 30n);
    control.configureReviewer(actors.treasury, 30n);
    const request: ChangeRequest = Object.freeze({
        id: "change:primary:limits:42",
        target: markets.primary,
        action: "update-risk-limits",
        parametersDigest: canonicalDigest({ maxDiscountBps: 2_000n, maxPurchase: 200_000n }),
        proposer: actors.governance,
        proposedAt: timestamp(1n),
        readyAt: timestamp(3n),
        expiresAt: timestamp(10n),
        nonce: 42n,
    });
    const sign = (account: AccountId, payload: string): string => {
        const privateKey = signers.get(account);
        assert.ok(privateKey !== undefined);
        return signEd25519(privateKey, payload);
    };
    return { protocol, actors, control, request, sign };
}

test("signed change reaches readiness only after quorum and delay", () => {
    const { actors, control, request, sign } = setupControl();
    control.schedule(request, sign(request.proposer, changeRequestPayload(request)));
    control.vote(
        request.id,
        actors.governance,
        "approve",
        sign(actors.governance, changeVotePayload(request, actors.governance, "approve")),
    );
    control.vote(
        request.id,
        actors.keeper,
        "approve",
        sign(actors.keeper, changeVotePayload(request, actors.keeper, "approve")),
    );

    assert.equal(control.state(request.id, timestamp(2n)), "waiting");
    assert.equal(control.state(request.id, timestamp(3n)), "ready");
    control.execute(request.id, timestamp(3n));
    assert.equal(control.state(request.id, timestamp(3n)), "executed");
});

test("change report retains weights and deterministic evidence", () => {
    const { actors, control, request, sign } = setupControl();
    control.schedule(request, sign(request.proposer, changeRequestPayload(request)));
    for (const reviewer of [actors.governance, actors.keeper]) {
        control.vote(
            request.id,
            reviewer,
            "approve",
            sign(reviewer, changeVotePayload(request, reviewer, "approve")),
        );
    }
    const first = control.report(timestamp(3n));
    const second = control.report(timestamp(3n));

    assert.equal(first.changes[0]?.approvalWeight, 70n);
    assert.equal(first.changes[0]?.cancellationWeight, 0n);
    assert.equal(first.changes[0]?.state, "ready");
    assert.equal(first.digest, second.digest);
    assert.equal(first.digest.length, 64);
});

test("cancellation quorum finalizes a pending change", () => {
    const { actors, control, request, sign } = setupControl();
    control.schedule(request, sign(request.proposer, changeRequestPayload(request)));
    for (const reviewer of [actors.keeper, actors.treasury]) {
        control.vote(
            request.id,
            reviewer,
            "cancel",
            sign(reviewer, changeVotePayload(request, reviewer, "cancel")),
        );
    }
    assert.equal(control.state(request.id, timestamp(2n)), "cancelled");
    assert.throws(() => control.execute(request.id, timestamp(3n)), /change not ready/);
});

test("change control rejects duplicate votes and proposer nonce replay", () => {
    const { actors, control, request, sign } = setupControl();
    control.schedule(request, sign(request.proposer, changeRequestPayload(request)));
    const signature = sign(
        actors.governance,
        changeVotePayload(request, actors.governance, "approve"),
    );
    control.vote(request.id, actors.governance, "approve", signature);
    assert.throws(
        () => control.vote(request.id, actors.governance, "approve", signature),
        /reviewer vote already recorded/,
    );

    const replay = Object.freeze({ ...request, id: "change:primary:limits:43" });
    assert.throws(
        () => control.schedule(replay, sign(replay.proposer, changeRequestPayload(replay))),
        /proposer nonce already used/,
    );
});

test("change control rejects signatures bound to another decision", () => {
    const { actors, control, request, sign } = setupControl();
    control.schedule(request, sign(request.proposer, changeRequestPayload(request)));
    const approval = sign(actors.keeper, changeVotePayload(request, actors.keeper, "approve"));
    assert.throws(
        () => control.vote(request.id, actors.keeper, "cancel", approval),
        /reviewer signature is invalid/,
    );
});
