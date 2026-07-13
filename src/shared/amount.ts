import { assertProtocol, fail } from "./errors.js";

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const SECONDS_PER_DAY = 86_400n;

export type AmountInput = bigint | number | string;

export interface Ratio {
    readonly value: bigint;
}

export interface TokenAmount {
    readonly value: bigint;
    readonly decimals: number;
}

export function bn(value: AmountInput): bigint {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number") {
        assertProtocol(
            Number.isInteger(value),
            "VALIDATION_FAILED",
            "number amount must be integer",
            {
                value,
            },
        );
        return BigInt(value);
    }
    if (!/^-?\d+$/.test(value)) {
        fail("VALIDATION_FAILED", "string amount must be a base-10 integer", { value });
    }
    return BigInt(value);
}

export function ratio(value: AmountInput): Ratio {
    const converted = bn(value);
    assertProtocol(converted >= 0n, "VALIDATION_FAILED", "ratio cannot be negative", {
        value: converted,
    });
    return Object.freeze({ value: converted });
}

export function wadFromBps(bps: AmountInput): Ratio {
    const basis = bn(bps);
    assertProtocol(basis >= 0n, "INVALID_DISCOUNT", "basis points cannot be negative", { basis });
    return ratio((basis * WAD) / BPS);
}

export function checkedAdd(a: bigint, b: bigint): bigint {
    const result = a + b;
    assertProtocol(result >= a && result >= b, "VALIDATION_FAILED", "addition overflow guard");
    return result;
}

export function checkedSub(a: bigint, b: bigint, label = "amount"): bigint {
    if (b > a) {
        fail("BALANCE_TOO_LOW", `${label} is below required amount`, {
            available: a,
            required: b,
        });
    }
    return a - b;
}

export function min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
}

export function clamp(value: bigint, lower: bigint, upper: bigint): bigint {
    assertProtocol(lower <= upper, "VALIDATION_FAILED", "invalid clamp interval", { lower, upper });
    return min(max(value, lower), upper);
}

export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
    assertProtocol(denominator > 0n, "VALIDATION_FAILED", "denominator must be positive");
    return (a * b) / denominator;
}

export function mulDivUp(a: bigint, b: bigint, denominator: bigint): bigint {
    assertProtocol(denominator > 0n, "VALIDATION_FAILED", "denominator must be positive");
    const product = a * b;
    return product === 0n ? 0n : (product - 1n) / denominator + 1n;
}

export function ceilDiv(a: bigint, denominator: bigint): bigint {
    assertProtocol(denominator > 0n, "VALIDATION_FAILED", "denominator must be positive");
    return a === 0n ? 0n : (a - 1n) / denominator + 1n;
}

export function applyRatio(value: bigint, r: Ratio | bigint): bigint {
    const ratioValue = typeof r === "bigint" ? r : r.value;
    return mulDiv(value, ratioValue, WAD);
}

export function applyRatioUp(value: bigint, r: Ratio | bigint): bigint {
    const ratioValue = typeof r === "bigint" ? r : r.value;
    return mulDivUp(value, ratioValue, WAD);
}

export function invertRatio(r: Ratio | bigint): Ratio {
    const ratioValue = typeof r === "bigint" ? r : r.value;
    assertProtocol(ratioValue > 0n, "INVALID_PRICE", "ratio cannot be zero");
    return ratio((WAD * WAD) / ratioValue);
}

export function parseUnits(input: string, decimals: number): bigint {
    assertProtocol(decimals >= 0 && decimals <= 36, "VALIDATION_FAILED", "invalid decimals", {
        decimals,
    });
    const normalized = input.trim();
    const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
    assertProtocol(match !== null, "VALIDATION_FAILED", "invalid decimal amount", { input });
    const whole = match[1] ?? "0";
    const fraction = match[2] ?? "";
    assertProtocol(fraction.length <= decimals, "VALIDATION_FAILED", "too many decimal places", {
        input,
        decimals,
    });
    const padded = fraction.padEnd(decimals, "0");
    return BigInt(`${whole}${padded}`.replace(/^0+(?=\d)/, ""));
}

export function formatUnits(value: bigint, decimals: number, precision = decimals): string {
    assertProtocol(decimals >= 0 && decimals <= 36, "VALIDATION_FAILED", "invalid decimals", {
        decimals,
    });
    assertProtocol(
        precision >= 0 && precision <= decimals,
        "VALIDATION_FAILED",
        "invalid precision",
        {
            precision,
            decimals,
        },
    );
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const base = 10n ** BigInt(decimals);
    const whole = absolute / base;
    const fraction = absolute % base;
    if (precision === 0) {
        return `${negative ? "-" : ""}${whole.toString()}`;
    }
    const fractionText = fraction.toString().padStart(decimals, "0").slice(0, precision);
    const trimmed = fractionText.replace(/0+$/, "");
    return trimmed.length === 0
        ? `${negative ? "-" : ""}${whole.toString()}`
        : `${negative ? "-" : ""}${whole.toString()}.${trimmed}`;
}

export function toTokenAmount(value: AmountInput, decimals: number): TokenAmount {
    const converted = bn(value);
    assertProtocol(converted >= 0n, "AMOUNT_NOT_POSITIVE", "token amount cannot be negative", {
        value: converted,
    });
    return Object.freeze({ value: converted, decimals });
}

export function normalizeDecimals(value: bigint, fromDecimals: number, toDecimals: number): bigint {
    assertProtocol(fromDecimals >= 0 && toDecimals >= 0, "VALIDATION_FAILED", "invalid decimals");
    if (fromDecimals === toDecimals) {
        return value;
    }
    if (fromDecimals < toDecimals) {
        return value * 10n ** BigInt(toDecimals - fromDecimals);
    }
    return value / 10n ** BigInt(fromDecimals - toDecimals);
}

export function sum(values: readonly bigint[]): bigint {
    let total = 0n;
    for (const value of values) {
        total += value;
    }
    return total;
}

export function weightedAverage(
    values: readonly { readonly value: bigint; readonly weight: bigint }[],
): bigint {
    let numerator = 0n;
    let denominator = 0n;
    for (const item of values) {
        numerator += item.value * item.weight;
        denominator += item.weight;
    }
    return denominator === 0n ? 0n : numerator / denominator;
}

export function requireSameDecimals(a: TokenAmount, b: TokenAmount): void {
    assertProtocol(a.decimals === b.decimals, "VALIDATION_FAILED", "token decimals mismatch", {
        left: a.decimals,
        right: b.decimals,
    });
}
