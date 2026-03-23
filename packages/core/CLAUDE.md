# @oggregator/core

Feeds, canonical types, normalization, enrichment analytics.

## Commands

```bash
pnpm typecheck      # tsc --noEmit
pnpm build          # tsc → dist/
pnpm test           # vitest watch
pnpm test:run       # vitest single pass (CI)
```

## Structure

```
src/
  feeds/{venue}/    ws-client.ts, types.ts (Zod schemas), index.ts
  feeds/shared/     BaseAdapter, SdkBaseAdapter, JsonRpcWsClient
  core/             canonical types, aggregator, enrichment, registry, symbol
  types/common.ts   VenueId, OptionRight, DataSource, UnixMs
  utils/logger.ts   pino structured logging
  index.ts          public API (explicit named exports)
```

## Non-obvious decisions

- **Zod schemas are the source of truth** — each venue's `types.ts` defines what the exchange actually sends. TypeScript types are derived via `z.infer<>`. Changes to exchange response formats start in the Zod schema.

- **Feed isolation** — feeds never import from each other. Cross-feed communication goes through `core/aggregator.ts`.

- **Two JSON-RPC venues share one client** — `jsonrpc-client.ts` serves Deribit (`public/subscribe`) and Derive (`subscribe`), configured via method name overrides.

- **Enrichment is pure computation** — `core/enrichment.ts` transforms raw ComparisonRows into analytics (ATM IV, 25Δ skew, GEX, IV surface, term structure). No network calls, no mutation. All stats are derived from data already in the QuoteStore.

- **IV convention: fractions (0–1+)** — Deribit sends percentages (50.18 = 50.18%), converted via `ivToFraction()` in the adapter. All other venues send fractions natively. Frontend `fmtIv()` does `value × 100` for display.

- **Fee estimation with cap** — `estimateFees()` in `sdk-base.ts` uses `min(rate × underlying, cap × optionPrice)`. Cap prevents absurd fees on cheap OTM options (e.g. 12.5% cap: a $5 option pays max $0.625 fee, not $21).

- **Tests are doc-driven** — fixtures copied verbatim from `references/protocol-docs/`. If a test fails, check the docs — the exchange may have changed their API.

## Where things are

- Canonical types: `core/types.ts`
- Enrichment (stats, GEX, surface): `core/enrichment.ts`
- Per-venue Zod schemas: `feeds/{venue}/types.ts`
- Inverse→USD conversion: `feeds/shared/sdk-base.ts` → `normPrice()`
- IV normalization: `feeds/shared/base.ts` → `ivToFraction()`
- Expiry parsing: `feeds/shared/sdk-base.ts` → `parseExpiry()`
- Fee estimation: `feeds/shared/sdk-base.ts` → `estimateFees()`
- Official API docs: `../../references/protocol-docs/{venue}/`

## Critical: server runs from dist/, not src/

`packages/server` imports `@oggregator/core` via `dist/index.js`. Source changes in `src/` are invisible to the running server until you rebuild:

```bash
pnpm --filter @oggregator/core build   # tsc → dist/
# then restart the server
```

`pnpm dev` prebuilds at startup. But if the server is already running and you change core source, you must rebuild + restart. `pnpm typecheck` and `pnpm test` check source directly and will pass even when dist is stale — they won't catch this.

## Known gotchas

- **Deribit IV is percentage**: 50.18 means 50.18%. All others send 0.5018. `ivToFraction()` handles this.
- **Bybit REST vs WS field names differ**: REST uses `bid1Price`/`markIv`, WS uses `bidPrice`/`markPriceIv`. Two separate normalizer functions.
- **OKX tickers need per-instId**: `instFamily` parameter errors for the tickers channel (60018). Must subscribe per instrument. `opt-summary` does support `instFamily` for bulk.
- **Bybit baseCoin bulk tickers broken**: `tickers.BTC` silently accepts but never delivers. Must use per-instrument `tickers.BTC-21MAR26-70000-C-USDT`.
- **Derive DNS**: `api.derive.xyz` doesn't resolve. Use `api.lyra.finance`.
- **Derive slow bootstrap**: ~13s to load all instruments + tickers across currencies/expiries.
- **Binance two WS paths**: `/market` for mark price, `/public` for trades. Cannot combine on one connection.
- **OKX markPx missing**: `opt-summary` has no `markPx` field. Mark price stays null. Bid/ask/IV/greeks all work.
- **OKX oiUsd is not notional**: `/public/open-interest` returns `oiUsd = oi × $1` (contract count in dollars), not `oiCcy × spot`. Do not use it. Enrichment computes notional from `oiCcy × underlyingPrice`.
- **OKX vol24h is contracts, not base currency**: Multiply by `ctMult` (0.01 for BTC) to get base currency before storing as `volume24h`. Enrichment then multiplies by `underlyingPrice` for USD.
