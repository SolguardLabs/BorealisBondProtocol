import { createHash } from "node:crypto";

export type CanonicalValue =
    | null
    | boolean
    | string
    | number
    | bigint
    | readonly CanonicalValue[]
    | { readonly [key: string]: CanonicalValue };

function normalize(value: CanonicalValue): unknown {
    if (typeof value === "bigint") {
        return { $bigint: value.toString() };
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("canonical numbers must be finite");
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => normalize(item));
    }
    if (value !== null && typeof value === "object") {
        const output: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            const item = (value as { readonly [key: string]: CanonicalValue })[key];
            if (item !== undefined) {
                output[key] = normalize(item);
            }
        }
        return output;
    }
    return value;
}

export function canonicalJson(value: CanonicalValue): string {
    return JSON.stringify(normalize(value));
}

export function canonicalDigest(value: CanonicalValue): string {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
