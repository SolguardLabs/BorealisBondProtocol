import { BPS, WAD } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import type { MarketConfig, MarketLimits } from "../domain/bonds.js";
import { normalizeBands } from "../pricing/discountCurve.js";

export interface PurchasePolicy {
    readonly allowBlockedAccounts: boolean;
    readonly maxRiskTier: number;
    readonly minQuoteTtl: bigint;
    readonly maxQuoteTtl: bigint;
}

export const DEFAULT_PURCHASE_POLICY: PurchasePolicy = Object.freeze({
    allowBlockedAccounts: false,
    maxRiskTier: 5,
    minQuoteTtl: 15n,
    maxQuoteTtl: 3_600n,
});

export function validateLimits(limits: MarketLimits): void {
    assertProtocol(
        limits.minPurchase > 0n,
        "INVALID_CONFIGURATION",
        "min purchase must be positive",
    );
    assertProtocol(
        limits.maxPurchase >= limits.minPurchase,
        "INVALID_CONFIGURATION",
        "max purchase below min",
        { minPurchase: limits.minPurchase, maxPurchase: limits.maxPurchase },
    );
    assertProtocol(
        limits.capacityReserve >= limits.maxPurchase,
        "INVALID_CONFIGURATION",
        "bad reserve cap",
        {
            capacityReserve: limits.capacityReserve,
            maxPurchase: limits.maxPurchase,
        },
    );
    assertProtocol(limits.capacityPayout > 0n, "INVALID_CONFIGURATION", "bad payout cap", {
        capacityPayout: limits.capacityPayout,
    });
    assertProtocol(
        limits.maxDiscountBps >= 0n && limits.maxDiscountBps <= BPS,
        "INVALID_DISCOUNT",
        "max discount out of range",
        { maxDiscountBps: limits.maxDiscountBps },
    );
}

export function validateMarketConfig(
    config: MarketConfig,
    policy: PurchasePolicy = DEFAULT_PURCHASE_POLICY,
): MarketConfig {
    assertProtocol(
        config.name.trim().length >= 3,
        "INVALID_CONFIGURATION",
        "market name too short",
    );
    assertProtocol(
        config.reserveAsset !== config.payoutAsset,
        "INVALID_CONFIGURATION",
        "same asset pair",
    );
    assertProtocol(config.basePrice > 0n, "INVALID_PRICE", "base price must be positive", {
        basePrice: config.basePrice,
    });
    assertProtocol(config.basePrice <= WAD * 10_000n, "INVALID_PRICE", "base price too high", {
        basePrice: config.basePrice,
    });
    assertProtocol(
        config.openingTime < config.closingTime,
        "INVALID_CONFIGURATION",
        "bad market time",
    );
    assertProtocol(
        config.quoteTtl >= policy.minQuoteTtl && config.quoteTtl <= policy.maxQuoteTtl,
        "INVALID_CONFIGURATION",
        "quote ttl out of policy",
        { quoteTtl: config.quoteTtl },
    );
    validateLimits(config.limits);
    normalizeBands(config.discountBands);
    return Object.freeze({
        ...config,
        discountBands: normalizeBands(config.discountBands),
    });
}

export function assertRiskAccepted(riskTier: number, policy: PurchasePolicy): void {
    assertProtocol(
        riskTier <= policy.maxRiskTier,
        "AUTHORIZATION_FAILED",
        "risk tier exceeds policy",
        {
            riskTier,
            maxRiskTier: policy.maxRiskTier,
        },
    );
}
