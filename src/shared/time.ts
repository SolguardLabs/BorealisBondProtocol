import { assertProtocol } from "./errors.js";

export type Timestamp = bigint & { readonly __brand: "Timestamp" };

export function timestamp(value: bigint | number): Timestamp {
    const converted = typeof value === "bigint" ? value : BigInt(value);
    assertProtocol(converted >= 0n, "VALIDATION_FAILED", "timestamp cannot be negative", {
        value: converted,
    });
    return converted as Timestamp;
}

export function seconds(value: number): bigint {
    assertProtocol(Number.isInteger(value) && value >= 0, "VALIDATION_FAILED", "invalid seconds", {
        value,
    });
    return BigInt(value);
}

export function days(value: number): bigint {
    return seconds(value) * 86_400n;
}

export interface Clock {
    now(): Timestamp;
}

export class ManualClock implements Clock {
    private current: Timestamp;

    constructor(initial: bigint | number = 0n) {
        this.current = timestamp(initial);
    }

    now(): Timestamp {
        return this.current;
    }

    set(next: bigint | number): Timestamp {
        const converted = timestamp(next);
        assertProtocol(
            converted >= this.current,
            "CLOCK_REGRESSION",
            "clock cannot move backward",
            {
                current: this.current,
                next: converted,
            },
        );
        this.current = converted;
        return this.current;
    }

    advance(delta: bigint | number): Timestamp {
        const converted = typeof delta === "bigint" ? delta : BigInt(delta);
        assertProtocol(converted >= 0n, "CLOCK_REGRESSION", "clock delta cannot be negative", {
            delta: converted,
        });
        return this.set(this.current + converted);
    }
}

export interface TimeWindow {
    readonly startsAt: Timestamp;
    readonly endsAt: Timestamp;
}

export function createWindow(startsAt: bigint | number, duration: bigint | number): TimeWindow {
    const start = timestamp(startsAt);
    const length = typeof duration === "bigint" ? duration : BigInt(duration);
    assertProtocol(length > 0n, "INVALID_SCHEDULE", "window duration must be positive", { length });
    return Object.freeze({ startsAt: start, endsAt: timestamp(start + length) });
}

export function contains(window: TimeWindow, now: Timestamp): boolean {
    return now >= window.startsAt && now < window.endsAt;
}

export function elapsedWithin(window: TimeWindow, now: Timestamp): bigint {
    if (now <= window.startsAt) {
        return 0n;
    }
    if (now >= window.endsAt) {
        return window.endsAt - window.startsAt;
    }
    return now - window.startsAt;
}

export function remainingWithin(window: TimeWindow, now: Timestamp): bigint {
    if (now >= window.endsAt) {
        return 0n;
    }
    if (now <= window.startsAt) {
        return window.endsAt - window.startsAt;
    }
    return window.endsAt - now;
}
