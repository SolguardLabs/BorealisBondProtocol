import { assertProtocol } from "./errors.js";

export type AccountId = string & { readonly __brand: "AccountId" };
export type AssetId = string & { readonly __brand: "AssetId" };
export type MarketId = string & { readonly __brand: "MarketId" };
export type PositionId = string & { readonly __brand: "PositionId" };
export type EventId = string & { readonly __brand: "EventId" };

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,63}$/;

function branded<T extends string>(value: string, label: string): T {
    assertProtocol(ID_PATTERN.test(value), "VALIDATION_FAILED", `invalid ${label}`, { value });
    return value as T;
}

export function accountId(value: string): AccountId {
    return branded<AccountId>(value, "account id");
}

export function assetId(value: string): AssetId {
    return branded<AssetId>(value, "asset id");
}

export function marketId(value: string): MarketId {
    return branded<MarketId>(value, "market id");
}

export function positionId(value: string): PositionId {
    return branded<PositionId>(value, "position id");
}

export function eventId(value: string): EventId {
    return branded<EventId>(value, "event id");
}

export class IdSequence {
    private counters = new Map<string, number>();

    nextPosition(market: MarketId, buyer: AccountId): PositionId {
        const prefix = `pos:${market}:${buyer}`;
        const next = (this.counters.get(prefix) ?? 0) + 1;
        this.counters.set(prefix, next);
        return positionId(`${prefix}:${next}`);
    }

    nextEvent(scope: string): EventId {
        const prefix = `evt:${scope}`;
        const next = (this.counters.get(prefix) ?? 0) + 1;
        this.counters.set(prefix, next);
        return eventId(`${prefix}:${next}`);
    }

    snapshot(): ReadonlyMap<string, number> {
        return new Map(this.counters);
    }
}
