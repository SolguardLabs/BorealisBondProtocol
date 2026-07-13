import { checkedSub, mulDiv, mulDivUp } from "../shared/amount.js";
import { assertProtocol } from "../shared/errors.js";
import type { Timestamp, TimeWindow } from "../shared/time.js";
import { createWindow, elapsedWithin, remainingWithin, timestamp } from "../shared/time.js";

export type VestingMode = "linear" | "cliff-linear";

export interface VestingTemplate {
    readonly mode: VestingMode;
    readonly cliff: bigint;
    readonly duration: bigint;
    readonly cancellationPenaltyBps: bigint;
}

export interface VestingSchedule extends TimeWindow {
    readonly mode: VestingMode;
    readonly cliffEndsAt: Timestamp;
    readonly cancellationPenaltyBps: bigint;
}

export interface VestingState {
    readonly total: bigint;
    readonly vested: bigint;
    readonly unvested: bigint;
    readonly elapsed: bigint;
    readonly remaining: bigint;
    readonly complete: boolean;
}

export function createTemplate(input: Partial<VestingTemplate> = {}): VestingTemplate {
    const mode = input.mode ?? "linear";
    const cliff = input.cliff ?? 0n;
    const duration = input.duration ?? 7n * 86_400n;
    const cancellationPenaltyBps = input.cancellationPenaltyBps ?? 250n;
    assertProtocol(mode === "linear" || mode === "cliff-linear", "INVALID_SCHEDULE", "bad mode", {
        mode,
    });
    assertProtocol(duration > 0n, "INVALID_SCHEDULE", "duration must be positive", { duration });
    assertProtocol(cliff >= 0n && cliff < duration, "INVALID_SCHEDULE", "invalid cliff", {
        cliff,
        duration,
    });
    assertProtocol(
        cancellationPenaltyBps >= 0n && cancellationPenaltyBps <= 10_000n,
        "INVALID_SCHEDULE",
        "invalid cancellation penalty",
        { cancellationPenaltyBps },
    );
    return Object.freeze({ mode, cliff, duration, cancellationPenaltyBps });
}

export function instantiateSchedule(start: Timestamp, template: VestingTemplate): VestingSchedule {
    const window = createWindow(start, template.duration);
    return Object.freeze({
        ...window,
        mode: template.mode,
        cliffEndsAt: timestamp(start + template.cliff),
        cancellationPenaltyBps: template.cancellationPenaltyBps,
    });
}

export function vestedAmount(schedule: VestingSchedule, total: bigint, now: Timestamp): bigint {
    assertProtocol(total >= 0n, "VALIDATION_FAILED", "vesting total cannot be negative", { total });
    if (now <= schedule.startsAt) {
        return 0n;
    }
    if (now >= schedule.endsAt) {
        return total;
    }
    if (schedule.mode === "cliff-linear" && now < schedule.cliffEndsAt) {
        return 0n;
    }
    const elapsed = elapsedWithin(schedule, now);
    const duration = schedule.endsAt - schedule.startsAt;
    return mulDiv(total, elapsed, duration);
}

export function vestedAmountUp(schedule: VestingSchedule, total: bigint, now: Timestamp): bigint {
    if (now <= schedule.startsAt) {
        return 0n;
    }
    if (now >= schedule.endsAt) {
        return total;
    }
    if (schedule.mode === "cliff-linear" && now < schedule.cliffEndsAt) {
        return 0n;
    }
    const elapsed = elapsedWithin(schedule, now);
    const duration = schedule.endsAt - schedule.startsAt;
    return mulDivUp(total, elapsed, duration);
}

export function vestingState(
    schedule: VestingSchedule,
    total: bigint,
    now: Timestamp,
): VestingState {
    const vested = vestedAmount(schedule, total, now);
    const unvested = checkedSub(total, vested, "vesting total");
    const elapsed = elapsedWithin(schedule, now);
    const remaining = remainingWithin(schedule, now);
    return Object.freeze({
        total,
        vested,
        unvested,
        elapsed,
        remaining,
        complete: now >= schedule.endsAt,
    });
}

export function cancellationRefund(
    schedule: VestingSchedule,
    reservePaid: bigint,
    payoutTotal: bigint,
    claimedNominal: bigint,
    now: Timestamp,
): bigint {
    const state = vestingState(schedule, payoutTotal, now);
    if (state.unvested === 0n) {
        return 0n;
    }
    const unclaimed = checkedSub(payoutTotal, claimedNominal, "payout total");
    const refundableWeight = state.unvested > unclaimed ? unclaimed : state.unvested;
    const beforePenalty = mulDiv(reservePaid, refundableWeight, payoutTotal);
    const retained = mulDiv(beforePenalty, schedule.cancellationPenaltyBps, 10_000n);
    return checkedSub(beforePenalty, retained, "refund");
}

export function nextVestingCheckpoint(
    schedule: VestingSchedule,
    parts: number,
    index: number,
): Timestamp {
    assertProtocol(
        parts > 0 && index >= 0 && index <= parts,
        "INVALID_SCHEDULE",
        "bad checkpoint",
        {
            parts,
            index,
        },
    );
    const duration = schedule.endsAt - schedule.startsAt;
    return timestamp(schedule.startsAt + (duration * BigInt(index)) / BigInt(parts));
}
