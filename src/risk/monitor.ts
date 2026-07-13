import { BPS, mulDiv } from "../shared/amount.js";
import type { AssetId, MarketId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";
import type { Treasury } from "../accounting/treasury.js";
import type { MarketState } from "../domain/bonds.js";
import { vestingState } from "../domain/vesting.js";
import type { PositionBook } from "../services/positionBook.js";
import { indexUnitsToNominal } from "../services/claimEngine.js";

export type RiskLevel = "ok" | "watch" | "breach";

export interface RiskAlert {
    readonly level: RiskLevel;
    readonly code: string;
    readonly subject: string;
    readonly detail: string;
    readonly value: bigint;
    readonly limit: bigint;
}

export interface MarketRiskReport {
    readonly market: MarketId;
    readonly soldReserve: bigint;
    readonly soldPayout: bigint;
    readonly reserveUtilizationBps: bigint;
    readonly payoutUtilizationBps: bigint;
    readonly unvestedPayout: bigint;
    readonly claimablePayout: bigint;
    readonly alerts: readonly RiskAlert[];
}

export interface TreasuryRiskReport {
    readonly payoutAsset: AssetId;
    readonly emissionBalance: bigint;
    readonly openLiabilities: bigint;
    readonly claimableNow: bigint;
    readonly coverageBps: bigint;
    readonly alerts: readonly RiskAlert[];
}

export interface RiskMonitorConfig {
    readonly reserveWatchBps: bigint;
    readonly reserveBreachBps: bigint;
    readonly payoutWatchBps: bigint;
    readonly payoutBreachBps: bigint;
    readonly coverageWatchBps: bigint;
    readonly coverageBreachBps: bigint;
}

export const DEFAULT_RISK_CONFIG: RiskMonitorConfig = Object.freeze({
    reserveWatchBps: 8_000n,
    reserveBreachBps: 9_500n,
    payoutWatchBps: 8_000n,
    payoutBreachBps: 9_500n,
    coverageWatchBps: 11_000n,
    coverageBreachBps: 10_000n,
});

function utilization(used: bigint, capacity: bigint): bigint {
    return capacity === 0n ? 0n : mulDiv(used, BPS, capacity);
}

function alert(
    level: RiskLevel,
    code: string,
    subject: string,
    detail: string,
    value: bigint,
    limit: bigint,
): RiskAlert {
    return Object.freeze({ level, code, subject, detail, value, limit });
}

function thresholdAlert(
    code: string,
    subject: string,
    detail: string,
    value: bigint,
    watch: bigint,
    breach: bigint,
): RiskAlert | undefined {
    if (value >= breach) {
        return alert("breach", code, subject, detail, value, breach);
    }
    if (value >= watch) {
        return alert("watch", code, subject, detail, value, watch);
    }
    return undefined;
}

function coverageAlert(
    code: string,
    subject: string,
    detail: string,
    value: bigint,
    watch: bigint,
    breach: bigint,
): RiskAlert | undefined {
    if (value < breach) {
        return alert("breach", code, subject, detail, value, breach);
    }
    if (value < watch) {
        return alert("watch", code, subject, detail, value, watch);
    }
    return undefined;
}

export class RiskMonitor {
    constructor(
        private readonly book: PositionBook,
        private readonly treasury: Treasury,
        private readonly config: RiskMonitorConfig = DEFAULT_RISK_CONFIG,
    ) {}

    market(marketId: MarketId, now: Timestamp): MarketRiskReport {
        const market = this.book.getMarket(marketId);
        return this.marketFromState(market, now);
    }

    markets(now: Timestamp): readonly MarketRiskReport[] {
        return this.book.allMarkets().map((market) => this.marketFromState(market, now));
    }

    treasuryForPayout(payoutAsset: AssetId, now: Timestamp): TreasuryRiskReport {
        let openLiabilities = 0n;
        let claimableNow = 0n;
        for (const position of this.book.allPositions()) {
            if (position.payoutAsset !== payoutAsset || position.status !== "vesting") {
                continue;
            }
            const market = this.book.getMarket(position.market);
            const state = vestingState(position.schedule, position.payoutTotal, now);
            const claimed = indexUnitsToNominal(position.claimedIndexUnits, market.priceIndex);
            openLiabilities +=
                claimed >= position.payoutTotal ? 0n : position.payoutTotal - claimed;
            claimableNow += state.vested > claimed ? state.vested - claimed : 0n;
        }
        const emissionBalance = this.treasury.emissionBalance(payoutAsset);
        const coverageBps =
            openLiabilities === 0n ? 2n * BPS : mulDiv(emissionBalance, BPS, openLiabilities);
        const alerts: RiskAlert[] = [];
        const coverage = coverageAlert(
            "TREASURY_COVERAGE",
            payoutAsset,
            "emission vault coverage below policy",
            coverageBps,
            this.config.coverageWatchBps,
            this.config.coverageBreachBps,
        );
        if (coverage !== undefined) {
            alerts.push(coverage);
        }
        if (claimableNow > emissionBalance) {
            alerts.push(
                alert(
                    "breach",
                    "CLAIMABLE_EXCEEDS_EMISSION",
                    payoutAsset,
                    "currently claimable payout exceeds emission vault",
                    claimableNow,
                    emissionBalance,
                ),
            );
        }
        return Object.freeze({
            payoutAsset,
            emissionBalance,
            openLiabilities,
            claimableNow,
            coverageBps,
            alerts: Object.freeze(alerts),
        });
    }

    private marketFromState(market: MarketState, now: Timestamp): MarketRiskReport {
        const reserveUtilizationBps = utilization(
            market.soldReserve,
            market.config.limits.capacityReserve,
        );
        const payoutUtilizationBps = utilization(
            market.soldPayout,
            market.config.limits.capacityPayout,
        );
        let unvestedPayout = 0n;
        let claimablePayout = 0n;
        for (const position of this.book.positionsInMarket(market.config.id)) {
            if (position.status !== "vesting") {
                continue;
            }
            const state = vestingState(position.schedule, position.payoutTotal, now);
            const claimed = indexUnitsToNominal(position.claimedIndexUnits, market.priceIndex);
            unvestedPayout += state.unvested;
            claimablePayout += state.vested > claimed ? state.vested - claimed : 0n;
        }
        const alerts: RiskAlert[] = [];
        const reserveAlert = thresholdAlert(
            "RESERVE_CAPACITY",
            market.config.id,
            "reserve capacity utilization is elevated",
            reserveUtilizationBps,
            this.config.reserveWatchBps,
            this.config.reserveBreachBps,
        );
        const payoutAlert = thresholdAlert(
            "PAYOUT_CAPACITY",
            market.config.id,
            "payout capacity utilization is elevated",
            payoutUtilizationBps,
            this.config.payoutWatchBps,
            this.config.payoutBreachBps,
        );
        if (reserveAlert !== undefined) {
            alerts.push(reserveAlert);
        }
        if (payoutAlert !== undefined) {
            alerts.push(payoutAlert);
        }
        return Object.freeze({
            market: market.config.id,
            soldReserve: market.soldReserve,
            soldPayout: market.soldPayout,
            reserveUtilizationBps,
            payoutUtilizationBps,
            unvestedPayout,
            claimablePayout,
            alerts: Object.freeze(alerts),
        });
    }
}
