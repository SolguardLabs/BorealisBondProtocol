import { mulDiv, WAD } from "../shared/amount.js";
import { assertProtocol, fail } from "../shared/errors.js";
import type { AssetId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";

export interface PriceFeedConfig {
    readonly asset: AssetId;
    readonly key: string;
    readonly heartbeat: bigint;
    readonly initialPrice: bigint;
    readonly source: string;
}

export interface PriceObservation {
    readonly asset: AssetId;
    readonly key: string;
    readonly price: bigint;
    readonly index: bigint;
    readonly updatedAt: Timestamp;
    readonly heartbeat: bigint;
    readonly source: string;
}

export interface PriceUpdate {
    readonly asset: AssetId;
    readonly price: bigint;
    readonly at: Timestamp;
    readonly source?: string;
}

function cloneObservation(
    observation: PriceObservation,
    patch: Partial<PriceObservation>,
): PriceObservation {
    return Object.freeze({ ...observation, ...patch });
}

export class PriceOracle {
    private readonly feeds = new Map<AssetId, PriceObservation>();

    register(config: PriceFeedConfig, at: Timestamp): PriceObservation {
        if (this.feeds.has(config.asset)) {
            fail("VALIDATION_FAILED", "price feed already registered", { asset: config.asset });
        }
        assertProtocol(config.initialPrice > 0n, "INVALID_PRICE", "price must be positive", {
            price: config.initialPrice,
        });
        assertProtocol(
            config.heartbeat > 0n,
            "INVALID_CONFIGURATION",
            "heartbeat must be positive",
            {
                heartbeat: config.heartbeat,
            },
        );
        const observation = Object.freeze({
            asset: config.asset,
            key: config.key,
            price: config.initialPrice,
            index: WAD,
            updatedAt: at,
            heartbeat: config.heartbeat,
            source: config.source,
        });
        this.feeds.set(config.asset, observation);
        return observation;
    }

    update(update: PriceUpdate): PriceObservation {
        const current = this.get(update.asset);
        assertProtocol(update.price > 0n, "INVALID_PRICE", "price must be positive", {
            price: update.price,
        });
        assertProtocol(update.at >= current.updatedAt, "CLOCK_REGRESSION", "stale price update", {
            asset: update.asset,
            current: current.updatedAt,
            next: update.at,
        });
        const nextIndex = mulDiv(current.index, update.price, current.price);
        const next = cloneObservation(current, {
            price: update.price,
            index: nextIndex,
            updatedAt: update.at,
            source: update.source ?? current.source,
        });
        this.feeds.set(update.asset, next);
        return next;
    }

    get(asset: AssetId): PriceObservation {
        const feed = this.feeds.get(asset);
        if (feed === undefined) {
            fail("ASSET_NOT_FOUND", "price feed is not registered", { asset });
        }
        return feed;
    }

    assertFresh(asset: AssetId, now: Timestamp): PriceObservation {
        const feed = this.get(asset);
        assertProtocol(now >= feed.updatedAt, "CLOCK_REGRESSION", "clock before price update", {
            asset,
            now,
            updatedAt: feed.updatedAt,
        });
        assertProtocol(
            now - feed.updatedAt <= feed.heartbeat,
            "INVALID_PRICE",
            "stale price feed",
            {
                asset,
                age: now - feed.updatedAt,
                heartbeat: feed.heartbeat,
            },
        );
        return feed;
    }

    quote(assetIn: AssetId, amountIn: bigint, assetOut: AssetId, now: Timestamp): bigint {
        const input = this.assertFresh(assetIn, now);
        const output = this.assertFresh(assetOut, now);
        return mulDiv(amountIn, input.price, output.price);
    }

    list(): readonly PriceObservation[] {
        return [...this.feeds.values()];
    }
}
