import assert from "node:assert/strict";
import {
    BPS,
    WAD,
    boreal,
    setupStandardScenario,
    usdc,
    type StandardScenario,
} from "../../src/index.js";

export function freshScenario(): StandardScenario {
    return setupStandardScenario();
}

export function assertClose(actual: bigint, expected: bigint, tolerance: bigint): void {
    const delta = actual > expected ? actual - expected : expected - actual;
    assert.ok(delta <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

export function expectedPayout(
    reserveIn: bigint,
    discountBps: bigint,
    reserveDecimals = 6,
): bigint {
    const reserveAsPayoutUnits = reserveIn * 10n ** BigInt(18 - reserveDecimals);
    const discountedPrice = (WAD * (BPS - discountBps)) / BPS;
    return (reserveAsPayoutUnits * WAD) / discountedPrice;
}

export const AMOUNTS = Object.freeze({
    smallBuy: usdc("1000"),
    deskBuy: usdc("25000"),
    strategicBuy: usdc("100000"),
    claimTolerance: boreal("0.000001"),
});
