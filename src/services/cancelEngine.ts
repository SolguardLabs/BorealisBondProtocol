import { checkedSub, min } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import type { AccountId, PositionId } from "../shared/ids.js";
import type { Clock } from "../shared/time.js";
import type { EventLog } from "../shared/events.js";
import type { Treasury } from "../accounting/treasury.js";
import { cancellationRefund, vestingState } from "../domain/vesting.js";
import type { PositionBook } from "./positionBook.js";
import { indexUnitsToNominal } from "./claimEngine.js";

export interface CancellationPreview {
    readonly position: PositionId;
    readonly owner: AccountId;
    readonly claimedNominal: bigint;
    readonly vestedNominal: bigint;
    readonly unvestedNominal: bigint;
    readonly refundReserve: bigint;
    readonly retainedReserve: bigint;
    readonly forfeitedPayout: bigint;
}

export interface CancellationReceipt extends CancellationPreview {
    readonly status: "cancelled";
}

export class CancelEngine {
    constructor(
        private readonly clock: Clock,
        private readonly book: PositionBook,
        private readonly treasury: Treasury,
        private readonly events: EventLog,
    ) {}

    preview(owner: AccountId, positionId: PositionId): CancellationPreview {
        const position = this.book.requireOwner(positionId, owner);
        assertProtocol(
            position.status === "vesting",
            "POSITION_CLOSED",
            "position cannot be cancelled",
            {
                position: positionId,
                status: position.status,
            },
        );
        const market = this.book.getMarket(position.market);
        const now = this.clock.now();
        const claimedNominal = indexUnitsToNominal(position.claimedIndexUnits, market.priceIndex);
        const state = vestingState(position.schedule, position.payoutTotal, now);
        const refundReserve = cancellationRefund(
            position.schedule,
            position.reservePaid,
            position.payoutTotal,
            min(claimedNominal, position.payoutTotal),
            now,
        );
        const retainedReserve = checkedSub(position.reservePaid, refundReserve, "reserve paid");
        const unclaimedNominal =
            claimedNominal >= position.payoutTotal
                ? 0n
                : checkedSub(position.payoutTotal, claimedNominal, "position payout");
        const vestedUnclaimed = state.vested > claimedNominal ? state.vested - claimedNominal : 0n;
        const forfeitedPayout = checkedSub(unclaimedNominal, vestedUnclaimed, "unclaimed payout");
        return Object.freeze({
            position: position.id,
            owner,
            claimedNominal,
            vestedNominal: state.vested,
            unvestedNominal: state.unvested,
            refundReserve,
            retainedReserve,
            forfeitedPayout,
        });
    }

    cancel(owner: AccountId, positionId: PositionId): CancellationReceipt {
        const position = this.book.requireOwner(positionId, owner);
        const now = this.clock.now();
        const preview = this.preview(owner, positionId);
        this.treasury.refundReserve(owner, position.reserveAsset, preview.refundReserve, now);
        this.treasury.moveReserveToRevenue(position.reserveAsset, preview.retainedReserve, now);
        this.treasury.closeLiability(position.id);
        this.book.updatePosition(position.id, {
            status: "cancelled",
            cancelledAt: now,
            closedAt: now,
        });
        this.events.push({
            name: "bond.cancelled",
            at: now,
            market: position.market,
            owner,
            position: position.id,
            refund: preview.refundReserve,
            forfeitedPayout: preview.forfeitedPayout,
        });
        return Object.freeze({ ...preview, status: "cancelled" as const });
    }
}
