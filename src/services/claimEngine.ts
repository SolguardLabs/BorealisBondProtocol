import { checkedSub, min, mulDiv, WAD } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import type { AccountId, PositionId } from "../shared/ids.js";
import type { Clock, Timestamp } from "../shared/time.js";
import type { EventLog } from "../shared/events.js";
import type { Treasury } from "../accounting/treasury.js";
import type { BondPosition, MarketState } from "../domain/bonds.js";
import { vestingState } from "../domain/vesting.js";
import type { PositionBook } from "./positionBook.js";

export interface ClaimPreview {
    readonly position: PositionId;
    readonly owner: AccountId;
    readonly at: Timestamp;
    readonly vestedNominal: bigint;
    readonly claimedNominal: bigint;
    readonly claimable: bigint;
    readonly marketIndex: bigint;
    readonly complete: boolean;
}

export interface ClaimReceipt extends ClaimPreview {
    readonly paid: bigint;
    readonly remainingNominal: bigint;
    readonly status: "vesting" | "claimed";
}

export function nominalToIndexUnits(nominal: bigint, index: bigint): bigint {
    assertProtocol(index > 0n, "INVALID_PRICE", "index must be positive", { index });
    return mulDiv(nominal, index, WAD);
}

export function indexUnitsToNominal(units: bigint, index: bigint): bigint {
    assertProtocol(index > 0n, "INVALID_PRICE", "index must be positive", { index });
    return mulDiv(units, WAD, index);
}

function requireClaimable(position: BondPosition, owner: AccountId): void {
    assertProtocol(position.owner === owner, "AUTHORIZATION_FAILED", "position owner mismatch", {
        position: position.id,
        expected: position.owner,
        actual: owner,
    });
    assertProtocol(position.status === "vesting", "POSITION_CLOSED", "position is not claimable", {
        position: position.id,
        status: position.status,
    });
}

export class ClaimEngine {
    constructor(
        private readonly clock: Clock,
        private readonly book: PositionBook,
        private readonly treasury: Treasury,
        private readonly events: EventLog,
    ) {}

    preview(owner: AccountId, positionId: PositionId): ClaimPreview {
        const position = this.book.getPosition(positionId);
        requireClaimable(position, owner);
        const market = this.book.getMarket(position.market);
        const now = this.clock.now();
        return this.previewWithMarket(position, market, now);
    }

    claim(owner: AccountId, positionId: PositionId, maxAmount?: bigint): ClaimReceipt {
        const position = this.book.getPosition(positionId);
        requireClaimable(position, owner);
        const market = this.book.getMarket(position.market);
        const now = this.clock.now();
        const preview = this.previewWithMarket(position, market, now);
        assertProtocol(preview.claimable > 0n, "VESTING_NOT_STARTED", "nothing claimable", {
            position: positionId,
        });
        const paid =
            maxAmount === undefined ? preview.claimable : min(maxAmount, preview.claimable);
        assertProtocol(paid > 0n, "AMOUNT_NOT_POSITIVE", "claim amount must be positive", { paid });
        const nextClaimedIndexUnits =
            position.claimedIndexUnits + nominalToIndexUnits(paid, market.priceIndex);
        const nextClaimedNominal = indexUnitsToNominal(nextClaimedIndexUnits, market.priceIndex);
        const status =
            preview.complete && nextClaimedNominal >= position.payoutTotal ? "claimed" : "vesting";
        const remainingNominal =
            nextClaimedNominal >= position.payoutTotal
                ? 0n
                : checkedSub(position.payoutTotal, nextClaimedNominal, "position payout");
        this.treasury.releasePayout(owner, position.payoutAsset, paid, now);
        const liability = this.treasury.requireLiability(position.id);
        if (!liability.closed) {
            this.treasury.reduceLiability(position.id, min(paid, liability.amount));
        }
        this.book.updatePosition(position.id, {
            claimedIndexUnits: nextClaimedIndexUnits,
            status,
            ...(status === "claimed" ? { closedAt: now } : {}),
        });
        this.events.push({
            name: "bond.claimed",
            at: now,
            market: position.market,
            owner,
            position: position.id,
            payout: paid,
            remainingNominal,
        });
        return Object.freeze({
            ...preview,
            paid,
            remainingNominal,
            status,
        });
    }

    private previewWithMarket(
        position: BondPosition,
        market: MarketState,
        now: Timestamp,
    ): ClaimPreview {
        const state = vestingState(position.schedule, position.payoutTotal, now);
        const claimedNominal = indexUnitsToNominal(position.claimedIndexUnits, market.priceIndex);
        const claimable = state.vested <= claimedNominal ? 0n : state.vested - claimedNominal;
        return Object.freeze({
            position: position.id,
            owner: position.owner,
            at: now,
            vestedNominal: state.vested,
            claimedNominal,
            claimable,
            marketIndex: market.priceIndex,
            complete: state.complete,
        });
    }
}
