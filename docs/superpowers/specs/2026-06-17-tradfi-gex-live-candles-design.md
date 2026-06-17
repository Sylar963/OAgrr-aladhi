# TradFi GEX — Live Underlying Candles — Design Spec

- **Date:** 2026-06-17
- **Status:** Design approved in brainstorming; pending spec review
- **Branch:** `feat/tradfi-gex-live-candles` (off `main`, which carries the merged GEX page from PR #28)
- **Builds on:** the TradFi GEX page (`features/tradfi/TradfiGexView.tsx` + `TradfiGexBandsChart.tsx`) and the isolated one-shot `CandleClient` (PR #25).

## Goal

On the TradFi **GEX Bands** view, replace the frozen candle snapshot with a **live backend
candle stream** (real OHLC + volume from a live DXLink candle subscription), so:

- the **forming candle "counts"** in real time per the selected timeframe (5m/1h/4h/1d), and a
  new bar appends at each interval boundary;
- the **spot line rides the live candle close** (live spot for free).

GEX **walls stay on the existing ~5s poll** (chosen in brainstorming — walls are structural and
the ALL-expiries aggregate has no live feed). **TradFi-only**; the crypto GEX page is byte-identical.

## Data entitlement — read this first

The TastyTrade account is currently on the **free / delayed tier (~15-min delayed)**; the
real-time entitlement (paid) is coming.

- **The architecture is entitlement-agnostic.** DXLink streams the same way whether the data is
  real-time or delayed — the subscribe / ref-count / `series.update` mechanism is identical.
- On the **delayed tier the "counting candle" updates in ~15-min delayed steps, not tick-by-tick.**
  When the live-data entitlement is on, the **same code** simply streams real-time. **No code
  change at the flip.**
- **Verification caveat:** while building/smoke-testing on the free tier, expect stepped/delayed
  updates — that is the feed, not a bug. Do not "fix" it.
- **Honesty:** the "LIVE" pill reflects **connection** state only. Labeling 15-min-delayed bars as
  real-time would be misleading on a trading dashboard, so a **"delayed" data badge** (and the
  entitlement detection it needs) is a **deferred follow-up**, out of v1.

## What already exists (so we don't rebuild it)

- **One-shot `CandleClient`** (`tastytrade/candle-client.ts`, channel 1, isolated — PR #25):
  `getCandles()` subscribes `SYM{=period}`, buffers `FEED_DATA` bars, and on
  `isSnapshotComplete(flags)` **unsubscribes + resolves** (`candle-client.ts:100,109`). The socket
  itself stays connected; only the *subscription* is removed. A subscription you **don't** remove
  keeps streaming the forming bar (same `time`) and new bars — which is exactly why the one-shot
  removes it.
- **`/ws/chain` transport pattern** (`routes/ws-chain.ts`): Fastify `{ websocket: true }`,
  `ensureChainSubscribed` on open, `ChainPusher` pushing every 200ms, `clearInterval` + dispose on
  close. The candle WS route mirrors this lifecycle.
- **REST `/underlying-candles`** + `useTradfiUnderlyingCandles` (`staleTime: 60_000`, no
  `refetchInterval` → the chart is genuinely frozen today, as observed).
- **`TradfiGexBandsChart`** renders candles via `series.setData(...)`, and call/put/flip walls +
  spot as lightweight-charts price lines; walls via `computeGammaWalls(gex, spotPrice)`.
- **Crypto `useChainWs`** (`hooks/useChainWs.ts`) — the web WS pattern to mirror: idempotent
  `connect()`, backoff reconnect, StrictMode-safe teardown, params via ref.
- **No TradFi WS consumer on the web yet** (the TradFi chain view is REST-polling) — so a small
  `tradfiWsUrl` helper + a minimal live hook are new (far simpler than `useChainWs`: one
  subscription, no subId/delta machinery; the chart just calls `series.update`).

## Architecture — Approach 1 (chosen)

Extend the **existing isolated `CandleClient`** with a ref-counted live registry and add a
`/ws/underlying-candles` route mirroring `/ws/chain`. Rationale (vs. a separate `LiveCandleClient`
or a REST-poll buffer): it is the faithful "true backend live candles" choice, reuses the isolated
candle client and the `/ws/chain` transport already in production, and **opens no new DXLink
socket**. The shipped one-shot path stays byte-identical **except one guarded line**.

### Backend — `CandleClient` live registry (`tastytrade/candle-client.ts`, edit)

- New state: `private live = new Map<candleSymbol, { subs: Set<(bar: RawCandle) => void>; subscribed: boolean }>`,
  keyed by the full candle symbol `SYM{=period}` (same key space as `pending`).
- `subscribeLive(streamerSymbol, period, fromTimeSec, onBar): () => void`
  - `candleSymbol = ${streamerSymbol}{=${period}}`; get/create the live entry; add `onBar`.
  - If not yet `subscribed` **and** `ready` → send `buildCandleSubscribe(...)` (with `fromTime`, so
    the snapshot replays first), set `subscribed = true`. If not ready, queue via `readyWaiters`
    (mirrors `getCandles`).
  - Returns an unsubscribe fn: remove `onBar`; if its `subs` set is now empty, run
    `maybeUnsubscribe(candleSymbol)` and drop the entry.
- `onData(bars)`: after the **existing** `pending` routing, **also** fan each `bar` out to
  `live.get(bar.symbol)?.subs`. Live consumers receive the snapshot bars **and** the live tail. A
  live frame with `isSnapshotComplete(flags)` is **not** unsubscribed (that is the whole point) —
  optionally forward a `final`/`snapshotComplete` marker so the route/web can distinguish
  "history done, now live".
- **The one delicate edit** — `private maybeUnsubscribe(candleSymbol)`: send
  `buildCandleUnsubscribe(...)` **only when** there is no remaining `pending` one-shot **and** no
  live `subs` for that symbol. `finish()` calls `maybeUnsubscribe` instead of unconditionally
  unsubscribing; the live-unsub path calls it too. This is what stops a one-shot and a live sub for
  the **same** symbol from tearing each other's subscription out.
- `dispose()`: also clear `live` and unsubscribe its symbols.

### Backend — `/ws/underlying-candles` route (`routes/ws-underlying-candles.ts`, new)

- Fastify `{ websocket: true }`, query `{ underlying, interval }`. Validate `underlying` +
  `interval` (`InstrumentCandleIntervalSchema`). If `!deps.candleClient || !isReady()` →
  `socket.send({ type: 'error', ... })` + `close()` (web falls back to REST), mirroring the
  existing 503 guard in `underlying-candles.ts:15`.
- `period = intervalToPeriod(interval)`; `fromTime` = a **small recent window** (a few buckets —
  enough to seed the forming bar; the chart's full history still comes from REST).
- On open: `const unsub = deps.candleClient.subscribeLive(underlying, period, fromTime, onBar)`.
  Buffer the latest bar(s) and push **coalesced ~200ms** (mirror `ChainPusher`) as
  `{ type: 'bar', ts, o, h, l, c, vol, final? }`.
- On `socket.on('close')`: `unsub()` + `clearInterval`. Ref-counting in the client keeps the DXLink
  sub alive only while ≥1 socket is open for that symbol.
- Register in `app.ts` next to `wsChainRoute(deps)`.
- Reuse the existing `RawCandle → { ts, o, h, l, c, vol }` mapping from `runtime/candles.ts` (factor
  out a single-bar mapper so REST and WS agree byte-for-byte on shape/units).

### Frontend — `tradfiWsUrl()` (`lib/tradfi-http.ts`, edit)

Mirror `wsUrl` from `@lib/http`: derive `ws(s)://` from `VITE_TRADFI_API_BASE` (default
`/tradfi-api`, resolved against `location` for relative bases), with an optional
`VITE_TRADFI_WS_URL` override (parallel to `VITE_WS_URL`).

### Frontend — `useTradfiUnderlyingCandlesLive` hook (`features/tradfi/...`, new)

A minimal `useChainWs`: idempotent connect, backoff reconnect, teardown on unmount, params via
ref, StrictMode-safe. Inputs `{ underlying, interval, enabled, onBar }`; calls the stable `onBar`
per live bar (**no React state per tick** → no re-render churn). Exposes `connectionState` for a
LIVE pill / fallback decision.

### Frontend — `TradfiGexBandsChart` wiring (edit)

- Keep REST `useTradfiUnderlyingCandles` for initial `series.setData(...)` (history) **and**
  fallback.
- Add `useTradfiUnderlyingCandlesLive({ underlying, interval: sel.interval, enabled })` whose
  `onBar`:
  - `seriesRef.current?.update({ time: tsToSec(bar.ts), open, high, low, close })` — merges the
    forming bar / appends a new bar at the interval boundary (lightweight-charts merges-or-appends
    by `time` natively);
  - drives the **spot line from `bar.c`** (live close = live spot), falling back to the `spotPrice`
    prop until the first live bar arrives.
- `interval` = `sel.interval` (the selected range's interval) so "counting candles depend on the
  timeframe" is honored. Walls/GEX continue on the 5s poll, untouched.
- Optional small "LIVE" indicator near the range toggle when `connectionState === 'live'`.

## Data flow

```
REST /underlying-candles  ─→ series.setData(history)        [first paint + fallback]
WS  /ws/underlying-candles ─→ onBar ─→ series.update(bar)    [forming bar merges; new bar appends]
                                   └─→ spot price line = bar.c
GEX walls: useTradfiChain / useTradfiAllExpiriesGex (5s poll) → computeGammaWalls  [unchanged]
```

## Surgical guarantees

- **One-shot path byte-identical except `maybeUnsubscribe`** — `getCandles()` still resolves and
  unsubscribes when no live sub exists for the symbol.
- **No new DXLink socket** — reuses the channel-1 candle client; no server-wide new timers beyond
  the per-connection pusher (mirrors `/ws/chain`).
- **Crypto GEX byte-identical**; **TradFi `/chains`, walls, and Bars view untouched** (only the
  Bands candle source changes).

## Scope (v1)

- **Underlyings:** follows the GEX page (index-first: SPX/NDX/RUT).
- **Underlying candle only** — not the per-option `/candles` (per-strike chart); that is a clean
  later extension.
- **Bands view** is where live candles render; the **Bars** view is unaffected.

## Testing

- **Backend `CandleClient`** (fake socket, mirroring existing candle-client tests): `subscribeLive`
  routes snapshot + live tail to consumers; ref-count teardown (DXLink unsub only on the **last**
  leaver); the **guard both directions** (one-shot `finish()` does **not** unsubscribe while a live
  sub exists; live-unsub does **not** unsubscribe while a `pending` one-shot exists); not-ready
  queue path; `dispose()` clears live.
- **Route** `/ws/underlying-candles`: connect → subscribe; bad params → error + close; candle
  client absent / not-ready → error + close.
- **Web** (jsdom WS mock; web test gotchas — mock `useIsMobile`, plain matchers, explicit cleanup,
  no array-index keys): hook connect / reconnect / teardown + StrictMode double-invoke safe; Bands
  chart calls `series.update` on a live bar and the spot line follows the close (mock the
  lightweight-charts series).
- **Regression:** REST `/underlying-candles` response unchanged; one-shot snapshot still resolves +
  unsubscribes when no live sub present; crypto GEX page byte-identical.

## Risks / honest caveats

- **Delayed tier** until the entitlement flip (see "Data entitlement"): updates are 15-min delayed,
  not tick-by-tick — expected, not a bug.
- **Candle DXLink socket has no auto-reconnect today** — if it drops, live subs go silent; v1
  degrades to the REST fallback (so never worse than today). Auto-reconnecting that socket is a
  later hardening.
- **`series.update` by `time`** relies on consistent ts units — funnel every bar through `tsToSec`
  (REST and WS alike) so the forming bar merges instead of duplicating.
- **Shared subscription lifecycle** (one-shot ↔ live for the same symbol) is the one delicate spot
  — covered by the ref-count guard tests above.

## Open calls for spec review

1. **WS history window** (`fromTime`): small recent tail (recommended — REST owns history) vs. a
   fuller window (WS self-sufficient, larger payload).
2. **Live message cadence:** coalesce ~200ms like `ChainPusher` (recommended) vs. forward each
   frame (≤10/s via the 100ms aggregation).
3. **Spot line source:** ride the live candle close (recommended) vs. keep the `spotPrice` prop.
4. **"Delayed" data badge:** defer (recommended) vs. add now (needs entitlement detection).

## Out of scope (v1)

- Per-option live candles (`/candles`).
- Live walls / live GEX (walls stay on the poll).
- Crypto GEX changes.
- Candle DXLink socket auto-reconnect.
- Flow/candle persistence.
- "Delayed" data badge + entitlement detection.

## Deploy notes

- TradFi runs as the separate `@oggregator/tradfi` service — shipping requires a **manual Scaleway
  redeploy** (no DB migration; nothing persisted).
- Web: standard build + redeploy.
- `docs/` is gitignored — **force-add** this spec (`git add -f`) when committing.
