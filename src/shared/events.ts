import type { AccountId, AssetId, EventId, MarketId, PositionId } from "./ids.js";
import { IdSequence } from "./ids.js";
import type { Timestamp } from "./time.js";

export type EventName =
    | "account.registered"
    | "asset.registered"
    | "market.created"
    | "market.paused"
    | "market.resumed"
    | "market.price_updated"
    | "treasury.deposited"
    | "treasury.withdrawn"
    | "bond.quoted"
    | "bond.purchased"
    | "bond.cancelled"
    | "bond.claimed"
    | "ledger.posted";

export interface BaseEvent {
    readonly id: EventId;
    readonly name: EventName;
    readonly at: Timestamp;
}

export interface AccountRegisteredEvent extends BaseEvent {
    readonly name: "account.registered";
    readonly account: AccountId;
    readonly label: string;
}

export interface AssetRegisteredEvent extends BaseEvent {
    readonly name: "asset.registered";
    readonly asset: AssetId;
    readonly symbol: string;
    readonly decimals: number;
}

export interface MarketCreatedEvent extends BaseEvent {
    readonly name: "market.created";
    readonly market: MarketId;
    readonly reserveAsset: AssetId;
    readonly payoutAsset: AssetId;
}

export interface MarketPausedEvent extends BaseEvent {
    readonly name: "market.paused" | "market.resumed";
    readonly market: MarketId;
    readonly reason: string;
}

export interface MarketPriceUpdatedEvent extends BaseEvent {
    readonly name: "market.price_updated";
    readonly market: MarketId;
    readonly oldIndex: bigint;
    readonly newIndex: bigint;
    readonly oldPrice: bigint;
    readonly newPrice: bigint;
}

export interface TreasuryMovementEvent extends BaseEvent {
    readonly name: "treasury.deposited" | "treasury.withdrawn";
    readonly account: AccountId;
    readonly asset: AssetId;
    readonly amount: bigint;
}

export interface BondQuotedEvent extends BaseEvent {
    readonly name: "bond.quoted";
    readonly market: MarketId;
    readonly buyer: AccountId;
    readonly reserveIn: bigint;
    readonly payoutOut: bigint;
    readonly discountBps: bigint;
}

export interface BondPurchasedEvent extends BaseEvent {
    readonly name: "bond.purchased";
    readonly market: MarketId;
    readonly buyer: AccountId;
    readonly position: PositionId;
    readonly reserveIn: bigint;
    readonly payoutOut: bigint;
    readonly startsAt: Timestamp;
    readonly endsAt: Timestamp;
}

export interface BondCancelledEvent extends BaseEvent {
    readonly name: "bond.cancelled";
    readonly market: MarketId;
    readonly owner: AccountId;
    readonly position: PositionId;
    readonly refund: bigint;
    readonly forfeitedPayout: bigint;
}

export interface BondClaimedEvent extends BaseEvent {
    readonly name: "bond.claimed";
    readonly market: MarketId;
    readonly owner: AccountId;
    readonly position: PositionId;
    readonly payout: bigint;
    readonly remainingNominal: bigint;
}

export interface LedgerPostedEvent extends BaseEvent {
    readonly name: "ledger.posted";
    readonly entry: string;
    readonly legs: number;
}

export type ProtocolEvent =
    | AccountRegisteredEvent
    | AssetRegisteredEvent
    | MarketCreatedEvent
    | MarketPausedEvent
    | MarketPriceUpdatedEvent
    | TreasuryMovementEvent
    | BondQuotedEvent
    | BondPurchasedEvent
    | BondCancelledEvent
    | BondClaimedEvent
    | LedgerPostedEvent;

export type EventPayload<E extends ProtocolEvent> = E extends ProtocolEvent ? Omit<E, "id"> : never;

export class EventLog {
    private readonly ids = new IdSequence();
    private readonly events: ProtocolEvent[] = [];

    push<E extends ProtocolEvent>(event: EventPayload<E>): E {
        const id = this.ids.nextEvent(event.name.replace(".", ":"));
        const enriched = Object.freeze({ id, ...event }) as unknown as E;
        this.events.push(enriched);
        return enriched;
    }

    all(): readonly ProtocolEvent[] {
        return [...this.events];
    }

    clear(): void {
        this.events.length = 0;
    }

    count(name?: EventName): number {
        if (name === undefined) {
            return this.events.length;
        }
        return this.events.filter((event) => event.name === name).length;
    }

    last<E extends ProtocolEvent = ProtocolEvent>(name?: EventName): E | undefined {
        for (let index = this.events.length - 1; index >= 0; index -= 1) {
            const event = this.events[index];
            if (event !== undefined && (name === undefined || event.name === name)) {
                return event as E;
            }
        }
        return undefined;
    }

    filter<E extends ProtocolEvent = ProtocolEvent>(name: EventName): E[] {
        return this.events.filter((event) => event.name === name) as E[];
    }

    since(id: EventId): readonly ProtocolEvent[] {
        const index = this.events.findIndex((event) => event.id === id);
        return index === -1 ? [] : this.events.slice(index + 1);
    }
}
