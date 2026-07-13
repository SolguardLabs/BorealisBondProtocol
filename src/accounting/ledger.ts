import { checkedSub } from "../shared/amount.js";
import { assertProtocol, fail } from "../shared/errors.js";
import type { AccountId, AssetId } from "../shared/ids.js";
import type { Timestamp } from "../shared/time.js";

export type LedgerSide = "debit" | "credit";
export type LedgerBucket = "wallet" | "reserve-vault" | "emission-vault" | "revenue" | "liability";

export interface LedgerAccount {
    readonly owner: AccountId;
    readonly asset: AssetId;
    readonly bucket: LedgerBucket;
}

export interface LedgerLeg {
    readonly account: LedgerAccount;
    readonly side: LedgerSide;
    readonly amount: bigint;
    readonly memo: string;
}

export interface LedgerEntry {
    readonly id: string;
    readonly at: Timestamp;
    readonly reason: string;
    readonly legs: readonly LedgerLeg[];
}

export interface LedgerBalance {
    readonly account: LedgerAccount;
    readonly balance: bigint;
}

function accountKey(account: LedgerAccount): string {
    return `${account.owner}|${account.asset}|${account.bucket}`;
}

function cloneAccount(account: LedgerAccount): LedgerAccount {
    return Object.freeze({ ...account });
}

export function wallet(owner: AccountId, asset: AssetId): LedgerAccount {
    return Object.freeze({ owner, asset, bucket: "wallet" });
}

export function bucket(owner: AccountId, asset: AssetId, bucketName: LedgerBucket): LedgerAccount {
    return Object.freeze({ owner, asset, bucket: bucketName });
}

export class Ledger {
    private sequence = 0;
    private readonly balances = new Map<string, LedgerBalance>();
    private readonly entries: LedgerEntry[] = [];

    balanceOf(account: LedgerAccount): bigint {
        return this.balances.get(accountKey(account))?.balance ?? 0n;
    }

    requireBalance(account: LedgerAccount, amount: bigint): void {
        const available = this.balanceOf(account);
        if (available < amount) {
            fail("BALANCE_TOO_LOW", "ledger balance too low", {
                owner: account.owner,
                asset: account.asset,
                bucket: account.bucket,
                available,
                required: amount,
            });
        }
    }

    post(at: Timestamp, reason: string, legs: readonly LedgerLeg[]): LedgerEntry {
        assertProtocol(legs.length >= 2, "LEDGER_IMBALANCE", "entry requires at least two legs");
        const totals = new Map<AssetId, bigint>();
        for (const leg of legs) {
            assertProtocol(leg.amount > 0n, "AMOUNT_NOT_POSITIVE", "ledger leg must be positive", {
                amount: leg.amount,
            });
            const sign = leg.side === "debit" ? 1n : -1n;
            totals.set(
                leg.account.asset,
                (totals.get(leg.account.asset) ?? 0n) + sign * leg.amount,
            );
        }
        for (const [asset, total] of totals) {
            assertProtocol(total === 0n, "LEDGER_IMBALANCE", "entry is not balanced", {
                asset,
                total,
            });
        }
        for (const leg of legs) {
            this.applyLeg(leg);
        }
        this.sequence += 1;
        const entry = Object.freeze({
            id: `ledger:${this.sequence}`,
            at,
            reason,
            legs: Object.freeze(
                legs.map((leg) => Object.freeze({ ...leg, account: cloneAccount(leg.account) })),
            ),
        });
        this.entries.push(entry);
        return entry;
    }

    transfer(
        at: Timestamp,
        asset: AssetId,
        from: LedgerAccount,
        to: LedgerAccount,
        amount: bigint,
        reason: string,
    ): LedgerEntry {
        assertProtocol(
            from.asset === asset && to.asset === asset,
            "LEDGER_IMBALANCE",
            "asset mismatch",
            {
                asset,
            },
        );
        this.requireBalance(from, amount);
        return this.post(at, reason, [
            Object.freeze({ account: to, side: "debit", amount, memo: "increase destination" }),
            Object.freeze({ account: from, side: "credit", amount, memo: "decrease source" }),
        ]);
    }

    mint(at: Timestamp, to: LedgerAccount, amount: bigint, reason: string): LedgerEntry {
        assertProtocol(amount > 0n, "AMOUNT_NOT_POSITIVE", "mint amount must be positive", {
            amount,
        });
        return this.post(at, reason, [
            Object.freeze({ account: to, side: "debit", amount, memo: "asset inventory" }),
            Object.freeze({
                account: bucket(to.owner, to.asset, "liability"),
                side: "credit",
                amount,
                memo: "supply offset",
            }),
        ]);
    }

    burn(at: Timestamp, from: LedgerAccount, amount: bigint, reason: string): LedgerEntry {
        this.requireBalance(from, amount);
        return this.post(at, reason, [
            Object.freeze({
                account: bucket(from.owner, from.asset, "liability"),
                side: "debit",
                amount,
                memo: "supply offset",
            }),
            Object.freeze({ account: from, side: "credit", amount, memo: "asset inventory" }),
        ]);
    }

    entriesSince(id?: string): readonly LedgerEntry[] {
        if (id === undefined) {
            return [...this.entries];
        }
        const index = this.entries.findIndex((entry) => entry.id === id);
        return index === -1 ? [] : this.entries.slice(index + 1);
    }

    balancesFor(owner?: AccountId): readonly LedgerBalance[] {
        const values = [...this.balances.values()];
        return owner === undefined
            ? values
            : values.filter((balance) => balance.account.owner === owner);
    }

    private applyLeg(leg: LedgerLeg): void {
        const key = accountKey(leg.account);
        const current = this.balances.get(key)?.balance ?? 0n;
        const next =
            leg.side === "debit"
                ? current + leg.amount
                : leg.account.bucket === "liability"
                  ? current - leg.amount
                  : checkedSub(current, leg.amount);
        this.balances.set(
            key,
            Object.freeze({
                account: cloneAccount(leg.account),
                balance: next,
            }),
        );
    }
}
