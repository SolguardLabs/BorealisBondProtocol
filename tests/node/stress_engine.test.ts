import test from "node:test";
import assert from "node:assert/strict";

import {
    BondStressEngine,
    boreal,
    days,
    timestamp,
    type LiabilityBucket,
    type LiquiditySource,
} from "../../src/index.js";
import { freshScenario } from "../helpers/scenario.js";

function inputs() {
    const { assets, markets } = freshScenario();
    const sources: LiquiditySource[] = [
        {
            id: "emission:cash",
            asset: assets.boreal,
            amount: boreal("800000"),
            availableAt: timestamp(0n),
            recoveryBps: 10_000n,
            haircutBps: 0n,
        },
        {
            id: "emission:reserve",
            asset: assets.boreal,
            amount: boreal("400000"),
            availableAt: timestamp(days(2)),
            recoveryBps: 9_000n,
            haircutBps: 1_000n,
        },
        {
            id: "market:receivable",
            asset: assets.boreal,
            amount: boreal("300000"),
            availableAt: timestamp(days(12)),
            recoveryBps: 8_000n,
            haircutBps: 1_500n,
        },
    ];
    const liabilities: LiabilityBucket[] = [
        {
            id: "bond:institutional",
            market: markets.institutional,
            asset: assets.boreal,
            amount: boreal("300000"),
            dueAt: timestamp(days(8)),
            probabilityBps: 9_000n,
            stressBps: 1_000n,
        },
        {
            id: "bond:primary",
            market: markets.primary,
            asset: assets.boreal,
            amount: boreal("600000"),
            dueAt: timestamp(days(5)),
            probabilityBps: 10_000n,
            stressBps: 2_000n,
        },
        {
            id: "bond:short",
            market: markets.short,
            asset: assets.boreal,
            amount: boreal("100000"),
            dueAt: timestamp(days(12)),
            probabilityBps: 10_000n,
            stressBps: 2_500n,
        },
    ];
    return { assets, sources, liabilities };
}

test("stress engine calculates recovery, haircuts and maturity coverage", () => {
    const { assets, sources, liabilities } = inputs();
    const report = new BondStressEngine().evaluate(
        assets.boreal,
        timestamp(0n),
        timestamp(days(10)),
        sources,
        liabilities,
        {
            minCoverageBps: 11_000n,
            maxShortfall: 0n,
            maxMarketShareBps: 7_100n,
            maxMarketHhiBps: 6_000n,
        },
    );

    assert.equal(report.totalSource, boreal("1124000"));
    assert.equal(report.totalStressedOutflow, boreal("1020000"));
    assert.equal(report.surplus, boreal("104000"));
    assert.equal(report.shortfall, 0n);
    assert.equal(report.coverageBps, 11_019n);
    assert.equal(report.weightedMaturitySeconds, 508_235n);
    assert.equal(report.withinLimits, true);
    assert.equal(report.digest.length, 64);
});

test("stress engine reports market concentration with integer floor semantics", () => {
    const { assets, sources, liabilities } = inputs();
    const report = new BondStressEngine().evaluate(
        assets.boreal,
        timestamp(0n),
        timestamp(days(10)),
        sources,
        liabilities,
        {
            minCoverageBps: 10_000n,
            maxShortfall: 0n,
            maxMarketShareBps: 10_000n,
            maxMarketHhiBps: 10_000n,
        },
    );

    assert.deepEqual(
        report.markets.map((market) => [market.market, market.shareBps]),
        [
            ["BRL-DAI-INST", 2_941n],
            ["BRL-USDC-2D", 0n],
            ["BRL-USDC-7D", 7_058n],
        ],
    );
    assert.equal(report.largestMarketShareBps, 7_058n);
    assert.equal(report.marketHhiBps, 5_845n);
});

test("stress engine excludes resources and liabilities beyond the horizon", () => {
    const { assets, sources, liabilities } = inputs();
    const report = new BondStressEngine().evaluate(
        assets.boreal,
        timestamp(0n),
        timestamp(days(10)),
        sources,
        liabilities,
        {
            minCoverageBps: 11_000n,
            maxShortfall: 0n,
            maxMarketShareBps: 7_100n,
            maxMarketHhiBps: 6_000n,
        },
    );

    assert.equal(report.sources[2]?.availableWithinHorizon, false);
    assert.equal(report.sources[2]?.effective, 0n);
    assert.equal(report.liabilities[2]?.dueWithinHorizon, false);
    assert.equal(report.liabilities[2]?.stressed, 0n);
});

test("stress engine rejects non-canonical input order", () => {
    const { assets, sources, liabilities } = inputs();
    assert.throws(
        () =>
            new BondStressEngine().evaluate(
                assets.boreal,
                timestamp(0n),
                timestamp(days(10)),
                [...sources].reverse(),
                liabilities,
                {
                    minCoverageBps: 10_000n,
                    maxShortfall: 0n,
                    maxMarketShareBps: 10_000n,
                    maxMarketHhiBps: 10_000n,
                },
            ),
        /source order is not canonical/,
    );
});
