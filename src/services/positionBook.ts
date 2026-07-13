import { assertProtocol, fail } from "../shared/errors.js";
import type { AccountId, MarketId, PositionId } from "../shared/ids.js";
import type { BondPosition, MarketState, PositionStatus } from "../domain/bonds.js";
import { cloneMarket, clonePosition } from "../domain/bonds.js";

export class PositionBook {
    private readonly markets = new Map<MarketId, MarketState>();
    private readonly positions = new Map<PositionId, BondPosition>();

    addMarket(market: MarketState): void {
        if (this.markets.has(market.config.id)) {
            fail("VALIDATION_FAILED", "market already exists", { market: market.config.id });
        }
        this.markets.set(market.config.id, market);
    }

    getMarket(id: MarketId): MarketState {
        const market = this.markets.get(id);
        if (market === undefined) {
            fail("MARKET_NOT_FOUND", "market not found", { market: id });
        }
        return market;
    }

    updateMarket(id: MarketId, patch: Partial<MarketState>): MarketState {
        const current = this.getMarket(id);
        const next = cloneMarket(current, patch);
        this.markets.set(id, next);
        return next;
    }

    addPosition(position: BondPosition): void {
        if (this.positions.has(position.id)) {
            fail("VALIDATION_FAILED", "position already exists", { position: position.id });
        }
        this.positions.set(position.id, position);
    }

    getPosition(id: PositionId): BondPosition {
        const position = this.positions.get(id);
        if (position === undefined) {
            fail("POSITION_NOT_FOUND", "position not found", { position: id });
        }
        return position;
    }

    updatePosition(id: PositionId, patch: Partial<BondPosition>): BondPosition {
        const current = this.getPosition(id);
        const next = clonePosition(current, patch);
        this.positions.set(id, next);
        return next;
    }

    requireOwner(id: PositionId, owner: AccountId): BondPosition {
        const position = this.getPosition(id);
        assertProtocol(
            position.owner === owner,
            "AUTHORIZATION_FAILED",
            "position owner mismatch",
            {
                position: id,
                expected: position.owner,
                actual: owner,
            },
        );
        return position;
    }

    requireStatus(id: PositionId, status: PositionStatus): BondPosition {
        const position = this.getPosition(id);
        assertProtocol(position.status === status, "POSITION_CLOSED", "position status mismatch", {
            position: id,
            expected: status,
            actual: position.status,
        });
        return position;
    }

    positionsFor(owner: AccountId): readonly BondPosition[] {
        return [...this.positions.values()].filter((position) => position.owner === owner);
    }

    positionsInMarket(market: MarketId): readonly BondPosition[] {
        return [...this.positions.values()].filter((position) => position.market === market);
    }

    allMarkets(): readonly MarketState[] {
        return [...this.markets.values()];
    }

    allPositions(): readonly BondPosition[] {
        return [...this.positions.values()];
    }
}
