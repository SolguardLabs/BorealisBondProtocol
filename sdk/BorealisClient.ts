import { createHash } from "node:crypto";

const ATOMIC_AMOUNT = /^(0|[1-9][0-9]*)$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,95}$/;
const WAD = 10n ** 18n;
const BPS = 10_000n;

export type AtomicAmount = string;

export interface QuoteRequest {
    readonly buyer: string;
    readonly market: string;
    readonly reserveIn: AtomicAmount;
    readonly minPayout?: AtomicAmount;
}

export interface QuoteResponse {
    readonly market: string;
    readonly buyer: string;
    readonly reserveIn: AtomicAmount;
    readonly payoutOut: AtomicAmount;
    readonly discountedPrice: AtomicAmount;
    readonly discountBps: AtomicAmount;
    readonly priceIndex: AtomicAmount;
    readonly expiresAt: string;
}

export interface PurchaseResponse {
    readonly position: string;
    readonly reserveIn: AtomicAmount;
    readonly payoutOut: AtomicAmount;
    readonly discountBps: AtomicAmount;
    readonly startsAt: string;
    readonly endsAt: string;
}

export interface ClaimRequest {
    readonly owner: string;
    readonly position: string;
    readonly maxAmount?: AtomicAmount;
}

export interface ClaimResponse {
    readonly position: string;
    readonly owner: string;
    readonly paid: AtomicAmount;
    readonly remainingNominal: AtomicAmount;
    readonly status: "vesting" | "claimed";
}

export interface CancellationResponse {
    readonly position: string;
    readonly owner: string;
    readonly refund: AtomicAmount;
    readonly penalty: AtomicAmount;
    readonly forfeitedPayout: AtomicAmount;
    readonly status: "cancelled";
}

export interface HealthResponse {
    readonly status: "ok" | "degraded" | "halted";
    readonly version: string;
    readonly network: string;
    readonly stateDigest: string;
}

export interface TransportRequest {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
}

export interface BorealisTransport {
    execute<T>(request: TransportRequest): Promise<T>;
}

export interface HttpTransportOptions {
    readonly baseUrl: string;
    readonly apiKey?: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof globalThis.fetch;
}

export class BorealisClientError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status?: number,
        readonly detail?: unknown,
    ) {
        super(message);
        this.name = "BorealisClientError";
    }
}

export class HttpBorealisTransport implements BorealisTransport {
    readonly #baseUrl: URL;
    readonly #apiKey: string | undefined;
    readonly #timeoutMs: number;
    readonly #fetch: typeof globalThis.fetch;

    constructor(options: HttpTransportOptions) {
        try {
            this.#baseUrl = new URL(options.baseUrl);
        } catch {
            throw new BorealisClientError("INVALID_BASE_URL", "The base URL is invalid.");
        }
        if (!["https:", "http:"].includes(this.#baseUrl.protocol)) {
            throw new BorealisClientError(
                "INVALID_BASE_URL",
                "The base URL must use HTTP or HTTPS.",
            );
        }
        this.#apiKey = options.apiKey;
        this.#timeoutMs = options.timeoutMs ?? 10_000;
        this.#fetch = options.fetch ?? globalThis.fetch;
        if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
            throw new BorealisClientError("INVALID_TIMEOUT", "The timeout must be positive.");
        }
    }

    async execute<T>(request: TransportRequest): Promise<T> {
        const url = new URL(request.path.replace(/^\/+/, ""), this.#baseUrl);
        const headers = new Headers({ accept: "application/json" });
        if (request.body !== undefined) headers.set("content-type", "application/json");
        if (this.#apiKey !== undefined) headers.set("authorization", `Bearer ${this.#apiKey}`);
        if (request.idempotencyKey !== undefined) {
            headers.set("idempotency-key", request.idempotencyKey);
        }
        let response: Response;
        try {
            response = await this.#fetch(url, {
                method: request.method,
                headers,
                signal: AbortSignal.timeout(this.#timeoutMs),
                ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
            });
        } catch (error) {
            throw new BorealisClientError(
                "TRANSPORT_ERROR",
                "The request could not be completed.",
                undefined,
                error,
            );
        }
        const text = await response.text();
        const body = text.length === 0 ? undefined : parseJson(text);
        if (!response.ok) {
            throw new BorealisClientError(
                "REQUEST_REJECTED",
                `Borealis returned HTTP ${response.status}.`,
                response.status,
                body,
            );
        }
        return body as T;
    }
}

export class BorealisClient {
    constructor(private readonly transport: BorealisTransport) {}

    async health(): Promise<HealthResponse> {
        const response = await this.transport.execute<unknown>({
            method: "GET",
            path: "/v1/health",
        });
        assertHealth(response);
        return response;
    }

    async requireHealthy(): Promise<HealthResponse> {
        const health = await this.health();
        if (health.status !== "ok") {
            throw new BorealisClientError(
                "PROTOCOL_NOT_HEALTHY",
                `Protocol status is ${health.status}.`,
            );
        }
        return health;
    }

    async quote(request: QuoteRequest): Promise<QuoteResponse> {
        validateIdentifier(request.buyer, "buyer");
        validateIdentifier(request.market, "market");
        validateAmount(request.reserveIn, "reserveIn", false);
        if (request.minPayout !== undefined) validateAmount(request.minPayout, "minPayout", true);
        const response = await this.transport.execute<unknown>({
            method: "POST",
            path: "/v1/bonds/quote",
            body: request,
        });
        assertQuote(response);
        return response;
    }

    async purchase(request: QuoteRequest, idempotencyKey: string): Promise<PurchaseResponse> {
        validateIdempotencyKey(idempotencyKey);
        const quote = await this.quote(request);
        const response = await this.transport.execute<unknown>({
            method: "POST",
            path: "/v1/bonds",
            idempotencyKey,
            body: { buyer: request.buyer, quote },
        });
        assertPurchase(response);
        return response;
    }

    async claim(request: ClaimRequest, idempotencyKey: string): Promise<ClaimResponse> {
        validateIdentifier(request.owner, "owner");
        validateIdentifier(request.position, "position");
        validateIdempotencyKey(idempotencyKey);
        if (request.maxAmount !== undefined) validateAmount(request.maxAmount, "maxAmount", false);
        const response = await this.transport.execute<unknown>({
            method: "POST",
            path: `/v1/positions/${encodeURIComponent(request.position)}/claims`,
            idempotencyKey,
            body: request,
        });
        assertClaim(response);
        return response;
    }

    async cancel(
        owner: string,
        position: string,
        idempotencyKey: string,
    ): Promise<CancellationResponse> {
        validateIdentifier(owner, "owner");
        validateIdentifier(position, "position");
        validateIdempotencyKey(idempotencyKey);
        const response = await this.transport.execute<unknown>({
            method: "POST",
            path: `/v1/positions/${encodeURIComponent(position)}/cancellations`,
            idempotencyKey,
            body: { owner, position },
        });
        assertCancellation(response);
        return response;
    }
}

export function atomic(value: bigint | number | string): AtomicAmount {
    let normalized: string;
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            throw new BorealisClientError(
                "INVALID_AMOUNT",
                "Numeric amounts must be safe integers.",
            );
        }
        normalized = value.toString();
    } else {
        normalized = value.toString();
    }
    validateAmount(normalized, "amount", true);
    return normalized;
}

export function quotePayout(
    reserveIn: AtomicAmount,
    reserveDecimals: number,
    payoutDecimals: number,
    basePriceWad: AtomicAmount,
    discountBps: AtomicAmount,
): AtomicAmount {
    const reserve = toBigInt(reserveIn, "reserveIn");
    const price = toBigInt(basePriceWad, "basePriceWad");
    const discount = toBigInt(discountBps, "discountBps");
    if (reserveDecimals < 0 || payoutDecimals < 0 || reserveDecimals > 36 || payoutDecimals > 36) {
        throw new BorealisClientError("INVALID_DECIMALS", "Asset decimals are outside range.");
    }
    if (price <= 0n || discount < 0n || discount >= BPS) {
        throw new BorealisClientError("INVALID_PRICE", "Price or discount is outside range.");
    }
    const normalized =
        reserveDecimals === payoutDecimals
            ? reserve
            : reserveDecimals < payoutDecimals
              ? reserve * 10n ** BigInt(payoutDecimals - reserveDecimals)
              : reserve / 10n ** BigInt(reserveDecimals - payoutDecimals);
    const discountedPrice = (price * (BPS - discount)) / BPS;
    return atomic((normalized * WAD) / discountedPrice);
}

export function vestingPreview(
    payoutTotal: AtomicAmount,
    claimed: AtomicAmount,
    startsAt: bigint,
    endsAt: bigint,
    now: bigint,
): { vested: AtomicAmount; claimable: AtomicAmount; complete: boolean } {
    const total = toBigInt(payoutTotal, "payoutTotal");
    const alreadyClaimed = toBigInt(claimed, "claimed");
    if (startsAt < 0n || endsAt <= startsAt || now < 0n || alreadyClaimed > total) {
        throw new BorealisClientError("INVALID_SCHEDULE", "The vesting schedule is invalid.");
    }
    const elapsed = now <= startsAt ? 0n : now >= endsAt ? endsAt - startsAt : now - startsAt;
    const vested = (total * elapsed) / (endsAt - startsAt);
    const claimable = vested > alreadyClaimed ? vested - alreadyClaimed : 0n;
    return { vested: atomic(vested), claimable: atomic(claimable), complete: now >= endsAt };
}

export function deriveIdempotencyKey(scope: string, intent: unknown): string {
    validateIdentifier(scope, "scope");
    return `${scope}:${createHash("sha256").update(JSON.stringify(intent)).digest("hex")}`;
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new BorealisClientError("INVALID_JSON", "Borealis returned malformed JSON.");
    }
}

function toBigInt(value: AtomicAmount, field: string): bigint {
    validateAmount(value, field, true);
    return BigInt(value);
}

function validateAmount(value: string, field: string, allowZero: boolean): void {
    if (!ATOMIC_AMOUNT.test(value) || (!allowZero && value === "0")) {
        throw new BorealisClientError("INVALID_AMOUNT", `${field} is not a valid atomic amount.`);
    }
}

function validateIdentifier(value: string, field: string): void {
    if (!IDENTIFIER.test(value)) {
        throw new BorealisClientError("INVALID_IDENTIFIER", `${field} is invalid.`);
    }
}

function validateIdempotencyKey(value: string): void {
    if (value.length < 16 || value.length > 160 || !/^[a-zA-Z0-9:_-]+$/.test(value)) {
        throw new BorealisClientError("INVALID_IDEMPOTENCY_KEY", "The idempotency key is invalid.");
    }
}

function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new BorealisClientError("INVALID_RESPONSE", "Borealis returned an invalid response.");
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new BorealisClientError("INVALID_RESPONSE", `Response field ${field} is invalid.`);
    }
    return value;
}

function amountField(value: unknown, field: string): AtomicAmount {
    const result = string(value, field);
    validateAmount(result, field, true);
    return result;
}

function assertHealth(value: unknown): asserts value is HealthResponse {
    const record = object(value);
    if (!["ok", "degraded", "halted"].includes(String(record.status))) {
        throw new BorealisClientError("INVALID_RESPONSE", "Health status is invalid.");
    }
    string(record.version, "version");
    string(record.network, "network");
    if (!/^[a-f0-9]{64}$/.test(string(record.stateDigest, "stateDigest"))) {
        throw new BorealisClientError("INVALID_RESPONSE", "State digest is invalid.");
    }
}

function assertQuote(value: unknown): asserts value is QuoteResponse {
    const record = object(value);
    for (const field of ["market", "buyer"] as const)
        validateIdentifier(string(record[field], field), field);
    for (const field of [
        "reserveIn",
        "payoutOut",
        "discountedPrice",
        "discountBps",
        "priceIndex",
    ] as const) {
        amountField(record[field], field);
    }
    string(record.expiresAt, "expiresAt");
}

function assertPurchase(value: unknown): asserts value is PurchaseResponse {
    const record = object(value);
    validateIdentifier(string(record.position, "position"), "position");
    for (const field of ["reserveIn", "payoutOut", "discountBps"] as const)
        amountField(record[field], field);
    string(record.startsAt, "startsAt");
    string(record.endsAt, "endsAt");
}

function assertClaim(value: unknown): asserts value is ClaimResponse {
    const record = object(value);
    validateIdentifier(string(record.position, "position"), "position");
    validateIdentifier(string(record.owner, "owner"), "owner");
    amountField(record.paid, "paid");
    amountField(record.remainingNominal, "remainingNominal");
    if (record.status !== "vesting" && record.status !== "claimed") {
        throw new BorealisClientError("INVALID_RESPONSE", "Claim status is invalid.");
    }
}

function assertCancellation(value: unknown): asserts value is CancellationResponse {
    const record = object(value);
    validateIdentifier(string(record.position, "position"), "position");
    validateIdentifier(string(record.owner, "owner"), "owner");
    for (const field of ["refund", "penalty", "forfeitedPayout"] as const)
        amountField(record[field], field);
    if (record.status !== "cancelled") {
        throw new BorealisClientError("INVALID_RESPONSE", "Cancellation status is invalid.");
    }
}
