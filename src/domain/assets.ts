import { assertProtocol, fail } from "../shared/errors.js";
import type { AssetId } from "../shared/ids.js";

export type AssetKind = "reserve" | "payout" | "fee";

export interface AssetMetadata {
    readonly issuer: string;
    readonly chain: string;
    readonly custody: "internal" | "external" | "simulated";
    readonly notes: readonly string[];
}

export interface AssetConfig {
    readonly id: AssetId;
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    readonly kind: AssetKind;
    readonly oracleKey: string;
    readonly minBalance: bigint;
    readonly maxBalance: bigint;
    readonly active: boolean;
    readonly metadata: AssetMetadata;
}

export interface AssetRegistration {
    readonly id: AssetId;
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    readonly kind: AssetKind;
    readonly oracleKey?: string;
    readonly minBalance?: bigint;
    readonly maxBalance?: bigint;
    readonly active?: boolean;
    readonly metadata?: Partial<AssetMetadata>;
}

function normalizeSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    assertProtocol(
        /^[A-Z][A-Z0-9]{1,11}$/.test(normalized),
        "VALIDATION_FAILED",
        "invalid asset symbol",
        { symbol },
    );
    return normalized;
}

function normalizeMetadata(input?: Partial<AssetMetadata>): AssetMetadata {
    return Object.freeze({
        issuer: input?.issuer ?? "Borealis Treasury",
        chain: input?.chain ?? "borealis-local",
        custody: input?.custody ?? "simulated",
        notes: Object.freeze([...(input?.notes ?? [])]),
    });
}

export function createAsset(input: AssetRegistration): AssetConfig {
    assertProtocol(
        input.decimals >= 0 && input.decimals <= 36,
        "VALIDATION_FAILED",
        "bad decimals",
        {
            decimals: input.decimals,
        },
    );
    const minBalance = input.minBalance ?? 0n;
    const maxBalance = input.maxBalance ?? 2n ** 255n;
    assertProtocol(minBalance >= 0n, "VALIDATION_FAILED", "min balance cannot be negative", {
        minBalance,
    });
    assertProtocol(maxBalance >= minBalance, "VALIDATION_FAILED", "invalid balance interval", {
        minBalance,
        maxBalance,
    });
    return Object.freeze({
        id: input.id,
        symbol: normalizeSymbol(input.symbol),
        name: input.name.trim(),
        decimals: input.decimals,
        kind: input.kind,
        oracleKey: input.oracleKey ?? normalizeSymbol(input.symbol),
        minBalance,
        maxBalance,
        active: input.active ?? true,
        metadata: normalizeMetadata(input.metadata),
    });
}

export class AssetRegistry {
    private readonly assets = new Map<AssetId, AssetConfig>();
    private readonly symbols = new Map<string, AssetId>();

    register(input: AssetRegistration): AssetConfig {
        const asset = createAsset(input);
        if (this.assets.has(asset.id) || this.symbols.has(asset.symbol)) {
            fail("ASSET_ALREADY_REGISTERED", "asset is already registered", {
                id: asset.id,
                symbol: asset.symbol,
            });
        }
        this.assets.set(asset.id, asset);
        this.symbols.set(asset.symbol, asset.id);
        return asset;
    }

    get(id: AssetId): AssetConfig {
        const asset = this.assets.get(id);
        if (asset === undefined) {
            fail("ASSET_NOT_FOUND", "asset does not exist", { id });
        }
        return asset;
    }

    findBySymbol(symbol: string): AssetConfig | undefined {
        const id = this.symbols.get(normalizeSymbol(symbol));
        return id === undefined ? undefined : this.assets.get(id);
    }

    requireKind(id: AssetId, kind: AssetKind): AssetConfig {
        const asset = this.get(id);
        assertProtocol(
            asset.kind === kind,
            "UNSUPPORTED_ASSET",
            "asset kind is not supported here",
            {
                id,
                expected: kind,
                actual: asset.kind,
            },
        );
        return asset;
    }

    requireActive(id: AssetId): AssetConfig {
        const asset = this.get(id);
        assertProtocol(asset.active, "UNSUPPORTED_ASSET", "asset is not active", { id });
        return asset;
    }

    setActive(id: AssetId, active: boolean): AssetConfig {
        const current = this.get(id);
        const next = Object.freeze({ ...current, active });
        this.assets.set(id, next);
        return next;
    }

    list(kind?: AssetKind): readonly AssetConfig[] {
        const values = [...this.assets.values()];
        return kind === undefined ? values : values.filter((asset) => asset.kind === kind);
    }

    snapshot(): Record<string, AssetConfig> {
        const output: Record<string, AssetConfig> = {};
        for (const [id, asset] of this.assets) {
            output[id] = asset;
        }
        return Object.freeze(output);
    }
}
