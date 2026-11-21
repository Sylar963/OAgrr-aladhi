# @oggregator/server

Fastify REST + WebSocket API. Bootstraps venue adapters from `@oggregator/core`, serves enriched option chain data, and hosts the web dashboard in production.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health |
| `GET /api/ready` | Readiness for deploy health checks |
| `GET /api/venues` | Connected venues and connection state |
| `GET /api/underlyings` | Available base assets, per-venue breakdown |
| `GET /api/expiries?underlying=BTC` | Expiry dates with per-venue availability |
| `GET /api/chains?underlying=BTC&expiry=...&venues=...` | Cross-venue enriched option chain |
| `GET /api/alpha/market-context?underlying=BTC` | IV/RV, expected move, range, and regime context for Alpha strategies |
| `GET /api/alpha/lotto-scanner` | Multi-venue short-dated OTM call scan and sizing estimates |
| `GET /api/surface?underlying=BTC` | IV surface (expiry × delta heatmap) |
| `GET /api/stats?underlying=BTC` | Spot, DVOL, IVR, 24h changes |
| `GET /api/dvol-history?currency=BTC` | Historical DVOL candles + realized vol |
| `GET /api/vol-heatmap?currency=BTC&hours=24` | Persistent rolling 24h of resting option vega, DVOL, ATM IV, and trade markers |
| `GET /api/flow?underlying=BTC` | Recent options trades across venues |
| `GET /api/block-flow?underlying=BTC` | Institutional RFQ / block trades |
| `WS /ws/chain` | Real-time chain snapshot push |

## Commands

```bash
pnpm dev          # tsx watch on :3100 (hot reload)
pnpm build        # tsc → dist/
pnpm start        # NODE_ENV=production node dist/index.js
pnpm test:run     # vitest
```

### Alpha analysis

The market-context endpoint centralizes cross-venue ATM IV history, 7d/30d realized volatility,
implied expected moves, range compression, spot extension, and the fitted BTC/ETH regime. Fields
whose historical source is unavailable remain null rather than using a venue-mismatched proxy.

The scanner accepts an underlying and comma-separated venue list. Defaults remain BTC and Thalex;
the Alpha UI passes its globally active venues. Other defaults are 4–14 DTE, at least 5% OTM,
mark at or below $400, $2,400 buying power, a 50% maximum quoted spread, and a 1.2x sizing reserve.

```bash
curl 'http://localhost:3100/api/alpha/lotto-scanner?underlying=BTC&venues=deribit,okx,thalex&premiumCap=400&minOtmPct=5&buyingPower=2400'
```

The response normalizes inverse and non-unit contract economics, includes venue contract metadata,
and ranks candidates by the 10x move in tenor-matched implied-move units before spread and mark.
Black-76 target levels hold current IV and remaining time constant; intrinsic target levels assume
expiry. The endpoint scans only and never submits an order.

## How it works

1. Server starts and begins bootstrapping venue adapters (~5–15s)
2. During bootstrap, data endpoints and `GET /api/ready` return `503`. The web client retries automatically
3. Once adapters connect, `isReady()` flips and data starts flowing
4. The chain view uses `WS /ws/chain` as the primary browser transport. The server coalesces venue deltas into enriched snapshots every 200ms instead of forwarding raw exchange ticks
5. In production (`NODE_ENV=production`), the server also serves the built web SPA from `../web/dist/`

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server listen port |
| `NODE_ENV` | | Set to `production` to serve static SPA |
| `DATABASE_URL` | | Optional Postgres source for older trade history and server persistence |
| `TRADE_SQLITE_PATH` | `.cache/ingest-trades.sqlite` | Read-only local source for pending trade history; must match ingest on shared persistent storage |
| `VOL_HEATMAP` | enabled | Set `0` to disable the heatmap worker and persistence |
| `VOL_HEATMAP_CACHE_PATH` | `.cache/vol-heatmap.ndjson` | Local heatmap journal; use an absolute path on persistent storage across deployments |
| `MARKET_DATA_DB_FLUSH_INTERVAL_MS` | `86400000` | Market-data database sync interval; heatmap sync clamps this to at least 24 hours |

## Heatmap persistence

1. Every completed 15-second BTC/ETH column is appended locally, including raw and skew-adjusted
   cells, trade markers, DVOL, ATM IV, and selection metadata. Local history works without Postgres.
2. Startup restores the last 24 hours and merges one Postgres read before live collection resumes.
   Local records win duplicate timestamps; a database outage does not discard the local history.
3. Postgres uploads and retention cleanup run on the existing restart-safe daily `FlushSchedule`.
   Its `.last-flush` marker preserves the schedule across restarts; first/overdue syncs run shortly
   after startup, and failed syncs retry. Shutdown and chart polling do not trigger database writes.
4. The API retains a rolling 24-hour window. Local files are compacted at startup and hourly;
   database cleanup runs with each daily sync. Missing collection periods remain gaps, and an
   unfinished 15-second column can be lost during a restart.

Apply `pnpm db:migrate` before starting the updated backend to create `vol_heatmap_columns`
(migration `0040`). Preserve the cache file and its `.last-flush` marker on a persistent volume.


## External options-news bots

The production API origin is **https://api.oggregator.xyz**. The landing and app hosts are
separate frontends. Public market/news reads require no bearer token; account endpoints retain
Clerk authentication. Use HTTPS/WSS from external hosts and validate JSON responses before use.

| Endpoint | Contract and behavior |
| --- | --- |
| `GET /api/bot/status` | Feed health, news cursor/retention, endpoint discovery, access limits and explicit capability gaps |
| `GET /api/bot/schema` | JSON Schemas for bot market responses, news event pages and news WebSocket frames |
| `GET /api/bot/market?underlying=BTC&expiry=YYYY-MM-DD&venues=deribit,okx` | Shared-runtime chain plus per-quote quality, venue counts, failed venues and canonical execution units; no REST response cache |
| `GET /api/news/events?after=CURSOR&limit=100` | Durable observations in arrival order, including GOOD, BAD, unclassified and observed content/classification revisions |
| `WS /ws/news?after=CURSOR` | Replays after a saved cursor, then sends event pages and 15s feed-health heartbeats |

`/api/bot/market` accepts `maxQuoteAgeMs` (100–60000, default 5000), `maxSpreadPct`
(default 50) and `requireGreeks=true|false` (default true). `dataReady` requires at least
one eligible quote on **each requested venue**. It is a market-data check, not order approval.
Inspect the quality entry for the exact instrument you intend to use. Eligibility requires an
unexpired expiry, known current venue state, a recent non-future quote timestamp, sized two-sided
non-crossed quotes, contract metadata, spread within the requested threshold and required Greeks.
Use `execution.bidSize` / `askSize` in base units and `execution.bidUsd` / `askUsd` in USD per
base unit. Legacy top-level sizes can be native contract counts. Public fees are estimates;
account fee tiers, margin and live order/fill state must come from the execution venue.
Thalex gamma/vega/theta are Black-76 r=0 derivatives; vega is USD per one volatility point.
The market response identifies that model basis. Nulls remain unavailable values.

### Resume without publication-time gaps

1. Fetch `/api/news/events?limit=200`. Without `after`, replay starts at the oldest retained
   observation. Process events in returned order and continue with `nextCursor` while `hasMore`.
2. Save each event and its cursor durably before acknowledging it in your consumer. A cursor is
   journal-specific and includes an epoch; do not construct it from a headline timestamp.
3. Connect `wss://api.oggregator.xyz/ws/news?after=YOUR_SAVED_CURSOR`. WebSocket reconnects resume
   from that cursor. Without `after`, the socket starts at the current tail for live-only delivery.
4. Expect at-least-once consumption around disconnects. Deduplicate by event cursor, not only
   headline ID: the same headline ID can have a later observed revision.
5. HTTP 409 / WebSocket `news_resync_required` means the cursor expired or belongs to another
   journal. Stop decisions, record the gap, and explicitly replay from the returned `oldestCursor`.
   Never silently replace an expired cursor with the current tail.

An observation retains publication `timestamp`, optional upstream `upstreamCreatedAt`, local
`receivedAt`, `firstReceivedAt` within retained journal history, and `revision`. `backfill=true` identifies observations discovered in the startup window;
check publication age before using them as fresh events. Historical
publication timestamps are not used as delivery watermarks. The upstream latest 200 observations
are overlapped on every poll; the existing `/api/news` dashboard endpoint keeps its GOOD filter.
GOOD/BAD are upstream filter labels, not directional sentiment or source verification. The journal
records observed edits/classification changes; the upstream does not provide a verified retraction
or correction lifecycle. Missing affected-asset, sentiment/confidence, macro-calendar actual/
consensus/revision and verification data are explicitly advertised as unavailable by status.

`NEWS_POLL_INTERVAL_MS` controls provider polling (1000–60000ms; default 15000). Lower values
increase provider requests and can affect provider quota/cost. WebSocket delivery adds up to one
second after the backend receives a batch; it cannot remove upstream collection/classifier delay.
`health.ready` expires after missed successful polls. Monitor `lastSuccessAgeMs`, consecutive
errors and saturated windows. The upstream latest-N feed cannot guarantee recovery of observations
that disappear during downtime or bursts; `completeHistoryGuaranteed` remains false.

The local journal is fsynced before delivery at `NEWS_DELIVERY_PATH` (default
`.cache/news-delivery.ndjson`), capped by `NEWS_DELIVERY_MAX_EVENTS` (default 50000). Keep it on
persistent storage and include it in backups. Replay is independent of optional Postgres and
survives backend restarts; an interrupted final append is repaired, while corrupt completed records
fail closed. A failed append blocks further journal writes until storage is repaired and the
backend restarts, preventing a partial write from corrupting the next batch. Keep a single backend writer per journal file. A replica needs shared delivery storage
and rate limits before it can promise the same cursor namespace. Existing news archives remain
publication-ordered; their old records have no reconstructed local first-received timestamp.

The existing rate budget is 600 HTTP requests/minute/IP, with `/bot/market` capped at 120/minute
and `/liquidity` at 60/minute. WebSockets allow 20 connections/IP. A chain socket has one active
subscription; request only venues/expiries needed and handle replacement snapshots, patches and
venue-status changes. Snapshot sequence jumps can accompany a replacement snapshot; do not apply
a patch to an unknown base. Bound client buffers, reconnect with backoff, and validate source ages.

### Validation

```bash
node scripts/check-bot-api.mjs https://api.oggregator.xyz
```

This read-only check discovers BTC expiries, checks each registered venue's bot market response,
validates news replay/schema endpoints, and verifies public WebSocket delivery. It submits no orders.
Instrument-specific depth remains the existing Thalex `/api/liquidity` surface; the venue's code 53
means its anonymous WebSocket connection cap is exhausted and needs an available authenticated
market-data session. Do not treat an unavailable depth service, a mark, a synthetic candle, or a
model estimate as observed executable liquidity. Continuous historical quote/depth replay and
account-specific execution data are not supplied by these public bot endpoints.
