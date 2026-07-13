import type { AccountId, AssetId, MarketId, PositionId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";
import type { VestingSchedule, VestingTemplate } from "./vesting.js";

export type MarketStatus = "active" | "paused" | "closed";
export type PositionStatus = "vesting" | "cancelled" | "claimed";

export interface DiscountBand {
    readonly minReserveIn: bigint;
    readonly discountBps: bigint;
    readonly label: string;
}

export interface MarketLimits {
    readonly minPurchase: bigint;
    readonly maxPurchase: bigint;
    readonly capacityReserve: bigint;
    readonly capacityPayout: bigint;
    readonly maxDiscountBps: bigint;
}

export interface MarketConfig {
    readonly id: MarketId;
    readonly name: string;
    readonly reserveAsset: AssetId;
    readonly payoutAsset: AssetId;
    readonly basePrice: bigint;
    readonly quoteTtl: bigint;
    readonly openingTime: Timestamp;
    readonly closingTime: Timestamp;
    readonly vesting: VestingTemplate;
    readonly limits: MarketLimits;
    readonly discountBands: readonly DiscountBand[];
}

export interface MarketState {
    readonly config: MarketConfig;
    readonly status: MarketStatus;
    readonly soldReserve: bigint;
    readonly soldPayout: bigint;
    readonly priceIndex: bigint;
    readonly lastPrice: bigint;
    readonly updatedAt: Timestamp;
}

export interface BondQuote {
    readonly market: MarketId;
    readonly buyer: AccountId;
    readonly reserveIn: bigint;
    readonly payoutOut: bigint;
    readonly basePrice: bigint;
    readonly discountedPrice: bigint;
    readonly discountBps: bigint;
    readonly priceIndex: bigint;
    readonly expiresAt: Timestamp;
}

export interface BondPosition {
    readonly id: PositionId;
    readonly market: MarketId;
    readonly owner: AccountId;
    readonly reserveAsset: AssetId;
    readonly payoutAsset: AssetId;
    readonly reservePaid: bigint;
    readonly payoutTotal: bigint;
    readonly openedAt: Timestamp;
    readonly purchasePrice: bigint;
    readonly purchaseIndex: bigint;
    readonly claimedIndexUnits: bigint;
    readonly schedule: VestingSchedule;
    readonly status: PositionStatus;
    readonly cancelledAt?: Timestamp;
    readonly closedAt?: Timestamp;
}

export interface PositionSnapshot {
    readonly id: PositionId;
    readonly market: MarketId;
    readonly owner: AccountId;
    readonly status: PositionStatus;
    readonly reservePaid: bigint;
    readonly payoutTotal: bigint;
    readonly claimedIndexUnits: bigint;
    readonly openedAt: Timestamp;
    readonly startsAt: Timestamp;
    readonly endsAt: Timestamp;
}

export function snapshotPosition(position: BondPosition): PositionSnapshot {
    return Object.freeze({
        id: position.id,
        market: position.market,
        owner: position.owner,
        status: position.status,
        reservePaid: position.reservePaid,
        payoutTotal: position.payoutTotal,
        claimedIndexUnits: position.claimedIndexUnits,
        openedAt: position.openedAt,
        startsAt: position.schedule.startsAt,
        endsAt: position.schedule.endsAt,
    });
}

export function clonePosition(position: BondPosition, patch: Partial<BondPosition>): BondPosition {
    const merged = { ...position, ...patch };
    return Object.freeze(merged);
}

export function cloneMarket(state: MarketState, patch: Partial<MarketState>): MarketState {
    return Object.freeze({ ...state, ...patch });
}
