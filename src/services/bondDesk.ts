import { mulDiv, WAD } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import { IdSequence, type AccountId, type MarketId, type PositionId } from "../shared/ids.js";
import type { Clock, Timestamp } from "../shared/time.js";
import { EventLog } from "../shared/events.js";
import type { AccountRegistry } from "../domain/accounts.js";
import type { AssetRegistry } from "../domain/assets.js";
import type { BondPosition, BondQuote, MarketConfig, MarketState } from "../domain/bonds.js";
import { instantiateSchedule } from "../domain/vesting.js";
import { quoteBond, validateQuote, computePriceMove } from "../pricing/market.js";
import type { Treasury } from "../accounting/treasury.js";
import {
    DEFAULT_PURCHASE_POLICY,
    type PurchasePolicy,
    assertRiskAccepted,
    validateMarketConfig,
} from "../validation/rules.js";
import { PositionBook } from "./positionBook.js";

export interface PurchaseRequest {
    readonly buyer: AccountId;
    readonly market: MarketId;
    readonly reserveIn: bigint;
    readonly minPayout?: bigint;
    readonly quote?: BondQuote;
}

export interface PurchaseReceipt {
    readonly position: PositionId;
    readonly reserveIn: bigint;
    readonly payoutOut: bigint;
    readonly discountBps: bigint;
    readonly startsAt: Timestamp;
    readonly endsAt: Timestamp;
}

export class BondDesk {
    readonly book: PositionBook;
    private readonly ids = new IdSequence();
    private readonly policy: PurchasePolicy;

    constructor(
        private readonly clock: Clock,
        private readonly accounts: AccountRegistry,
        private readonly assets: AssetRegistry,
        private readonly treasury: Treasury,
        private readonly events: EventLog,
        book = new PositionBook(),
        policy: PurchasePolicy = DEFAULT_PURCHASE_POLICY,
    ) {
        this.book = book;
        this.policy = policy;
    }

    createMarket(config: MarketConfig): MarketState {
        const normalized = validateMarketConfig(config, this.policy);
        this.assets.requireKind(normalized.reserveAsset, "reserve");
        this.assets.requireKind(normalized.payoutAsset, "payout");
        const now = this.clock.now();
        assertProtocol(
            now <= normalized.openingTime,
            "INVALID_MARKET_STATE",
            "market opens in the past",
            {
                now,
                openingTime: normalized.openingTime,
            },
        );
        const market = Object.freeze({
            config: normalized,
            status: "active" as const,
            soldReserve: 0n,
            soldPayout: 0n,
            priceIndex: WAD,
            lastPrice: normalized.basePrice,
            updatedAt: now,
        });
        this.book.addMarket(market);
        this.events.push({
            name: "market.created",
            at: now,
            market: normalized.id,
            reserveAsset: normalized.reserveAsset,
            payoutAsset: normalized.payoutAsset,
        });
        return market;
    }

    quote(buyer: AccountId, marketId: MarketId, reserveIn: bigint, minPayout?: bigint): BondQuote {
        const account = this.accounts.requireRole(buyer, "buyer");
        assertRiskAccepted(account.riskTier, this.policy);
        const market = this.book.getMarket(marketId);
        const now = this.clock.now();
        const reserveAsset = this.assets.get(market.config.reserveAsset);
        const payoutAsset = this.assets.get(market.config.payoutAsset);
        const quoteRequest = {
            market,
            buyer,
            reserveIn,
            now,
            reserveDecimals: reserveAsset.decimals,
            payoutDecimals: payoutAsset.decimals,
            ...(minPayout === undefined ? {} : { minPayout }),
        };
        const quote = quoteBond(quoteRequest);
        this.events.push({
            name: "bond.quoted",
            at: now,
            market: marketId,
            buyer,
            reserveIn,
            payoutOut: quote.payoutOut,
            discountBps: quote.discountBps,
        });
        return quote;
    }

    purchase(request: PurchaseRequest): PurchaseReceipt {
        const account = this.accounts.requireRole(request.buyer, "buyer");
        assertRiskAccepted(account.riskTier, this.policy);
        const market = this.book.getMarket(request.market);
        const now = this.clock.now();
        const quote =
            request.quote ??
            this.quote(request.buyer, request.market, request.reserveIn, request.minPayout);
        validateQuote(market, quote, request.buyer, request.reserveIn, now);
        this.treasury.depositReserve(
            request.buyer,
            market.config.reserveAsset,
            request.reserveIn,
            now,
        );
        const schedule = instantiateSchedule(now, market.config.vesting);
        const positionId = this.ids.nextPosition(market.config.id, request.buyer);
        const position: BondPosition = Object.freeze({
            id: positionId,
            market: market.config.id,
            owner: request.buyer,
            reserveAsset: market.config.reserveAsset,
            payoutAsset: market.config.payoutAsset,
            reservePaid: request.reserveIn,
            payoutTotal: quote.payoutOut,
            openedAt: now,
            purchasePrice: quote.discountedPrice,
            purchaseIndex: market.priceIndex,
            claimedIndexUnits: 0n,
            schedule,
            status: "vesting",
        });
        this.book.addPosition(position);
        this.treasury.openLiability(
            position.id,
            request.buyer,
            position.payoutAsset,
            position.payoutTotal,
            now,
        );
        this.book.updateMarket(market.config.id, {
            soldReserve: market.soldReserve + request.reserveIn,
            soldPayout: market.soldPayout + quote.payoutOut,
        });
        this.events.push({
            name: "bond.purchased",
            at: now,
            market: market.config.id,
            buyer: request.buyer,
            position: position.id,
            reserveIn: request.reserveIn,
            payoutOut: position.payoutTotal,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
        });
        return Object.freeze({
            position: position.id,
            reserveIn: request.reserveIn,
            payoutOut: position.payoutTotal,
            discountBps: quote.discountBps,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
        });
    }

    updateMarketPrice(marketId: MarketId, newPrice: bigint, reason = "keeper update"): MarketState {
        this.accounts.list("keeper");
        const market = this.book.getMarket(marketId);
        const now = this.clock.now();
        const move = computePriceMove(market.lastPrice, market.priceIndex, newPrice);
        const next = this.book.updateMarket(marketId, {
            lastPrice: newPrice,
            priceIndex: move.newIndex,
            updatedAt: now,
        });
        this.events.push({
            name: "market.price_updated",
            at: now,
            market: marketId,
            oldIndex: move.oldIndex,
            newIndex: move.newIndex,
            oldPrice: move.oldPrice,
            newPrice: move.newPrice,
        });
        void reason;
        return next;
    }

    pauseMarket(marketId: MarketId, reason: string): MarketState {
        const now = this.clock.now();
        const market = this.book.updateMarket(marketId, { status: "paused", updatedAt: now });
        this.events.push({ name: "market.paused", at: now, market: marketId, reason });
        return market;
    }

    resumeMarket(marketId: MarketId, reason: string): MarketState {
        const now = this.clock.now();
        const market = this.book.updateMarket(marketId, { status: "active", updatedAt: now });
        this.events.push({ name: "market.resumed", at: now, market: marketId, reason });
        return market;
    }

    previewPayout(reserveIn: bigint, price: bigint): bigint {
        return mulDiv(reserveIn, WAD, price);
    }
}
