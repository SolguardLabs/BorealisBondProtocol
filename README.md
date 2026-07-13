# BorealisBondProtocol

![banner](./assets/banner.png)

BorealisBondProtocol is a TypeScript DeFi bond desk simulation. The protocol sells discounted
emission tokens in exchange for reserve assets, tracks each purchase as a vesting position, and
allows buyers to claim vested payouts over time.

The project is structured as a production-style protocol repository: the public code, tests, and
operational notes describe the bonding desk, its accounting model, and the expected review surface.

## Protocol Surface

- Reserve assets and payout assets with independent token decimals.
- Size-based bond discounts with utilization-aware discount compression.
- Quote TTL and price-index invalidation for stale quotes.
- Linear and cliff-linear vesting schedules.
- Partial claims, final claims, and user-initiated cancellations.
- Treasury accounting for reserve vaults, emission vaults, revenue, and position liabilities.
- Operational reports, risk monitoring, and reconciliation views.

## Layout

```text
src/
  accounting/     ledger and treasury accounting
  domain/         assets, accounts, bond markets, vesting
  lens/           protocol reports
  operations/     reconciliation helpers
  pricing/        discount curves and market quotes
  risk/           coverage and utilization monitor
  scenario/       deterministic scenario factory
  services/       bond desk, claims, cancellations, facade
  shared/         fixed-point math, ids, events, errors, clock
  validation/     market and policy validation
tests/
  helpers/
  node/
```

## Commands

```bash
npm install
npm test
npm run build
npm run format:check
```

## Audit Notes

The public tests cover normal purchases, discounts, vesting, cancellations, partial claims, and
routine price updates. They are intentionally not exhaustive. Auditors should inspect accounting
units, state transitions, and how market indexes interact with position lifecycle operations.
