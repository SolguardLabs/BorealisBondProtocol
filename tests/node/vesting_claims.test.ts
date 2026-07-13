import test from "node:test";
import assert from "node:assert/strict";
import { days } from "../../src/index.js";
import { AMOUNTS, assertClose, freshScenario } from "../helpers/scenario.js";

test("linear vesting releases proportional payout over the schedule", () => {
    const { protocol, actors, assets, markets } = freshScenario();
    const receipt = protocol.buy({
        buyer: actors.alice,
        market: markets.primary,
        reserveIn: AMOUNTS.smallBuy,
    });

    protocol.advance(days(1));
    const dayOnePreview = protocol.previewClaim(actors.alice, receipt.position);
    assertClose(dayOnePreview.claimable, receipt.payoutOut / 7n, AMOUNTS.claimTolerance);

    const firstClaim = protocol.claim(actors.alice, receipt.position);
    assert.equal(firstClaim.status, "vesting");
    assert.equal(protocol.walletBalance(actors.alice, assets.boreal), firstClaim.paid);

    protocol.advance(days(6));
    const finalClaim = protocol.claim(actors.alice, receipt.position);
    assert.equal(finalClaim.status, "claimed");
    assertClose(
        protocol.walletBalance(actors.alice, assets.boreal),
        receipt.payoutOut,
        AMOUNTS.claimTolerance,
    );
});

test("partial claims respect caller supplied max amount", () => {
    const { protocol, actors, assets, markets } = freshScenario();
    const receipt = protocol.buy({
        buyer: actors.bob,
        market: markets.primary,
        reserveIn: AMOUNTS.deskBuy,
    });

    protocol.advance(days(4));
    const preview = protocol.previewClaim(actors.bob, receipt.position);
    const requested = preview.claimable / 3n;
    const first = protocol.claim(actors.bob, receipt.position, requested);

    assert.equal(first.paid, requested);
    assert.equal(protocol.walletBalance(actors.bob, assets.boreal), requested);
    assert.ok(protocol.previewClaim(actors.bob, receipt.position).claimable > 0n);
});
