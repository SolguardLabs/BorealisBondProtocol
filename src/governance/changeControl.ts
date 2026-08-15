import { sign as cryptoSign, verify as cryptoVerify, type KeyLike } from "node:crypto";

import type { AccountRegistry, AccountRole } from "../domain/accounts.js";
import { canonicalDigest, canonicalJson } from "../shared/canonical.js";
import { assertProtocol, fail } from "../shared/errors.js";
import type { AccountId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";

export type ChangeDecision = "approve" | "cancel";
export type ChangeState = "waiting" | "ready" | "executed" | "cancelled" | "expired";

export interface ChangeRequest {
    readonly id: string;
    readonly target: string;
    readonly action: string;
    readonly parametersDigest: string;
    readonly proposer: AccountId;
    readonly proposedAt: Timestamp;
    readonly readyAt: Timestamp;
    readonly expiresAt: Timestamp;
    readonly nonce: bigint;
    readonly predecessor?: string;
}

export interface WeightedApproval {
    readonly reviewer: AccountId;
    readonly decision: ChangeDecision;
    readonly weight: bigint;
    readonly signature: string;
}

export interface ChangeRecord {
    readonly request: ChangeRequest;
    readonly proposerSignature: string;
    readonly approvals: readonly WeightedApproval[];
    readonly cancellations: readonly WeightedApproval[];
    readonly executed: boolean;
    readonly cancelled: boolean;
}

export interface ChangeSnapshot {
    readonly id: string;
    readonly target: string;
    readonly action: string;
    readonly state: ChangeState;
    readonly predecessor: string;
    readonly proposedAt: Timestamp;
    readonly readyAt: Timestamp;
    readonly expiresAt: Timestamp;
    readonly nonce: bigint;
    readonly approvalWeight: bigint;
    readonly cancellationWeight: bigint;
    readonly digest: string;
}

export interface ChangeControlReport {
    readonly at: Timestamp;
    readonly approvalQuorum: bigint;
    readonly cancellationQuorum: bigint;
    readonly changes: readonly ChangeSnapshot[];
    readonly digest: string;
}

export interface SignatureVerifier {
    verify(signer: AccountId, payload: string, signature: string): boolean;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,95}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const REVIEWER_ROLES = new Set<AccountRole>(["admin", "auditor", "governance"]);

export class Ed25519Keyring implements SignatureVerifier {
    private readonly publicKeys = new Map<AccountId, KeyLike>();

    register(signer: AccountId, publicKey: KeyLike): void {
        assertProtocol(!this.publicKeys.has(signer), "VALIDATION_FAILED", "signer key exists", {
            signer,
        });
        this.publicKeys.set(signer, publicKey);
    }

    verify(signer: AccountId, payload: string, signature: string): boolean {
        const key = this.publicKeys.get(signer);
        if (key === undefined || !/^[A-Za-z0-9_-]+$/.test(signature)) {
            return false;
        }
        try {
            return cryptoVerify(
                null,
                Buffer.from(payload, "utf8"),
                key,
                Buffer.from(signature, "base64url"),
            );
        } catch {
            return false;
        }
    }
}

export function signEd25519(privateKey: KeyLike, payload: string): string {
    return cryptoSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
}

export function changeRequestPayload(request: ChangeRequest): string {
    return canonicalJson({
        domain: "borealis-change-request-v1",
        id: request.id,
        target: request.target,
        action: request.action,
        parametersDigest: request.parametersDigest,
        proposer: request.proposer,
        proposedAt: request.proposedAt,
        readyAt: request.readyAt,
        expiresAt: request.expiresAt,
        nonce: request.nonce,
        predecessor: request.predecessor ?? "",
    });
}

export function changeDigest(request: ChangeRequest): string {
    return canonicalDigest({
        domain: "borealis-change-digest-v1",
        payload: changeRequestPayload(request),
    });
}

export function changeVotePayload(
    request: ChangeRequest,
    reviewer: AccountId,
    decision: ChangeDecision,
): string {
    return canonicalJson({
        domain: "borealis-change-vote-v1",
        change: changeDigest(request),
        reviewer,
        decision,
    });
}

function weightOf(votes: readonly WeightedApproval[]): bigint {
    return votes.reduce((total, vote) => total + vote.weight, 0n);
}

function validateRequest(request: ChangeRequest): void {
    assertProtocol(IDENTIFIER.test(request.id), "VALIDATION_FAILED", "change id is invalid");
    assertProtocol(
        IDENTIFIER.test(request.target),
        "VALIDATION_FAILED",
        "change target is invalid",
    );
    assertProtocol(
        IDENTIFIER.test(request.action),
        "VALIDATION_FAILED",
        "change action is invalid",
    );
    assertProtocol(
        DIGEST.test(request.parametersDigest),
        "VALIDATION_FAILED",
        "parameters digest is invalid",
    );
    assertProtocol(request.nonce > 0n, "VALIDATION_FAILED", "change nonce is required");
    assertProtocol(
        request.readyAt > request.proposedAt && request.expiresAt > request.readyAt,
        "VALIDATION_FAILED",
        "change window is invalid",
    );
    if (request.predecessor !== undefined) {
        assertProtocol(
            IDENTIFIER.test(request.predecessor),
            "VALIDATION_FAILED",
            "predecessor is invalid",
        );
        assertProtocol(
            request.predecessor !== request.id,
            "VALIDATION_FAILED",
            "change cannot precede itself",
        );
    }
}

export class ChangeControl {
    private readonly reviewerWeights = new Map<AccountId, bigint>();
    private readonly records = new Map<string, ChangeRecord>();
    private readonly proposerNonces = new Set<string>();

    constructor(
        private readonly accounts: AccountRegistry,
        private readonly signatures: SignatureVerifier,
        readonly approvalQuorum: bigint,
        readonly cancellationQuorum: bigint,
    ) {
        assertProtocol(approvalQuorum > 0n, "INVALID_CONFIGURATION", "approval quorum is required");
        assertProtocol(
            cancellationQuorum > 0n,
            "INVALID_CONFIGURATION",
            "cancellation quorum is required",
        );
    }

    configureReviewer(reviewer: AccountId, weight: bigint): void {
        const account = this.accounts.get(reviewer);
        assertProtocol(!account.blocked, "AUTHORIZATION_FAILED", "reviewer is blocked", {
            reviewer,
        });
        assertProtocol(
            account.roles.some((role) => REVIEWER_ROLES.has(role)),
            "AUTHORIZATION_FAILED",
            "reviewer role is not allowed",
            { reviewer },
        );
        assertProtocol(weight > 0n && weight <= 100n, "VALIDATION_FAILED", "weight outside range", {
            reviewer,
            weight,
        });
        this.reviewerWeights.set(reviewer, weight);
    }

    schedule(request: ChangeRequest, proposerSignature: string): ChangeRecord {
        validateRequest(request);
        assertProtocol(
            !this.records.has(request.id),
            "VALIDATION_FAILED",
            "change already exists",
            {
                change: request.id,
            },
        );
        const proposer = this.accounts.get(request.proposer);
        assertProtocol(!proposer.blocked, "AUTHORIZATION_FAILED", "proposer is blocked");
        assertProtocol(
            proposer.roles.includes("governance") || proposer.roles.includes("admin"),
            "AUTHORIZATION_FAILED",
            "proposer role is not allowed",
        );
        const nonceKey = `${request.proposer}:${request.nonce.toString()}`;
        assertProtocol(
            !this.proposerNonces.has(nonceKey),
            "AUTHORIZATION_FAILED",
            "proposer nonce already used",
        );
        assertProtocol(
            this.signatures.verify(
                request.proposer,
                changeRequestPayload(request),
                proposerSignature,
            ),
            "AUTHORIZATION_FAILED",
            "proposer signature is invalid",
        );
        const record = Object.freeze({
            request: Object.freeze({ ...request }),
            proposerSignature,
            approvals: Object.freeze([]),
            cancellations: Object.freeze([]),
            executed: false,
            cancelled: false,
        });
        this.proposerNonces.add(nonceKey);
        this.records.set(request.id, record);
        return record;
    }

    vote(
        changeId: string,
        reviewer: AccountId,
        decision: ChangeDecision,
        signature: string,
    ): ChangeRecord {
        const current = this.get(changeId);
        assertProtocol(
            !current.executed && !current.cancelled,
            "VALIDATION_FAILED",
            "change is final",
        );
        const weight = this.reviewerWeights.get(reviewer);
        assertProtocol(weight !== undefined, "AUTHORIZATION_FAILED", "reviewer is not configured", {
            reviewer,
        });
        const account = this.accounts.get(reviewer);
        assertProtocol(!account.blocked, "AUTHORIZATION_FAILED", "reviewer is blocked", {
            reviewer,
        });
        const existing = decision === "approve" ? current.approvals : current.cancellations;
        assertProtocol(
            !existing.some((vote) => vote.reviewer === reviewer),
            "AUTHORIZATION_FAILED",
            "reviewer vote already recorded",
            { reviewer, decision },
        );
        assertProtocol(
            this.signatures.verify(
                reviewer,
                changeVotePayload(current.request, reviewer, decision),
                signature,
            ),
            "AUTHORIZATION_FAILED",
            "reviewer signature is invalid",
        );
        const vote = Object.freeze({ reviewer, decision, weight, signature });
        const approvals =
            decision === "approve"
                ? Object.freeze([...current.approvals, vote])
                : current.approvals;
        const cancellations =
            decision === "cancel"
                ? Object.freeze([...current.cancellations, vote])
                : current.cancellations;
        const next = Object.freeze({
            ...current,
            approvals,
            cancellations,
            cancelled: weightOf(cancellations) >= this.cancellationQuorum,
        });
        this.records.set(changeId, next);
        return next;
    }

    execute(changeId: string, now: Timestamp): ChangeRecord {
        const current = this.get(changeId);
        assertProtocol(
            this.state(changeId, now) === "ready",
            "AUTHORIZATION_FAILED",
            "change not ready",
        );
        const next = Object.freeze({ ...current, executed: true });
        this.records.set(changeId, next);
        return next;
    }

    state(changeId: string, now: Timestamp): ChangeState {
        const record = this.get(changeId);
        if (record.executed) return "executed";
        if (record.cancelled) return "cancelled";
        if (now > record.request.expiresAt) return "expired";
        if (
            now >= record.request.readyAt &&
            weightOf(record.approvals) >= this.approvalQuorum &&
            this.predecessorExecuted(record.request)
        ) {
            return "ready";
        }
        return "waiting";
    }

    get(changeId: string): ChangeRecord {
        const record = this.records.get(changeId);
        if (record === undefined) {
            fail("VALIDATION_FAILED", "change does not exist", { change: changeId });
        }
        return record;
    }

    report(now: Timestamp): ChangeControlReport {
        const changes = [...this.records.values()]
            .sort((left, right) => left.request.id.localeCompare(right.request.id))
            .map((record) =>
                Object.freeze({
                    id: record.request.id,
                    target: record.request.target,
                    action: record.request.action,
                    state: this.state(record.request.id, now),
                    predecessor: record.request.predecessor ?? "",
                    proposedAt: record.request.proposedAt,
                    readyAt: record.request.readyAt,
                    expiresAt: record.request.expiresAt,
                    nonce: record.request.nonce,
                    approvalWeight: weightOf(record.approvals),
                    cancellationWeight: weightOf(record.cancellations),
                    digest: changeDigest(record.request),
                }),
            );
        const digest = canonicalDigest({
            domain: "borealis-change-control-report-v1",
            at: now,
            approvalQuorum: this.approvalQuorum,
            cancellationQuorum: this.cancellationQuorum,
            changes: changes.map((change) => ({
                id: change.id,
                state: change.state,
                digest: change.digest,
                approvalWeight: change.approvalWeight,
                cancellationWeight: change.cancellationWeight,
            })),
        });
        return Object.freeze({
            at: now,
            approvalQuorum: this.approvalQuorum,
            cancellationQuorum: this.cancellationQuorum,
            changes: Object.freeze(changes),
            digest,
        });
    }

    private predecessorExecuted(request: ChangeRequest): boolean {
        if (request.predecessor === undefined) return true;
        return this.records.get(request.predecessor)?.executed === true;
    }
}
