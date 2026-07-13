import { AccountRegistry, type AccountRegistration } from "../domain/accounts.js";
import { AssetRegistry, type AssetRegistration } from "../domain/assets.js";
import type { BondQuote, MarketConfig, MarketState } from "../domain/bonds.js";
import { EventLog } from "../shared/events.js";
import type { AccountId, AssetId, MarketId, PositionId } from "../shared/ids.js";
import { ManualClock, type Timestamp } from "../shared/time.js";
import { Treasury } from "../accounting/treasury.js";
import { BondDesk, type PurchaseReceipt, type PurchaseRequest } from "./bondDesk.js";
import { ClaimEngine, type ClaimPreview, type ClaimReceipt } from "./claimEngine.js";
import {
    CancelEngine,
    type CancellationPreview,
    type CancellationReceipt,
} from "./cancelEngine.js";
import { ProtocolLens, type AccountReport, type MarketReport } from "../lens/reports.js";

export interface BorealisModules {
    readonly accounts: AccountRegistry;
    readonly assets: AssetRegistry;
    readonly treasury: Treasury;
    readonly events: EventLog;
    readonly clock: ManualClock;
    readonly desk: BondDesk;
    readonly claims: ClaimEngine;
    readonly cancellations: CancelEngine;
    readonly lens: ProtocolLens;
}

export class BorealisBondProtocol {
    readonly accounts: AccountRegistry;
    readonly assets: AssetRegistry;
    readonly treasury: Treasury;
    readonly events: EventLog;
    readonly clock: ManualClock;
    readonly desk: BondDesk;
    readonly claims: ClaimEngine;
    readonly cancellations: CancelEngine;
    readonly lens: ProtocolLens;

    constructor(initialTime: bigint | number = 0n) {
        this.clock = new ManualClock(initialTime);
        this.accounts = new AccountRegistry();
        this.assets = new AssetRegistry();
        this.treasury = new Treasury();
        this.events = new EventLog();
        this.desk = new BondDesk(
            this.clock,
            this.accounts,
            this.assets,
            this.treasury,
            this.events,
        );
        this.claims = new ClaimEngine(this.clock, this.desk.book, this.treasury, this.events);
        this.cancellations = new CancelEngine(
            this.clock,
            this.desk.book,
            this.treasury,
            this.events,
        );
        this.lens = new ProtocolLens(this.assets, this.desk.book, this.treasury);
    }

    modules(): BorealisModules {
        return Object.freeze({
            accounts: this.accounts,
            assets: this.assets,
            treasury: this.treasury,
            events: this.events,
            clock: this.clock,
            desk: this.desk,
            claims: this.claims,
            cancellations: this.cancellations,
            lens: this.lens,
        });
    }

    now(): Timestamp {
        return this.clock.now();
    }

    advance(seconds: bigint | number): Timestamp {
        return this.clock.advance(seconds);
    }

    setTime(next: bigint | number): Timestamp {
        return this.clock.set(next);
    }

    registerAccount(input: AccountRegistration): void {
        const account = this.accounts.register(input);
        this.events.push({
            name: "account.registered",
            at: this.now(),
            account: account.id,
            label: account.label,
        });
    }

    registerAsset(input: AssetRegistration): void {
        const asset = this.assets.register(input);
        this.events.push({
            name: "asset.registered",
            at: this.now(),
            asset: asset.id,
            symbol: asset.symbol,
            decimals: asset.decimals,
        });
    }

    fundWallet(account: AccountId, asset: AssetId, amount: bigint): void {
        this.accounts.get(account);
        this.assets.requireActive(asset);
        this.treasury.mintWallet(account, asset, amount, this.now());
        this.events.push({
            name: "treasury.deposited",
            at: this.now(),
            account,
            asset,
            amount,
        });
    }

    fundEmission(asset: AssetId, amount: bigint): void {
        this.assets.requireKind(asset, "payout");
        this.treasury.fundEmission(asset, amount, this.now());
    }

    fundReserve(asset: AssetId, amount: bigint): void {
        this.assets.requireKind(asset, "reserve");
        this.treasury.fundReserve(asset, amount, this.now());
    }

    createMarket(admin: AccountId, config: MarketConfig): MarketState {
        this.accounts.requireRole(admin, "governance");
        return this.desk.createMarket(config);
    }

    quote(buyer: AccountId, market: MarketId, reserveIn: bigint, minPayout?: bigint): BondQuote {
        return this.desk.quote(buyer, market, reserveIn, minPayout);
    }

    buy(request: PurchaseRequest): PurchaseReceipt {
        return this.desk.purchase(request);
    }

    updateMarketPrice(keeper: AccountId, market: MarketId, newPrice: bigint): MarketState {
        this.accounts.requireRole(keeper, "keeper");
        return this.desk.updateMarketPrice(market, newPrice);
    }

    pauseMarket(governance: AccountId, market: MarketId, reason: string): MarketState {
        this.accounts.requireRole(governance, "governance");
        return this.desk.pauseMarket(market, reason);
    }

    resumeMarket(governance: AccountId, market: MarketId, reason: string): MarketState {
        this.accounts.requireRole(governance, "governance");
        return this.desk.resumeMarket(market, reason);
    }

    previewClaim(owner: AccountId, position: PositionId): ClaimPreview {
        return this.claims.preview(owner, position);
    }

    claim(owner: AccountId, position: PositionId, maxAmount?: bigint): ClaimReceipt {
        return this.claims.claim(owner, position, maxAmount);
    }

    previewCancellation(owner: AccountId, position: PositionId): CancellationPreview {
        return this.cancellations.preview(owner, position);
    }

    cancel(owner: AccountId, position: PositionId): CancellationReceipt {
        return this.cancellations.cancel(owner, position);
    }

    walletBalance(account: AccountId, asset: AssetId): bigint {
        return this.treasury.walletBalance(account, asset);
    }

    reserveBalance(asset: AssetId): bigint {
        return this.treasury.reserveBalance(asset);
    }

    emissionBalance(asset: AssetId): bigint {
        return this.treasury.emissionBalance(asset);
    }

    marketReport(market: MarketId): MarketReport {
        return this.lens.market(market);
    }

    accountReport(account: AccountId): AccountReport {
        return this.lens.account(account, this.now());
    }
}
