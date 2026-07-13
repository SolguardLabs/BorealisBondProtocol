import test from "node:test";
import assert from "node:assert/strict";
import { days } from "../../src/index.js";
import { AMOUNTS, freshScenario } from "../helpers/scenario.js";

test("buyer can cancel unvested bonds and receive reserve refund", () => {
    const { protocol, actors, assets, markets } = freshScenario();
    const initialWallet = protocol.walletBalance(actors.carol, assets.usdc);
    const receipt = protocol.buy({
        buyer: actors.carol,
        market: markets.primary,
        reserveIn: AMOUNTS.smallBuy,
    });

    protocol.advance(days(2));
    const preview = protocol.previewCancellation(actors.carol, receipt.position);
    assert.ok(preview.refundReserve > 0n);
    assert.ok(preview.refundReserve < AMOUNTS.smallBuy);

    const cancelled = protocol.cancel(actors.carol, receipt.position);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.refundReserve, preview.refundReserve);
    assert.equal(
        protocol.walletBalance(actors.carol, assets.usdc),
        initialWallet - AMOUNTS.smallBuy + cancelled.refundReserve,
    );
});

test("cancelled positions cannot be claimed", () => {
    const { protocol, actors, markets } = freshScenario();
    const receipt = protocol.buy({
        buyer: actors.carol,
        market: markets.primary,
        reserveIn: AMOUNTS.smallBuy,
    });

    protocol.advance(days(1));
    protocol.cancel(actors.carol, receipt.position);

    assert.throws(
        () => protocol.claim(actors.carol, receipt.position),
        /position is not claimable/,
    );
});
