import { BPS, mulDiv, mulDivUp, normalizeDecimals, WAD } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import type { AccountId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";
import type { BondQuote, MarketState } from "../domain/bonds.js";
import { applyDiscountToPrice, discountForMarket } from "./discountCurve.js";

export interface QuoteRequest {
    readonly market: MarketState;
    readonly buyer: AccountId;
    readonly reserveIn: bigint;
    readonly now: Timestamp;
    readonly minPayout?: bigint;
    readonly reserveDecimals?: number;
    readonly payoutDecimals?: number;
}

export interface PriceMove {
    readonly oldPrice: bigint;
    readonly newPrice: bigint;
    readonly oldIndex: bigint;
    readonly newIndex: bigint;
}

export function assertMarketOpen(market: MarketState, now: Timestamp): void {
    assertProtocol(market.status === "active", "MARKET_PAUSED", "market is not active", {
        market: market.config.id,
        status: market.status,
    });
    assertProtocol(now >= market.config.openingTime, "INVALID_MARKET_STATE", "market is not open", {
        market: market.config.id,
        now,
        openingTime: market.config.openingTime,
    });
    assertProtocol(now < market.config.closingTime, "INVALID_MARKET_STATE", "market is closed", {
        market: market.config.id,
        now,
        closingTime: market.config.closingTime,
    });
}

export function quoteBond(request: QuoteRequest): BondQuote {
    const { market, reserveIn, now } = request;
    assertMarketOpen(market, now);
    assertProtocol(
        reserveIn >= market.config.limits.minPurchase,
        "VALIDATION_FAILED",
        "below minimum",
        {
            reserveIn,
            minPurchase: market.config.limits.minPurchase,
        },
    );
    assertProtocol(
        reserveIn <= market.config.limits.maxPurchase,
        "VALIDATION_FAILED",
        "above maximum",
        {
            reserveIn,
            maxPurchase: market.config.limits.maxPurchase,
        },
    );
    assertProtocol(
        market.soldReserve + reserveIn <= market.config.limits.capacityReserve,
        "MARKET_CAP_REACHED",
        "reserve capacity reached",
        { market: market.config.id },
    );
    const discount = discountForMarket(market, reserveIn);
    const discountedPrice = applyDiscountToPrice(market.lastPrice, discount.finalDiscountBps);
    const reserveAsPayoutUnits = normalizeDecimals(
        reserveIn,
        request.reserveDecimals ?? 18,
        request.payoutDecimals ?? 18,
    );
    const payoutOut = mulDiv(reserveAsPayoutUnits, WAD, discountedPrice);
    assertProtocol(
        market.soldPayout + payoutOut <= market.config.limits.capacityPayout,
        "MARKET_CAP_REACHED",
        "payout capacity reached",
        { market: market.config.id },
    );
    if (request.minPayout !== undefined) {
        assertProtocol(
            payoutOut >= request.minPayout,
            "SLIPPAGE_LIMIT",
            "quote below requested payout",
            {
                payoutOut,
                minPayout: request.minPayout,
            },
        );
    }
    return Object.freeze({
        market: market.config.id,
        buyer: request.buyer,
        reserveIn,
        payoutOut,
        basePrice: market.lastPrice,
        discountedPrice,
        discountBps: discount.finalDiscountBps,
        priceIndex: market.priceIndex,
        expiresAt: (now + market.config.quoteTtl) as Timestamp,
    });
}

export function validateQuote(
    market: MarketState,
    quote: BondQuote,
    buyer: AccountId,
    reserveIn: bigint,
    now: Timestamp,
): void {
    assertProtocol(quote.market === market.config.id, "VALIDATION_FAILED", "quote market mismatch");
    assertProtocol(quote.buyer === buyer, "AUTHORIZATION_FAILED", "quote buyer mismatch");
    assertProtocol(quote.reserveIn === reserveIn, "VALIDATION_FAILED", "quote amount mismatch", {
        quoted: quote.reserveIn,
        actual: reserveIn,
    });
    assertProtocol(now <= quote.expiresAt, "QUOTE_EXPIRED", "quote expired", {
        now,
        expiresAt: quote.expiresAt,
    });
    assertProtocol(
        quote.priceIndex === market.priceIndex,
        "QUOTE_EXPIRED",
        "quote index is stale",
        {
            quoted: quote.priceIndex,
            current: market.priceIndex,
        },
    );
}

export function computePriceMove(oldPrice: bigint, oldIndex: bigint, newPrice: bigint): PriceMove {
    assertProtocol(oldPrice > 0n && newPrice > 0n, "INVALID_PRICE", "price must be positive", {
        oldPrice,
        newPrice,
    });
    assertProtocol(oldIndex > 0n, "INVALID_PRICE", "index must be positive", { oldIndex });
    const newIndex = mulDivUp(oldIndex, newPrice, oldPrice);
    return Object.freeze({ oldPrice, newPrice, oldIndex, newIndex });
}

export function premiumBps(price: bigint, fairPrice: bigint): bigint {
    assertProtocol(price > 0n && fairPrice > 0n, "INVALID_PRICE", "price must be positive");
    if (price <= fairPrice) {
        return 0n;
    }
    return mulDiv(price - fairPrice, BPS, fairPrice);
}
