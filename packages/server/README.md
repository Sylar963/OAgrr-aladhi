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
or correction lifecycle. Missing affected-asset, sentiment/confidence, structured macro-calendar
and verification data are explicitly advertised as unavailable by status. Literal macro figures
reported in headline text are available separately through `/api/news/macro`, described below.

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
The checker also validates public depth snapshots and reported macro headlines. The existing
Thalex `/api/liquidity` WebSocket surface remains separate from the public REST snapshots below;
its code 53 means its anonymous WebSocket connection cap is exhausted. Do not treat an unavailable
depth service, a mark, a synthetic candle, or a model estimate as observed executable liquidity.
Continuous historical quote/depth replay and account-specific execution data are not supplied
by these public bot endpoints.


### Scoped exchange health and public depth snapshots

`/api/bot/market` now includes `venueHealth`. Its `transport` reports connection state;
`exchange` retains the exchange-wide warning and affected indices; `state` is evaluated for
the requested underlying. `exchange.health.appliesToSubscription` states whether an explicit
index restriction affects this subscription. A Deribit `sol_eth` partial lock stays visible
while BTC can remain connected. SOL remains affected. Full or unknown lock scope, maintenance,
failed probes, disconnects and stale data remain blocking. A healthy platform push cannot erase
a retained public-status lock. Initial `/ws/chain` subscription acknowledgements and live status
frames expose the same details. Quote freshness is still checked per instrument.

`GET /api/bot/depth?venue=okx&underlying=BTC&expiry=YYYY-MM-DD&instrument=NATIVE_SYMBOL`
provides public depth snapshots across the nine registered venues. Choose `levels=1..20`,
`maxAgeMs=100..60000` and, for Paradex only, `access=api|interactive` (default `api`).
The symbol must resolve to the requested venue/underlying/expiry in canonical market metadata.
API and interactive liquidity are never substituted for one another.

Each level retains `nativePrice`, `nativeQuantity`, normalized `priceUsdPerBase` and
`quantityBase`. Contract multipliers, minimums, steps, native price tick, native premium currency,
conversion reference and its timestamp remain explicit. Stablecoin/USD parity is labeled as an
assumption. Inverse prices without a fresh conversion reference remain raw with a null USD value
and fail readiness. Empty/one-sided/crossed books and stale data are exposed with reasons; marks
and model prices never become depth. Scoped venue health also gates depth readiness.

Snapshots include exchange and local timestamps, timestamp meaning, provider sequence when
supplied, source level limits and access mode. `sequenceContinuityVerified=false` and
`depthLimited=true` are deliberate: these observations are not a certified sequenced execution
book or a fill guarantee. Coincall does not supply an exchange timestamp in its public book.
Thalex REST provides at most five levels and is cached for 30 seconds for occasional reads;
its original receive time is preserved and can fail a stricter requested freshness threshold.
Derive uses grouped ten-level full snapshots on a shared JSON-RPC socket, with a 40-instrument
cap and idle unsubscribe after 30 seconds. Other source snapshots are cached for one second.

Depth requests allow 30/minute/IP. Identical requests coalesce; the runtime allows at most eight
provider fetches in flight and 200 cached books. Capacity errors return 429; unavailable or invalid
provider books return 503. Snapshot success and execution eligibility are distinct: an empty
Paradex API book is valid market data and does not become interactive liquidity automatically.


The raw news observation also preserves `upstreamHeadlineTimestamp`, the additional timestamp
supplied by the existing feed. It remains a source string because its semantics are upstream-owned;
it does not replace publication or local arrival time. New delivery events include `changedFields`
so consumers can distinguish text/classification changes from metadata-only revisions.


### Prospective external-host recording

```bash
node scripts/record-bot-data.mjs https://api.oggregator.xyz BTC 2026-11-27 deribit,okx .cache/btc-events.ndjson
```

The collector records the exact public news and chain frames received by the external host, with
local receive time, connection session IDs and gap markers. It reconnects with backoff; news resumes
from its last durable cursor and chain connections start from a new snapshot. Each frame is fsynced
before advancing the atomic news checkpoint. An expired news cursor, invalid frame, write failure,
or more than 8 MiB of pending writes stops capture instead of silently dropping data. The default
file limit is 1 GiB (`BOT_CAPTURE_MAX_BYTES`); rotate to another output file when it is reached.
Stop with SIGINT/SIGTERM to drain writes. This is prospective capture, not a reconstructed historical
quote/depth archive. Keep gap markers and evaluate only observations available to the bot at its
recorded receive time. The existing historical candles/trades remain separate APIs.


### Macro figures already present in the news feed

`GET /api/news/macro?limit=200&after=CURSOR` exposes economic headlines and literal labeled
actual/forecast/consensus/previous/revised figures already present in their text. Numeric values
retain their explicit units and exact evidence spans. Missing values stay null. Each item carries
publication and local receive time, source URL, observation cursor and revision. Pagination advances
through raw observations, including pages with no macro items; follow `hasMore` and `nextCursor`.

This uses the existing news feed without another provider or paid calls. It is explicitly
`reported-headline-figures`, not a scheduled economic calendar or official verification. It does
not invent consensus, release schedules or revisions, and it does not turn GOOD/BAD into market
sentiment. Finnhub entitlement and a structured upstream calendar endpoint remain unverified;
`macroCalendar=false` stays truthful until that source is connected.
