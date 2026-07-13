import { BPS, clamp, mulDiv } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import type { DiscountBand, MarketLimits, MarketState } from "../domain/bonds.js";

export interface DiscountContext {
    readonly reserveIn: bigint;
    readonly soldReserve: bigint;
    readonly soldPayout: bigint;
    readonly limits: MarketLimits;
}

export interface DiscountResult {
    readonly band: DiscountBand;
    readonly utilizationBps: bigint;
    readonly sizeDiscountBps: bigint;
    readonly utilizationAdjustmentBps: bigint;
    readonly finalDiscountBps: bigint;
}

export function normalizeBands(bands: readonly DiscountBand[]): readonly DiscountBand[] {
    assertProtocol(
        bands.length > 0,
        "INVALID_DISCOUNT",
        "discount curve requires at least one band",
    );
    const sorted = [...bands].sort((a, b) => (a.minReserveIn < b.minReserveIn ? -1 : 1));
    let previous = -1n;
    for (const band of sorted) {
        assertProtocol(
            band.minReserveIn > previous,
            "INVALID_DISCOUNT",
            "bands must be increasing",
            {
                minReserveIn: band.minReserveIn,
            },
        );
        assertProtocol(
            band.discountBps >= 0n && band.discountBps <= 10_000n,
            "INVALID_DISCOUNT",
            "discount out of range",
            { discountBps: band.discountBps },
        );
        previous = band.minReserveIn;
    }
    assertProtocol(
        sorted[0]?.minReserveIn === 0n,
        "INVALID_DISCOUNT",
        "first band must start at zero",
    );
    return Object.freeze(sorted.map((band) => Object.freeze({ ...band })));
}

export function selectBand(bands: readonly DiscountBand[], reserveIn: bigint): DiscountBand {
    let selected = bands[0];
    assertProtocol(selected !== undefined, "INVALID_DISCOUNT", "empty discount curve");
    for (const band of bands) {
        if (reserveIn >= band.minReserveIn) {
            selected = band;
        }
    }
    return selected;
}

export function utilizationBps(soldReserve: bigint, reserveIn: bigint, capacity: bigint): bigint {
    assertProtocol(capacity > 0n, "INVALID_CONFIGURATION", "capacity must be positive", {
        capacity,
    });
    return clamp(mulDiv(soldReserve + reserveIn, BPS, capacity), 0n, BPS);
}

export function calculateDiscount(
    context: DiscountContext,
    bands: readonly DiscountBand[],
): DiscountResult {
    const normalized = normalizeBands(bands);
    const band = selectBand(normalized, context.reserveIn);
    const used = utilizationBps(
        context.soldReserve,
        context.reserveIn,
        context.limits.capacityReserve,
    );
    const utilizationAdjustmentBps = used > 8_000n ? (used - 8_000n) / 5n : 0n;
    const cappedDiscount =
        band.discountBps > utilizationAdjustmentBps
            ? band.discountBps - utilizationAdjustmentBps
            : 0n;
    const finalDiscountBps = clamp(cappedDiscount, 0n, context.limits.maxDiscountBps);
    return Object.freeze({
        band,
        utilizationBps: used,
        sizeDiscountBps: band.discountBps,
        utilizationAdjustmentBps,
        finalDiscountBps,
    });
}

export function discountForMarket(market: MarketState, reserveIn: bigint): DiscountResult {
    return calculateDiscount(
        {
            reserveIn,
            soldReserve: market.soldReserve,
            soldPayout: market.soldPayout,
            limits: market.config.limits,
        },
        market.config.discountBands,
    );
}

export function applyDiscountToPrice(price: bigint, discountBps: bigint): bigint {
    assertProtocol(discountBps >= 0n && discountBps <= BPS, "INVALID_DISCOUNT", "bad discount", {
        discountBps,
    });
    return mulDiv(price, BPS - discountBps, BPS);
}
