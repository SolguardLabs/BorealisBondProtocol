export type ErrorCode =
    | "ACCOUNT_NOT_FOUND"
    | "AMOUNT_NOT_POSITIVE"
    | "ASSET_ALREADY_REGISTERED"
    | "ASSET_NOT_FOUND"
    | "AUTHORIZATION_FAILED"
    | "BALANCE_TOO_LOW"
    | "CLOCK_REGRESSION"
    | "INVALID_CONFIGURATION"
    | "INVALID_DISCOUNT"
    | "INVALID_MARKET_STATE"
    | "INVALID_PRICE"
    | "INVALID_SCHEDULE"
    | "LEDGER_IMBALANCE"
    | "MARKET_CAP_REACHED"
    | "MARKET_NOT_FOUND"
    | "MARKET_PAUSED"
    | "POSITION_CLOSED"
    | "POSITION_NOT_FOUND"
    | "QUOTE_EXPIRED"
    | "RESERVE_LIMIT"
    | "SLIPPAGE_LIMIT"
    | "TREASURY_INSUFFICIENT"
    | "UNSUPPORTED_ASSET"
    | "VALIDATION_FAILED"
    | "VESTING_NOT_STARTED";

export interface ErrorContext {
    readonly [key: string]: string | number | bigint | boolean | undefined;
}

export class BorealisError extends Error {
    readonly code: ErrorCode;
    readonly context: ErrorContext;

    constructor(code: ErrorCode, message: string, context: ErrorContext = {}) {
        super(message);
        this.name = "BorealisError";
        this.code = code;
        this.context = Object.freeze({ ...context });
    }
}

export function fail(code: ErrorCode, message: string, context: ErrorContext = {}): never {
    throw new BorealisError(code, message, context);
}

export function assertProtocol(
    condition: unknown,
    code: ErrorCode,
    message: string,
    context: ErrorContext = {},
): asserts condition {
    if (!condition) {
        fail(code, message, context);
    }
}

export function assertPositive(value: bigint, label: string): void {
    assertProtocol(value > 0n, "AMOUNT_NOT_POSITIVE", `${label} must be positive`, {
        value,
    });
}

export function assertNonNegative(value: bigint, label: string): void {
    assertProtocol(value >= 0n, "VALIDATION_FAILED", `${label} must not be negative`, {
        value,
    });
}

export function assertWithin(value: bigint, min: bigint, max: bigint, label: string): void {
    assertProtocol(value >= min && value <= max, "VALIDATION_FAILED", `${label} is out of range`, {
        value,
        min,
        max,
    });
}

export function isBorealisError(error: unknown, code?: ErrorCode): error is BorealisError {
    if (!(error instanceof BorealisError)) {
        return false;
    }
    return code === undefined || error.code === code;
}

export function describeError(error: unknown): string {
    if (error instanceof BorealisError) {
        const entries = Object.entries(error.context)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${String(value)}`);
        return entries.length === 0
            ? `${error.code}: ${error.message}`
            : `${error.code}: ${error.message} (${entries.join(", ")})`;
    }
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}
