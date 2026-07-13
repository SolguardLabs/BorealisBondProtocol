import test from "node:test";
import assert from "node:assert/strict";
import { AMOUNTS, expectedPayout, freshScenario } from "../helpers/scenario.js";

test("quotes reserve bonds with configured size discounts", () => {
    const { protocol, actors, markets } = freshScenario();

    const retail = protocol.quote(actors.alice, markets.primary, AMOUNTS.smallBuy);
    const desk = protocol.quote(actors.alice, markets.primary, AMOUNTS.deskBuy);
    const strategic = protocol.quote(actors.alice, markets.primary, AMOUNTS.strategicBuy);

    assert.equal(retail.discountBps, 300n);
    assert.equal(desk.discountBps, 600n);
    assert.equal(strategic.discountBps, 900n);
    assert.equal(retail.payoutOut, expectedPayout(AMOUNTS.smallBuy, 300n));
    assert.equal(desk.payoutOut, expectedPayout(AMOUNTS.deskBuy, 600n));
    assert.equal(strategic.payoutOut, expectedPayout(AMOUNTS.strategicBuy, 900n));
});

test("purchase moves reserve into treasury and opens a vesting position", () => {
    const { protocol, actors, assets, markets } = freshScenario();
    const quote = protocol.quote(actors.alice, markets.primary, AMOUNTS.smallBuy);
    const beforeWallet = protocol.walletBalance(actors.alice, assets.usdc);
    const beforeReserve = protocol.reserveBalance(assets.usdc);

    const receipt = protocol.buy({
        buyer: actors.alice,
        market: markets.primary,
        reserveIn: AMOUNTS.smallBuy,
        quote,
    });

    assert.equal(receipt.payoutOut, quote.payoutOut);
    assert.equal(
        protocol.walletBalance(actors.alice, assets.usdc),
        beforeWallet - AMOUNTS.smallBuy,
    );
    assert.equal(protocol.reserveBalance(assets.usdc), beforeReserve + AMOUNTS.smallBuy);

    const report = protocol.accountReport(actors.alice);
    assert.equal(report.positions.length, 1);
    assert.equal(report.positions[0]?.status, "vesting");
});
