# @oggregator/core

Feeds, canonical types, reusable live-data runtimes, normalization, and enrichment analytics.

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
  feeds/{venue}/    ws-client.ts, codec.ts, planner.ts, state.ts, health.ts, types.ts
  feeds/shared/     BaseAdapter, SdkBaseAdapter, JsonRpcWsClient, TopicWsClient
  portfolio/        position store, greeks aggregation, scenarios, pnl curve
  runtime/          chain, spot, trades, block-trades, portfolio, vol-heatmap
  core/             canonical types, aggregator, enrichment, registry, symbol
  services/         dvol only
  types/common.ts   VenueId, OptionRight, DataSource, UnixMs
  utils/logger.ts   pino structured logging
  index.ts          public API (explicit named exports)
```

## Non-obvious decisions

- **Zod schemas are the source of truth** — each venue's `types.ts` defines what the exchange actually sends. TypeScript types are derived via `z.infer<>`. Changes to exchange response formats start in the Zod schema.

- **Feed isolation** — feeds never import from each other. Cross-feed communication goes through `core/aggregator.ts`.

- **Two JSON-RPC venues share one client** — `jsonrpc-client.ts` serves Deribit (`public/subscribe`) and Derive (`subscribe`), configured via method name overrides.

- **Enrichment is pure computation** — `core/enrichment.ts` transforms raw ComparisonRows into analytics (ATM IV, 25Δ skew, GEX, IV surface, term structure). No network calls, no mutation. All stats are derived from data already in the QuoteStore.

- **Portfolio analytics stay pure at the edge of positions + marks** — `portfolio/aggregator.ts`, `portfolio/scenarios.ts`, and `portfolio/pnl-curve.ts` operate on stored legs plus injected mark data. Runtime wiring, account scoping, and push cadence stay in `runtime/portfolio/`.

- **IV convention: fractions (0–1+)** — Deribit sends percentages (50.18 = 50.18%), converted via `ivToFraction()` in the adapter. All other venues send fractions natively. Frontend `fmtIv()` does `value × 100` for display.

- **Fee estimation with cap** — `estimateFees()` in `sdk-base.ts` uses `min(rate × underlying, cap × optionPrice)`. Cap prevents absurd fees on cheap OTM options (e.g. 12.5% cap: a $5 option pays max $0.625 fee, not $21).

- **Tests are doc-driven** — fixtures copied verbatim from `references/options-docs/`. If a test fails, check the docs — the exchange may have changed their API.
- **Runtimes are the public product surface** — `ChainRuntime`, `SpotRuntime`, `TradeRuntime`, `BlockTradeRuntime`, and `PortfolioRuntime` are the core APIs downstream consumers should use. Server/web protocol shaping stays outside core.
- **Feed liveness is checked at two levels** — the transport watchdog (no inbound frame for 5 min) and a quote watchdog in `SdkBaseAdapter` (socket alive but no quotes for 3 min while subscriptions exist). Heartbeat replies keep transport activity fresh on a silent socket, so the quote check is the one that catches it on most venues. Deribit and Gate.io opt out (`quoteStalenessThresholdMs = null`) because they run finer-grained checks of their own.
- **Every runtime socket goes through `TopicWsClient` or `JsonRpcWsClient`** — the trade tape, block trades and the Coincall index stream included. The shared clients carry the handshake timeout, stable-session backoff reset, optional idle timeout and the safe close (`utils/ws.ts`). Closing a CONNECTING socket with no `'error'` listener throws and kills the process.
- **One handler object per venue in the coordinator** — adapters dedupe delta fan-out by handler identity. Passing a fresh object per request delivered every delta batch once per active request.
- **Vol heatmap runs on its own worker and Deribit socket** — `runtime/vol-heatmap/` streams top-10 option books (`book.*.none.10.agg2`) for the DVOL window (two expiries around 30d, OTM strikes within ±0.5σ), inverts each level to IV against the expiry forward from the ATM call's ticker, and weights by vega. It is kept off the chain feed's Deribit session because many fast channels there once made Deribit's data go stale. Columns live only in memory (24h); Deribit has no historical books to backfill. Each column also carries `adjCells`: the same vega placed at `iv − mid(option) + atmMid` (ATM mids interpolated to 30d in total variance), which removes the smile so bids and offers across strikes line up; one-sided books are left out of it.
- **Thalex L2 books run on their own worker and socket** — `runtime/order-book/` (`OrderBookRuntime`) spawns a dedicated worker hosting `feeds/thalex/book-feed.ts`, independent of `FEED_WORKER`. Subscriptions are demand-driven and ref-counted with a 60s linger and a 40-instrument cap. Thalex book frames have no sequence numbers, so any disconnect drops every book to `unsynchronized` until the next snapshot. `liquidity/` holds the canonical book contract (`OrderBookSnapshot`) and pure fill/depth analytics; S1 should reuse that contract. Book fixtures are a live capture in `feeds/thalex/__fixtures__/` because `references/` is not committed.
- **Optional feed worker** — `feeds/worker/` hosts the chain adapters on a worker thread behind `WorkerVenueAdapter` proxies (`FEED_WORKER=1` in the server). The worker batches deltas and quote-recorder marks every 50ms. A crashed worker is respawned, and markets, recorders and subscriptions are replayed.
