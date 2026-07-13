import { parseUnits, WAD } from "../shared/amount.js";
import {
    accountId,
    assetId,
    marketId,
    type AccountId,
    type AssetId,
    type MarketId,
} from "../shared/ids.js";
import { days, timestamp } from "../shared/time.js";
import type { MarketConfig } from "../domain/bonds.js";
import { createTemplate, type VestingTemplate } from "../domain/vesting.js";
import { BorealisBondProtocol } from "../services/protocol.js";

export interface StandardActors {
    readonly governance: AccountId;
    readonly keeper: AccountId;
    readonly treasury: AccountId;
    readonly alice: AccountId;
    readonly bob: AccountId;
    readonly carol: AccountId;
}

export interface StandardAssets {
    readonly usdc: AssetId;
    readonly dai: AssetId;
    readonly boreal: AssetId;
}

export interface StandardMarketIds {
    readonly primary: MarketId;
    readonly short: MarketId;
    readonly institutional: MarketId;
}

export interface StandardScenario {
    readonly protocol: BorealisBondProtocol;
    readonly actors: StandardActors;
    readonly assets: StandardAssets;
    readonly markets: StandardMarketIds;
}

export interface ScenarioOptions {
    readonly initialTime?: bigint | number;
    readonly emissionFunding?: bigint;
    readonly buyerFunding?: bigint;
    readonly basePrice?: bigint;
    readonly vesting?: VestingTemplate;
}

export const STANDARD_ACTORS: StandardActors = Object.freeze({
    governance: accountId("governance"),
    keeper: accountId("keeper"),
    treasury: accountId("treasury:ops"),
    alice: accountId("alice"),
    bob: accountId("bob"),
    carol: accountId("carol"),
});

export const STANDARD_ASSETS: StandardAssets = Object.freeze({
    usdc: assetId("USDC"),
    dai: assetId("DAI"),
    boreal: assetId("BRL"),
});

export const STANDARD_MARKETS: StandardMarketIds = Object.freeze({
    primary: marketId("BRL-USDC-7D"),
    short: marketId("BRL-USDC-2D"),
    institutional: marketId("BRL-DAI-INST"),
});

export function usdc(amount: string): bigint {
    return parseUnits(amount, 6);
}

export function dai(amount: string): bigint {
    return parseUnits(amount, 18);
}

export function boreal(amount: string): bigint {
    return parseUnits(amount, 18);
}

export function price(amount: string): bigint {
    return parseUnits(amount, 18);
}

export function createPrimaryMarketConfig(
    assets: StandardAssets,
    id: MarketId = STANDARD_MARKETS.primary,
    basePrice = WAD,
    vesting: VestingTemplate = createTemplate({ duration: days(7), cliff: 0n }),
): MarketConfig {
    return Object.freeze({
        id,
        name: "Borealis 7 Day Reserve Bond",
        reserveAsset: assets.usdc,
        payoutAsset: assets.boreal,
        basePrice,
        quoteTtl: 300n,
        openingTime: timestamp(0n),
        closingTime: timestamp(days(90)),
        vesting,
        limits: Object.freeze({
            minPurchase: usdc("10"),
            maxPurchase: usdc("250000"),
            capacityReserve: usdc("5000000"),
            capacityPayout: boreal("7000000"),
            maxDiscountBps: 2_500n,
        }),
        discountBands: Object.freeze([
            Object.freeze({ minReserveIn: 0n, discountBps: 300n, label: "retail" }),
            Object.freeze({ minReserveIn: usdc("25000"), discountBps: 600n, label: "desk" }),
            Object.freeze({ minReserveIn: usdc("100000"), discountBps: 900n, label: "strategic" }),
        ]),
    });
}

export function createShortMarketConfig(
    assets: StandardAssets,
    id: MarketId = STANDARD_MARKETS.short,
): MarketConfig {
    return Object.freeze({
        ...createPrimaryMarketConfig(
            assets,
            id,
            price("1.05"),
            createTemplate({ duration: days(2), cliff: 0n, cancellationPenaltyBps: 500n }),
        ),
        name: "Borealis 48 Hour Reserve Bond",
        limits: Object.freeze({
            minPurchase: usdc("25"),
            maxPurchase: usdc("100000"),
            capacityReserve: usdc("1000000"),
            capacityPayout: boreal("1200000"),
            maxDiscountBps: 1_500n,
        }),
        discountBands: Object.freeze([
            Object.freeze({ minReserveIn: 0n, discountBps: 150n, label: "retail" }),
            Object.freeze({ minReserveIn: usdc("50000"), discountBps: 400n, label: "desk" }),
        ]),
    });
}

export function createInstitutionalMarketConfig(
    assets: StandardAssets,
    id: MarketId = STANDARD_MARKETS.institutional,
): MarketConfig {
    return Object.freeze({
        id,
        name: "Borealis DAI Institutional Bond",
        reserveAsset: assets.dai,
        payoutAsset: assets.boreal,
        basePrice: price("0.98"),
        quoteTtl: 900n,
        openingTime: timestamp(0n),
        closingTime: timestamp(days(120)),
        vesting: createTemplate({
            duration: days(14),
            cliff: days(2),
            cancellationPenaltyBps: 750n,
        }),
        limits: Object.freeze({
            minPurchase: dai("1000"),
            maxPurchase: dai("1000000"),
            capacityReserve: dai("25000000"),
            capacityPayout: boreal("30000000"),
            maxDiscountBps: 3_000n,
        }),
        discountBands: Object.freeze([
            Object.freeze({ minReserveIn: 0n, discountBps: 500n, label: "base" }),
            Object.freeze({ minReserveIn: dai("100000"), discountBps: 1_000n, label: "desk" }),
            Object.freeze({
                minReserveIn: dai("1000000"),
                discountBps: 1_400n,
                label: "strategic",
            }),
        ]),
    });
}

export function setupStandardScenario(options: ScenarioOptions = {}): StandardScenario {
    const protocol = new BorealisBondProtocol(options.initialTime ?? 0n);
    const actors = STANDARD_ACTORS;
    const assets = STANDARD_ASSETS;
    const markets = STANDARD_MARKETS;
    protocol.registerAccount({
        id: actors.governance,
        label: "Borealis Governance",
        roles: ["governance", "admin", "auditor"],
    });
    protocol.registerAccount({
        id: actors.keeper,
        label: "Borealis Keeper",
        roles: ["keeper", "auditor"],
    });
    protocol.registerAccount({
        id: actors.treasury,
        label: "Operations Treasury",
        roles: ["market-maker", "auditor"],
    });
    protocol.registerAccount({ id: actors.alice, label: "Alice Reserve Buyer", roles: ["buyer"] });
    protocol.registerAccount({ id: actors.bob, label: "Bob Reserve Buyer", roles: ["buyer"] });
    protocol.registerAccount({ id: actors.carol, label: "Carol Reserve Buyer", roles: ["buyer"] });
    protocol.registerAsset({
        id: assets.usdc,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        kind: "reserve",
        oracleKey: "USDC-USD",
    });
    protocol.registerAsset({
        id: assets.dai,
        symbol: "DAI",
        name: "Dai Stablecoin",
        decimals: 18,
        kind: "reserve",
        oracleKey: "DAI-USD",
    });
    protocol.registerAsset({
        id: assets.boreal,
        symbol: "BRL",
        name: "Borealis Emission Token",
        decimals: 18,
        kind: "payout",
        oracleKey: "BRL-USD",
    });
    protocol.fundEmission(assets.boreal, options.emissionFunding ?? boreal("100000000"));
    protocol.fundWallet(actors.alice, assets.usdc, options.buyerFunding ?? usdc("1000000"));
    protocol.fundWallet(actors.bob, assets.usdc, options.buyerFunding ?? usdc("1000000"));
    protocol.fundWallet(actors.carol, assets.usdc, options.buyerFunding ?? usdc("1000000"));
    protocol.fundWallet(actors.alice, assets.dai, dai("500000"));
    protocol.fundWallet(actors.bob, assets.dai, dai("500000"));
    protocol.fundWallet(actors.carol, assets.dai, dai("500000"));
    protocol.createMarket(
        actors.governance,
        createPrimaryMarketConfig(
            assets,
            markets.primary,
            options.basePrice ?? WAD,
            options.vesting ?? createTemplate({ duration: days(7), cliff: 0n }),
        ),
    );
    protocol.createMarket(actors.governance, createShortMarketConfig(assets, markets.short));
    protocol.createMarket(
        actors.governance,
        createInstitutionalMarketConfig(assets, markets.institutional),
    );
    return Object.freeze({ protocol, actors, assets, markets });
}
