# @oggregator/core

Venue adapters, canonical types, normalization, and enrichment analytics for 5 crypto options exchanges.

## What this does

Connects to Deribit, OKX, Binance, Bybit, and Derive via WebSocket, normalizes every option quote into a canonical `NormalizedQuote` type, and enriches cross-venue data with analytics (ATM IV, skew, GEX, IV surface, put/call ratios).

## Structure

```
src/
  feeds/{venue}/    ws-client, Zod schemas, normalizer, adapter
  feeds/shared/     BaseAdapter, JSON-RPC client, SDK helpers
  core/             canonical types, aggregator, enrichment, registry
  services/         flow, block-flow, dvol, spot, shared trade persistence helpers
  types/common.ts   VenueId, OptionRight, UnixMs (branded types)
  utils/logger.ts   pino structured logging
```

## Key concepts

- **Zod at the boundary** — every exchange message is parsed through Zod schemas before entering the system. Types are inferred from schemas, never manually duplicated.
- **Feed isolation** — venue adapters never import from each other. Cross-venue aggregation happens in `core/aggregator.ts`.
- **IV as fractions** — all internal IV values are 0–1+ (0.50 = 50%). Deribit sends percentages and is converted at the adapter level.
- **Enrichment is pure** — `core/enrichment.ts` computes ATM IV, 25Δ skew, GEX, IV surface, and term structure from raw data. No side effects.

## Commands

```bash
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc → dist/
pnpm test:run     # vitest (240 tests)
```

## Runtime notes

- `FlowService` and `BlockFlowService` expose live trade subscriptions for downstream consumers like the ingest worker
- `services/trade-persistence.ts` centralizes instrument parsing and venue-specific premium/notional math shared by server routes and persistence code
