import { BPS, max, mulDiv } from "../shared/amount.js";
import { canonicalDigest } from "../shared/canonical.js";
import { assertProtocol } from "../shared/errors.js";
import type { AssetId, MarketId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";

export interface LiquiditySource {
    readonly id: string;
    readonly asset: AssetId;
    readonly amount: bigint;
    readonly availableAt: Timestamp;
    readonly recoveryBps: bigint;
    readonly haircutBps: bigint;
}

export interface LiabilityBucket {
    readonly id: string;
    readonly market: MarketId;
    readonly asset: AssetId;
    readonly amount: bigint;
    readonly dueAt: Timestamp;
    readonly probabilityBps: bigint;
    readonly stressBps: bigint;
}

export interface StressLimits {
    readonly minCoverageBps: bigint;
    readonly maxShortfall: bigint;
    readonly maxMarketShareBps: bigint;
    readonly maxMarketHhiBps: bigint;
}

export interface SourceStressResult {
    readonly id: string;
    readonly amount: bigint;
    readonly recovered: bigint;
    readonly haircut: bigint;
    readonly effective: bigint;
    readonly availableWithinHorizon: boolean;
}

export interface LiabilityStressResult {
    readonly id: string;
    readonly market: MarketId;
    readonly amount: bigint;
    readonly probable: bigint;
    readonly stressAddon: bigint;
    readonly stressed: bigint;
    readonly dueWithinHorizon: boolean;
    readonly secondsToMaturity: bigint;
}

export interface MarketConcentration {
    readonly market: MarketId;
    readonly stressedOutflow: bigint;
    readonly shareBps: bigint;
    readonly hhiContributionBps: bigint;
}

export interface BondStressReport {
    readonly asset: AssetId;
    readonly asOf: Timestamp;
    readonly horizonEnd: Timestamp;
    readonly sources: readonly SourceStressResult[];
    readonly liabilities: readonly LiabilityStressResult[];
    readonly markets: readonly MarketConcentration[];
    readonly totalSource: bigint;
    readonly totalStressedOutflow: bigint;
    readonly surplus: bigint;
    readonly shortfall: bigint;
    readonly coverageBps: bigint;
    readonly weightedMaturitySeconds: bigint;
    readonly largestMarketShareBps: bigint;
    readonly marketHhiBps: bigint;
    readonly withinLimits: boolean;
    readonly digest: string;
}

const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,95}$/;

function validateBps(value: bigint, label: string, maximum = BPS): void {
    assertProtocol(value >= 0n && value <= maximum, "VALIDATION_FAILED", `${label} outside range`, {
        value,
    });
}

function requireCanonicalIds(items: readonly { readonly id: string }[], label: string): void {
    let previous = "";
    for (const item of items) {
        assertProtocol(LABEL.test(item.id), "VALIDATION_FAILED", `${label} id is invalid`, {
            id: item.id,
        });
        assertProtocol(item.id > previous, "VALIDATION_FAILED", `${label} order is not canonical`, {
            previous,
            current: item.id,
        });
        previous = item.id;
    }
}

function ratioBps(numerator: bigint, denominator: bigint): bigint {
    return denominator === 0n ? 2n * BPS : mulDiv(numerator, BPS, denominator);
}

function hhiContribution(shareBps: bigint): bigint {
    return mulDiv(shareBps, shareBps, BPS);
}

export class BondStressEngine {
    evaluate(
        asset: AssetId,
        asOf: Timestamp,
        horizonEnd: Timestamp,
        sources: readonly LiquiditySource[],
        liabilities: readonly LiabilityBucket[],
        limits: StressLimits,
    ): BondStressReport {
        assertProtocol(horizonEnd > asOf, "VALIDATION_FAILED", "stress horizon must be positive");
        assertProtocol(sources.length > 0, "VALIDATION_FAILED", "liquidity sources are required");
        assertProtocol(liabilities.length > 0, "VALIDATION_FAILED", "liabilities are required");
        requireCanonicalIds(sources, "source");
        requireCanonicalIds(liabilities, "liability");
        validateBps(limits.minCoverageBps, "minimum coverage", 5n * BPS);
        validateBps(limits.maxMarketShareBps, "maximum market share");
        validateBps(limits.maxMarketHhiBps, "maximum market hhi");

        const sourceResults = sources.map((source) => this.source(asset, horizonEnd, source));
        const liabilityResults = liabilities.map((liability) =>
            this.liability(asset, asOf, horizonEnd, liability),
        );
        const totalSource = sourceResults.reduce((total, source) => total + source.effective, 0n);
        const totalStressedOutflow = liabilityResults.reduce(
            (total, liability) => total + liability.stressed,
            0n,
        );
        const surplus = max(totalSource - totalStressedOutflow, 0n);
        const shortfall = max(totalStressedOutflow - totalSource, 0n);
        const coverageBps = ratioBps(totalSource, totalStressedOutflow);
        const weightedMaturitySeconds =
            totalStressedOutflow === 0n
                ? 0n
                : liabilityResults.reduce(
                      (total, liability) =>
                          total + liability.stressed * liability.secondsToMaturity,
                      0n,
                  ) / totalStressedOutflow;
        const markets = this.concentration(liabilityResults, totalStressedOutflow);
        const largestMarketShareBps = markets.reduce(
            (largest, market) => max(largest, market.shareBps),
            0n,
        );
        const marketHhiBps = markets.reduce(
            (total, market) => total + market.hhiContributionBps,
            0n,
        );
        const withinLimits =
            shortfall <= limits.maxShortfall &&
            coverageBps >= limits.minCoverageBps &&
            largestMarketShareBps <= limits.maxMarketShareBps &&
            marketHhiBps <= limits.maxMarketHhiBps;
        const digest = canonicalDigest({
            domain: "borealis-bond-stress-v1",
            asset,
            asOf,
            horizonEnd,
            sourceResults: sourceResults.map((source) => ({
                id: source.id,
                effective: source.effective,
            })),
            liabilityResults: liabilityResults.map((liability) => ({
                id: liability.id,
                stressed: liability.stressed,
            })),
            totalSource,
            totalStressedOutflow,
            shortfall,
            coverageBps,
            marketHhiBps,
            withinLimits,
        });

        return Object.freeze({
            asset,
            asOf,
            horizonEnd,
            sources: Object.freeze(sourceResults),
            liabilities: Object.freeze(liabilityResults),
            markets: Object.freeze(markets),
            totalSource,
            totalStressedOutflow,
            surplus,
            shortfall,
            coverageBps,
            weightedMaturitySeconds,
            largestMarketShareBps,
            marketHhiBps,
            withinLimits,
            digest,
        });
    }

    private source(
        asset: AssetId,
        horizonEnd: Timestamp,
        source: LiquiditySource,
    ): SourceStressResult {
        assertProtocol(source.asset === asset, "VALIDATION_FAILED", "source asset mismatch");
        assertProtocol(source.amount >= 0n, "VALIDATION_FAILED", "source amount is negative");
        validateBps(source.recoveryBps, "source recovery");
        validateBps(source.haircutBps, "source haircut");
        const availableWithinHorizon = source.availableAt <= horizonEnd;
        const recovered = availableWithinHorizon
            ? mulDiv(source.amount, source.recoveryBps, BPS)
            : 0n;
        const haircut = mulDiv(recovered, source.haircutBps, BPS);
        const effective = recovered - haircut;
        return Object.freeze({
            id: source.id,
            amount: source.amount,
            recovered,
            haircut,
            effective,
            availableWithinHorizon,
        });
    }

    private liability(
        asset: AssetId,
        asOf: Timestamp,
        horizonEnd: Timestamp,
        liability: LiabilityBucket,
    ): LiabilityStressResult {
        assertProtocol(liability.asset === asset, "VALIDATION_FAILED", "liability asset mismatch");
        assertProtocol(liability.amount >= 0n, "VALIDATION_FAILED", "liability amount is negative");
        validateBps(liability.probabilityBps, "liability probability");
        validateBps(liability.stressBps, "liability stress");
        const dueWithinHorizon = liability.dueAt <= horizonEnd;
        const probable = dueWithinHorizon
            ? mulDiv(liability.amount, liability.probabilityBps, BPS)
            : 0n;
        const stressAddon = dueWithinHorizon
            ? mulDiv(liability.amount, liability.stressBps, BPS)
            : 0n;
        const stressed = probable + stressAddon;
        const secondsToMaturity = liability.dueAt <= asOf ? 0n : liability.dueAt - asOf;
        return Object.freeze({
            id: liability.id,
            market: liability.market,
            amount: liability.amount,
            probable,
            stressAddon,
            stressed,
            dueWithinHorizon,
            secondsToMaturity,
        });
    }

    private concentration(
        liabilities: readonly LiabilityStressResult[],
        totalStressedOutflow: bigint,
    ): MarketConcentration[] {
        const totals = new Map<MarketId, bigint>();
        for (const liability of liabilities) {
            totals.set(liability.market, (totals.get(liability.market) ?? 0n) + liability.stressed);
        }
        return [...totals.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([market, stressedOutflow]) => {
                const shareBps =
                    totalStressedOutflow === 0n
                        ? 0n
                        : ratioBps(stressedOutflow, totalStressedOutflow);
                return Object.freeze({
                    market,
                    stressedOutflow,
                    shareBps,
                    hhiContributionBps: hhiContribution(shareBps),
                });
            });
    }
}
