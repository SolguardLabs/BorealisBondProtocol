import test from "node:test";
import assert from "node:assert/strict";
import { WAD, days } from "../../src/index.js";
import { AMOUNTS, freshScenario } from "../helpers/scenario.js";

test("keeper price updates invalidate stale quotes", () => {
    const { protocol, actors, markets } = freshScenario();
    const quote = protocol.quote(actors.alice, markets.primary, AMOUNTS.smallBuy);

    protocol.updateMarketPrice(actors.keeper, markets.primary, (WAD * 105n) / 100n);

    assert.throws(
        () =>
            protocol.buy({
                buyer: actors.alice,
                market: markets.primary,
                reserveIn: AMOUNTS.smallBuy,
                quote,
            }),
        /quote index is stale/,
    );
});

test("claims continue across a routine price update", () => {
    const { protocol, actors, assets, markets } = freshScenario();
    const receipt = protocol.buy({
        buyer: actors.alice,
        market: markets.primary,
        reserveIn: AMOUNTS.smallBuy,
    });

    protocol.advance(days(2));
    const first = protocol.claim(actors.alice, receipt.position);
    protocol.updateMarketPrice(actors.keeper, markets.primary, (WAD * 101n) / 100n);
    protocol.advance(days(1));
    const second = protocol.claim(actors.alice, receipt.position);

    assert.ok(first.paid > 0n);
    assert.ok(second.paid > 0n);
    assert.equal(protocol.walletBalance(actors.alice, assets.boreal), first.paid + second.paid);
});
