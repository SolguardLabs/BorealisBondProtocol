import test from "node:test";
import assert from "node:assert/strict";

import {
    BorealisClient,
    BorealisClientError,
    atomic,
    deriveIdempotencyKey,
    quotePayout,
    vestingPreview,
    type BorealisTransport,
    type TransportRequest,
} from "./BorealisClient.js";

class StubTransport implements BorealisTransport {
    readonly requests: TransportRequest[] = [];

    async execute<T>(request: TransportRequest): Promise<T> {
        this.requests.push(request);
        if (request.path === "/v1/health") {
            return {
                status: "ok",
                version: "1.0.0",
                network: "borealis-mainnet",
                stateDigest: "a".repeat(64),
            } as T;
        }
        if (request.path === "/v1/bonds/quote") {
            const body = request.body as { buyer: string; market: string; reserveIn: string };
            return {
                market: body.market,
                buyer: body.buyer,
                reserveIn: body.reserveIn,
                payoutOut: "1030927835051546391752",
                discountedPrice: "970000000000000000",
                discountBps: "300",
                priceIndex: "1000000000000000000",
                expiresAt: "300",
            } as T;
        }
        if (request.path === "/v1/bonds") {
            return {
                position: "pos:BRL-USDC-7D:alice:1",
                reserveIn: "1000000000",
                payoutOut: "1030927835051546391752",
                discountBps: "300",
                startsAt: "0",
                endsAt: "604800",
            } as T;
        }
        throw new Error(`unexpected path ${request.path}`);
    }
}

test("client validates health before returning protocol state", async () => {
    const transport = new StubTransport();
    const health = await new BorealisClient(transport).requireHealthy();
    assert.equal(health.version, "1.0.0");
    assert.equal(health.stateDigest.length, 64);
    assert.deepEqual(transport.requests[0], { method: "GET", path: "/v1/health" });
});

test("client binds purchase to a validated quote and idempotency key", async () => {
    const transport = new StubTransport();
    const client = new BorealisClient(transport);
    const purchase = await client.purchase(
        { buyer: "alice", market: "BRL-USDC-7D", reserveIn: "1000000000" },
        "purchase:alice:00000001",
    );
    assert.equal(purchase.position, "pos:BRL-USDC-7D:alice:1");
    assert.equal(transport.requests.length, 2);
    assert.equal(transport.requests[1]?.idempotencyKey, "purchase:alice:00000001");
});

test("quote math preserves bigint precision across asset decimals", () => {
    assert.equal(
        quotePayout("1000000000", 6, 18, "1000000000000000000", "300"),
        "1030927835051546391752",
    );
});

test("vesting preview applies deterministic integer floor", () => {
    assert.deepEqual(vestingPreview("700", "100", 0n, 700n, 350n), {
        vested: "350",
        claimable: "250",
        complete: false,
    });
    assert.deepEqual(vestingPreview("700", "700", 0n, 700n, 700n), {
        vested: "700",
        claimable: "0",
        complete: true,
    });
});

test("atomic rejects unsafe numeric values", () => {
    assert.throws(() => atomic(Number.MAX_VALUE), BorealisClientError);
    assert.throws(() => atomic("01"), /atomic amount/);
    assert.equal(atomic(42n), "42");
});

test("idempotency derivation is deterministic and intent-bound", () => {
    const first = deriveIdempotencyKey("purchase", { buyer: "alice", reserveIn: "100" });
    const second = deriveIdempotencyKey("purchase", { buyer: "alice", reserveIn: "100" });
    const different = deriveIdempotencyKey("purchase", { buyer: "alice", reserveIn: "101" });
    assert.equal(first, second);
    assert.notEqual(first, different);
    assert.match(first, /^purchase:[a-f0-9]{64}$/);
});

test("client rejects malformed identifiers before transport", async () => {
    const transport = new StubTransport();
    const client = new BorealisClient(transport);
    await assert.rejects(
        () => client.quote({ buyer: "../alice", market: "BRL-USDC-7D", reserveIn: "100" }),
        /buyer is invalid/,
    );
    assert.equal(transport.requests.length, 0);
});

test("client fails closed on malformed response shape", async () => {
    const client = new BorealisClient({
        async execute<T>(): Promise<T> {
            return { status: "ok", version: "1.0.0" } as T;
        },
    });
    await assert.rejects(() => client.health(), /network/);
});
