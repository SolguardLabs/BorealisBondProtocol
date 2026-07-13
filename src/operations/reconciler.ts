import { BPS, mulDiv } from "../shared/amount.js";
import type { AccountId, AssetId, MarketId, PositionId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";
import type { Treasury } from "../accounting/treasury.js";
import type { BondPosition, MarketState } from "../domain/bonds.js";
import { vestingState } from "../domain/vesting.js";
import { indexUnitsToNominal } from "../services/claimEngine.js";
import type { PositionBook } from "../services/positionBook.js";

export type ReconciliationStatus = "matched" | "review" | "deficit";

export interface PositionReconciliation {
    readonly position: PositionId;
    readonly owner: AccountId;
    readonly market: MarketId;
    readonly payoutAsset: AssetId;
    readonly status: ReconciliationStatus;
    readonly positionStatus: string;
    readonly payoutTotal: bigint;
    readonly vested: bigint;
    readonly claimed: bigint;
    readonly claimable: bigint;
    readonly openNominal: bigint;
    readonly liabilityBook: bigint;
    readonly delta: bigint;
}

export interface AssetReconciliation {
    readonly asset: AssetId;
    readonly emissionBalance: bigint;
    readonly openNominal: bigint;
    readonly claimable: bigint;
    readonly liabilityBook: bigint;
    readonly coverageBps: bigint;
    readonly status: ReconciliationStatus;
}

export interface MarketReconciliation {
    readonly market: MarketId;
    readonly reserveSold: bigint;
    readonly payoutSold: bigint;
    readonly openNominal: bigint;
    readonly claimable: bigint;
    readonly positions: number;
    readonly status: ReconciliationStatus;
}

export interface ReconciliationReport {
    readonly at: Timestamp;
    readonly positions: readonly PositionReconciliation[];
    readonly assets: readonly AssetReconciliation[];
    readonly markets: readonly MarketReconciliation[];
    readonly status: ReconciliationStatus;
}

function statusFromDelta(delta: bigint): ReconciliationStatus {
    if (delta === 0n) {
        return "matched";
    }
    return delta > 0n ? "review" : "deficit";
}

function mergeStatus(
    left: ReconciliationStatus,
    right: ReconciliationStatus,
): ReconciliationStatus {
    if (left === "deficit" || right === "deficit") {
        return "deficit";
    }
    if (left === "review" || right === "review") {
        return "review";
    }
    return "matched";
}

function abs(value: bigint): bigint {
    return value < 0n ? -value : value;
}

export class Reconciler {
    constructor(
        private readonly book: PositionBook,
        private readonly treasury: Treasury,
    ) {}

    run(now: Timestamp): ReconciliationReport {
        const positions = this.book.allPositions().map((position) => this.position(position, now));
        const assets = this.assets(positions);
        const markets = this.markets(positions);
        let status: ReconciliationStatus = "matched";
        for (const item of positions) {
            status = mergeStatus(status, item.status);
        }
        for (const item of assets) {
            status = mergeStatus(status, item.status);
        }
        for (const item of markets) {
            status = mergeStatus(status, item.status);
        }
        return Object.freeze({
            at: now,
            positions: Object.freeze(positions),
            assets: Object.freeze(assets),
            markets: Object.freeze(markets),
            status,
        });
    }

    position(position: BondPosition, now: Timestamp): PositionReconciliation {
        const market = this.book.getMarket(position.market);
        const state = vestingState(position.schedule, position.payoutTotal, now);
        const claimed = indexUnitsToNominal(position.claimedIndexUnits, market.priceIndex);
        const claimable =
            position.status === "vesting" && state.vested > claimed ? state.vested - claimed : 0n;
        const openNominal =
            position.status === "vesting" && claimed < position.payoutTotal
                ? position.payoutTotal - claimed
                : 0n;
        let liabilityBook = 0n;
        try {
            const liability = this.treasury.requireLiability(position.id);
            liabilityBook = liability.closed ? 0n : liability.amount;
        } catch {
            liabilityBook = 0n;
        }
        const delta = liabilityBook - openNominal;
        const status = abs(delta) <= 1n ? "matched" : statusFromDelta(delta);
        return Object.freeze({
            position: position.id,
            owner: position.owner,
            market: position.market,
            payoutAsset: position.payoutAsset,
            status,
            positionStatus: position.status,
            payoutTotal: position.payoutTotal,
            vested: state.vested,
            claimed,
            claimable,
            openNominal,
            liabilityBook,
            delta,
        });
    }

    private assets(positions: readonly PositionReconciliation[]): readonly AssetReconciliation[] {
        const byAsset = new Map<
            AssetId,
            {
                openNominal: bigint;
                claimable: bigint;
                liabilityBook: bigint;
            }
        >();
        for (const position of positions) {
            const current = byAsset.get(position.payoutAsset) ?? {
                openNominal: 0n,
                claimable: 0n,
                liabilityBook: 0n,
            };
            current.openNominal += position.openNominal;
            current.claimable += position.claimable;
            current.liabilityBook += position.liabilityBook;
            byAsset.set(position.payoutAsset, current);
        }
        const output: AssetReconciliation[] = [];
        for (const [asset, totals] of byAsset) {
            const emissionBalance = this.treasury.emissionBalance(asset);
            const coverageBps =
                totals.openNominal === 0n
                    ? 2n * BPS
                    : mulDiv(emissionBalance, BPS, totals.openNominal);
            const status =
                emissionBalance < totals.claimable
                    ? "deficit"
                    : totals.liabilityBook === totals.openNominal
                      ? "matched"
                      : "review";
            output.push(
                Object.freeze({
                    asset,
                    emissionBalance,
                    openNominal: totals.openNominal,
                    claimable: totals.claimable,
                    liabilityBook: totals.liabilityBook,
                    coverageBps,
                    status,
                }),
            );
        }
        return Object.freeze(output);
    }

    private markets(positions: readonly PositionReconciliation[]): readonly MarketReconciliation[] {
        const output: MarketReconciliation[] = [];
        for (const market of this.book.allMarkets()) {
            output.push(this.market(market, positions));
        }
        return Object.freeze(output);
    }

    private market(
        market: MarketState,
        positions: readonly PositionReconciliation[],
    ): MarketReconciliation {
        const filtered = positions.filter((position) => position.market === market.config.id);
        let openNominal = 0n;
        let claimable = 0n;
        let status: ReconciliationStatus = "matched";
        for (const position of filtered) {
            openNominal += position.openNominal;
            claimable += position.claimable;
            status = mergeStatus(status, position.status);
        }
        const capacityExceeded =
            market.soldReserve > market.config.limits.capacityReserve ||
            market.soldPayout > market.config.limits.capacityPayout;
        return Object.freeze({
            market: market.config.id,
            reserveSold: market.soldReserve,
            payoutSold: market.soldPayout,
            openNominal,
            claimable,
            positions: filtered.length,
            status: capacityExceeded ? "deficit" : status,
        });
    }
}
