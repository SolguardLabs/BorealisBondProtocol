import { checkedSub } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import { accountId, type AccountId, type AssetId, type PositionId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";
import { bucket, Ledger, wallet, type LedgerAccount, type LedgerBalance } from "./ledger.js";

export const TREASURY_RESERVE = accountId("treasury:reserve");
export const TREASURY_EMISSION = accountId("treasury:emission");
export const TREASURY_REVENUE = accountId("treasury:revenue");

export interface LiabilityRecord {
    readonly position: PositionId;
    readonly owner: AccountId;
    readonly asset: AssetId;
    readonly amount: bigint;
    readonly openedAt: Timestamp;
    readonly closed: boolean;
}

export interface TreasurySnapshot {
    readonly reserveBalances: readonly LedgerBalance[];
    readonly emissionBalances: readonly LedgerBalance[];
    readonly revenueBalances: readonly LedgerBalance[];
    readonly liabilities: readonly LiabilityRecord[];
}

function reserveVault(asset: AssetId): LedgerAccount {
    return bucket(TREASURY_RESERVE, asset, "reserve-vault");
}

function emissionVault(asset: AssetId): LedgerAccount {
    return bucket(TREASURY_EMISSION, asset, "emission-vault");
}

function revenueVault(asset: AssetId): LedgerAccount {
    return bucket(TREASURY_REVENUE, asset, "revenue");
}

export class Treasury {
    readonly ledger: Ledger;
    private readonly liabilities = new Map<PositionId, LiabilityRecord>();

    constructor(ledger = new Ledger()) {
        this.ledger = ledger;
    }

    mintWallet(account: AccountId, asset: AssetId, amount: bigint, at: Timestamp): void {
        this.ledger.mint(at, wallet(account, asset), amount, "wallet funding");
    }

    fundEmission(asset: AssetId, amount: bigint, at: Timestamp): void {
        this.ledger.mint(at, emissionVault(asset), amount, "emission funding");
    }

    fundReserve(asset: AssetId, amount: bigint, at: Timestamp): void {
        this.ledger.mint(at, reserveVault(asset), amount, "reserve funding");
    }

    depositReserve(from: AccountId, asset: AssetId, amount: bigint, at: Timestamp): void {
        this.ledger.transfer(
            at,
            asset,
            wallet(from, asset),
            reserveVault(asset),
            amount,
            "reserve deposit",
        );
    }

    refundReserve(to: AccountId, asset: AssetId, amount: bigint, at: Timestamp): void {
        if (amount === 0n) {
            return;
        }
        this.ledger.transfer(
            at,
            asset,
            reserveVault(asset),
            wallet(to, asset),
            amount,
            "reserve refund",
        );
    }

    moveReserveToRevenue(asset: AssetId, amount: bigint, at: Timestamp): void {
        if (amount === 0n) {
            return;
        }
        this.ledger.transfer(
            at,
            asset,
            reserveVault(asset),
            revenueVault(asset),
            amount,
            "reserve revenue sweep",
        );
    }

    releasePayout(to: AccountId, asset: AssetId, amount: bigint, at: Timestamp): void {
        if (amount === 0n) {
            return;
        }
        this.ledger.transfer(
            at,
            asset,
            emissionVault(asset),
            wallet(to, asset),
            amount,
            "payout release",
        );
    }

    burnPayout(asset: AssetId, amount: bigint, at: Timestamp): void {
        if (amount === 0n) {
            return;
        }
        this.ledger.burn(at, emissionVault(asset), amount, "payout burn");
    }

    openLiability(
        position: PositionId,
        owner: AccountId,
        asset: AssetId,
        amount: bigint,
        at: Timestamp,
    ): LiabilityRecord {
        assertProtocol(amount > 0n, "AMOUNT_NOT_POSITIVE", "liability must be positive", {
            amount,
        });
        const record = Object.freeze({
            position,
            owner,
            asset,
            amount,
            openedAt: at,
            closed: false,
        });
        this.liabilities.set(position, record);
        return record;
    }

    reduceLiability(position: PositionId, amount: bigint): LiabilityRecord {
        const current = this.requireLiability(position);
        const nextAmount = checkedSub(current.amount, amount, "liability");
        const next = Object.freeze({ ...current, amount: nextAmount, closed: nextAmount === 0n });
        this.liabilities.set(position, next);
        return next;
    }

    closeLiability(position: PositionId): LiabilityRecord {
        const current = this.requireLiability(position);
        const next = Object.freeze({ ...current, amount: 0n, closed: true });
        this.liabilities.set(position, next);
        return next;
    }

    requireLiability(position: PositionId): LiabilityRecord {
        const liability = this.liabilities.get(position);
        assertProtocol(liability !== undefined, "POSITION_NOT_FOUND", "liability missing", {
            position,
        });
        return liability;
    }

    walletBalance(account: AccountId, asset: AssetId): bigint {
        return this.ledger.balanceOf(wallet(account, asset));
    }

    reserveBalance(asset: AssetId): bigint {
        return this.ledger.balanceOf(reserveVault(asset));
    }

    emissionBalance(asset: AssetId): bigint {
        return this.ledger.balanceOf(emissionVault(asset));
    }

    revenueBalance(asset: AssetId): bigint {
        return this.ledger.balanceOf(revenueVault(asset));
    }

    snapshot(): TreasurySnapshot {
        return Object.freeze({
            reserveBalances: this.ledger.balancesFor(TREASURY_RESERVE),
            emissionBalances: this.ledger.balancesFor(TREASURY_EMISSION),
            revenueBalances: this.ledger.balancesFor(TREASURY_REVENUE),
            liabilities: Object.freeze([...this.liabilities.values()]),
        });
    }
}
