import { formatUnits } from "../shared/amount.js";
import type { AccountId, AssetId, MarketId } from "../shared/ids.js";
import type { AssetRegistry } from "../domain/assets.js";
import type { BondPosition, MarketState } from "../domain/bonds.js";
import { snapshotPosition } from "../domain/bonds.js";
import { vestingState } from "../domain/vesting.js";
import type { Treasury } from "../accounting/treasury.js";
import type { PositionBook } from "../services/positionBook.js";
import { indexUnitsToNominal } from "../services/claimEngine.js";
import type { Timestamp } from "../shared/time.js";

export interface MarketReport {
    readonly market: MarketId;
    readonly name: string;
    readonly status: string;
    readonly reserveSymbol: string;
    readonly payoutSymbol: string;
    readonly soldReserve: string;
    readonly soldPayout: string;
    readonly reserveCapacityRemaining: string;
    readonly payoutCapacityRemaining: string;
    readonly priceIndex: string;
    readonly lastPrice: string;
    readonly openPositions: number;
}

export interface PositionReport {
    readonly id: string;
    readonly market: string;
    readonly owner: string;
    readonly status: string;
    readonly reservePaid: string;
    readonly payoutTotal: string;
    readonly vested: string;
    readonly claimed: string;
    readonly claimable: string;
    readonly startsAt: string;
    readonly endsAt: string;
}

export interface AccountReport {
    readonly account: AccountId;
    readonly balances: readonly {
        readonly asset: AssetId;
        readonly symbol: string;
        readonly wallet: string;
    }[];
    readonly positions: readonly PositionReport[];
}

function amountText(registry: AssetRegistry, asset: AssetId, value: bigint): string {
    const config = registry.get(asset);
    return `${formatUnits(value, config.decimals, Math.min(config.decimals, 6))} ${config.symbol}`;
}

function rawRatioText(value: bigint): string {
    return formatUnits(value, 18, 8);
}

export class ProtocolLens {
    constructor(
        private readonly assets: AssetRegistry,
        private readonly book: PositionBook,
        private readonly treasury: Treasury,
    ) {}

    market(marketId: MarketId): MarketReport {
        const market = this.book.getMarket(marketId);
        return this.marketFromState(market);
    }

    markets(): readonly MarketReport[] {
        return this.book.allMarkets().map((market) => this.marketFromState(market));
    }

    position(position: BondPosition, now: Timestamp): PositionReport {
        const market = this.book.getMarket(position.market);
        const state = vestingState(position.schedule, position.payoutTotal, now);
        const claimed = indexUnitsToNominal(position.claimedIndexUnits, market.priceIndex);
        const claimable = state.vested > claimed ? state.vested - claimed : 0n;
        const snapshot = snapshotPosition(position);
        return Object.freeze({
            id: snapshot.id,
            market: snapshot.market,
            owner: snapshot.owner,
            status: snapshot.status,
            reservePaid: amountText(this.assets, position.reserveAsset, position.reservePaid),
            payoutTotal: amountText(this.assets, position.payoutAsset, position.payoutTotal),
            vested: amountText(this.assets, position.payoutAsset, state.vested),
            claimed: amountText(this.assets, position.payoutAsset, claimed),
            claimable: amountText(this.assets, position.payoutAsset, claimable),
            startsAt: snapshot.startsAt.toString(),
            endsAt: snapshot.endsAt.toString(),
        });
    }

    account(account: AccountId, now: Timestamp): AccountReport {
        const balances = this.assets.list().map((asset) =>
            Object.freeze({
                asset: asset.id,
                symbol: asset.symbol,
                wallet: amountText(
                    this.assets,
                    asset.id,
                    this.treasury.walletBalance(account, asset.id),
                ),
            }),
        );
        const positions = this.book
            .positionsFor(account)
            .map((position) => this.position(position, now));
        return Object.freeze({
            account,
            balances: Object.freeze(balances),
            positions: Object.freeze(positions),
        });
    }

    private marketFromState(market: MarketState): MarketReport {
        const reserve = this.assets.get(market.config.reserveAsset);
        const payout = this.assets.get(market.config.payoutAsset);
        return Object.freeze({
            market: market.config.id,
            name: market.config.name,
            status: market.status,
            reserveSymbol: reserve.symbol,
            payoutSymbol: payout.symbol,
            soldReserve: amountText(this.assets, reserve.id, market.soldReserve),
            soldPayout: amountText(this.assets, payout.id, market.soldPayout),
            reserveCapacityRemaining: amountText(
                this.assets,
                reserve.id,
                market.config.limits.capacityReserve - market.soldReserve,
            ),
            payoutCapacityRemaining: amountText(
                this.assets,
                payout.id,
                market.config.limits.capacityPayout - market.soldPayout,
            ),
            priceIndex: rawRatioText(market.priceIndex),
            lastPrice: rawRatioText(market.lastPrice),
            openPositions: this.book
                .positionsInMarket(market.config.id)
                .filter((position) => position.status === "vesting").length,
        });
    }
}
