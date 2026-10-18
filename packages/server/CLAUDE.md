# @oggregator/server

Fastify REST + WebSocket API. Bootstraps venue adapters from `@oggregator/core`, serves enriched chain data, paper trading, portfolio analytics, flow routes, readiness, and the production SPA.

## Commands

```bash
pnpm dev            # tsx watch on :3100 (hot reload)
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm typecheck      # prebuilds core, then tsc --noEmit
```

## Structure

```
src/
  index.ts           Entry point (PORT from env, default 3100)
  app.ts             Fastify factory, plugin registration, adapter bootstrap
  adapters.ts        Instantiates + registers all 5 venue adapters
  routes/
    health.ts        GET /api/health + GET /api/ready
    venues.ts        GET /api/venues
    underlyings.ts   GET /api/underlyings
    expiries.ts      GET /api/expiries?underlying=BTC
    chains.ts        GET /api/chains?underlying=BTC&expiry=2026-03-28&venues=deribit,okx
    surface.ts       GET /api/surface?underlying=BTC
    stats.ts         GET /api/stats?underlying=BTC
    dvol-history.ts  GET /api/dvol-history?currency=BTC
    liquidity.ts     GET /api/liquidity?instrument=BTC-PERPETUAL&side=buy&size=1 (Thalex L2 fill estimate + depth; ORDER_BOOK=0 disables)
    vol-heatmap.ts   GET /api/vol-heatmap?currency=BTC&hours=6&resolutionSec=60&since=ms (resting vega by IV bucket on Deribit DVOL-window books; in-memory 24h)
    iv-history.ts    GET /api/iv-history?underlying=BTC&window=90d
    vol-richness.ts  GET /api/vol-richness?underlying=BTC (IV vs forecast, cone, intraday z)
    spot-candles.ts  GET /api/spot-candles?underlying=BTC
    break-even.ts    GET /api/break-even?underlying=BTC&expiry=2026-11-27 (Deribit break-evens: hourly recorded history, projection, N(d2) vs historical frequency)
    time-at-price.ts GET /api/time-at-price?underlying=BTC&lookbackDays=730 (hourly bars per price level + mean 7d Parkinson vol per price bin; paged Deribit 1h history)
    flow.ts          GET /api/flow?underlying=BTC
    block-flow.ts    GET /api/block-flow?underlying=BTC
    block-strike-buckets.ts  GET /api/block-flow/strike-buckets?underlying=BTC&resolution=3600&start=ISO (blocks by candle × strike × expiry)
    call-put-flow.ts GET /api/flow/call-put-buckets?underlying=BTC&resolution=3600&days=30 (screen flow call vs put per bucket; remote buckets cached per ingest flush)
    news.ts          GET /api/news
    regime.ts        GET /api/regime?underlying=BTC
    spots.ts         GET /api/spots
    paper/           REST paper trading endpoints
    portfolio/       REST portfolio positions, metrics, scenarios, credentials
    social/          REST profile + leaderboard, admin chat moderation, WS /ws/social
    live/            /api/live status|kill|arm|disarm|reset → execution daemon socket (no keys here)
    ws-chain.ts      WS /ws/chain
    portfolio/ws.ts  WS /ws/portfolio
    paper/ws.ts      WS /ws/paper
```

## Non-obvious decisions

- **Adapters bootstrap async after server starts** — routes return 503 via `isReady()` / `GET /api/ready` until adapters finish loading (~5-15s). Server accepts connections immediately while feeds connect in the background.

- **Server imports only from `@oggregator/core` package root** — never from internal feeds/core paths. If something is needed, it must be exported from core's `index.ts`.

- **Protocol contracts live in `@oggregator/protocol`** — server and web share Zod schemas for chain, paper, portfolio, and private-venue credential payloads. Route handlers should validate at the boundary and avoid hand-maintained duplicate DTOs.

- **New venues need zero route changes** — add the adapter in `adapters.ts`, call `registerAdapter()`, all routes pick it up via `getAllAdapters()`.

- **Auto-subscribes on first request** — `chains.ts` calls `ensureSubscribed()` per venue/underlying on first `/api/chains` request, opening WS connections lazily.

- **Chain browser transport is WS-first** — `ws-chain.ts` streams from a shared `ChainRuntime` that coalesces venue deltas and pushes enriched strike patches every 500ms (GEX at most every 2s). It does not forward raw exchange ticks one-by-one. Frame bodies are serialized once per runtime event and shared across sessions.
- **Chain patches are field-level diffs for clients that opt in** — a subscribe with `patchFormat: 'diff'` gets `diff` frames carrying only the venues and fields that changed (`ChainRuntimeDeltaEvent.diffPatch()`, memoized per event). Without the field, clients keep receiving whole-strike `delta` frames, so a stale cached SPA still works. On live BTC 0DTE frames, diffs were 5.9× smaller (387KB → 65KB).
- **`VOL_HEATMAP=0` disables the DVOL liquidity heatmap** — otherwise `services.ts` starts `VolHeatmapRuntime`, which spawns its own worker thread with a dedicated Deribit socket.
- **`FEED_WORKER=1` moves chain venue ingest off the main thread** — `adapters.ts` then registers `FeedWorkerHost` proxies instead of in-process adapters. Routes and runtimes are unchanged. Unset it to roll back.
- **Live routes never use the dev auth bypass** — `/api/live/*` goes through `createLiveTraderGuard` (`LIVE_TRADING_ENABLED`, Clerk JWT, `live_trading` entitlement); arm/reset also need a fresh second factor from Clerk's `fva` claim and answer with Clerk's reverification 403 body otherwise. Kill never needs step-up and is exempt from the bootstrap 503 gate.
- **Venue credential ciphertexts are bound to their row** — `encrypt`/`decrypt` take `venueCredentialContext(accountId, venue, environment)` as AES-GCM AAD (mainnet keeps the old context string). v1 rows (no AAD) still read; `credentials:rewrap` moves them to v2.
- **Thalex keys have one slot per network** — `venue_credentials` is keyed `(account, venue, environment)` with one `active` slot, the one the portfolio connects to; `/portfolio/venue-credentials/thalex/{keys,activate}` list and switch them. Browser-saved keys are read-only; trading keys exist only on the execution daemon. The exchange ledger has no environment column, so a testnet session never reads or writes it (`ledgerMatchesSession`), and social/leaderboard reads only mainnet sessions (`isMainnetVenueConnected`, `restoreStoredVenue`).

