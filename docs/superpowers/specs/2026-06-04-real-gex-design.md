# Real GEX — Dealer Inventory Book

## Goal

Replace the naive gamma-exposure calculation (`callGex − putGex`, signed purely by
option type, sized by static open interest) with a **dealer inventory book**:
a reconstructed estimate of dealer net position per contract, built by attributing
observed **open-interest changes (ΔOI)** to the **net taker (aggressor) side** of
trades in each interval. The GEX sign then reflects inferred dealer positioning
("tag by aggression") instead of a fixed call/put assumption.

This is the gold-standard ΔOI + flow model. It is additive in code (the naive
path survives as the in-function fallback) but **replaces** the user-facing GEX
output wherever a book exists.

### Decisions locked during brainstorming

1. **Methodology:** full ΔOI + flow positioning book (not flow-only, not naive).
2. **Data source:** durable Postgres `flow_trades` when available, live in-process
   `TradeRuntime` ring buffer as fallback.
3. **Output:** replace the current GEX (naive remains as internal cold-fallback).
4. **v1 scope:** BTC / ETH / SOL only (the `FLOW_ALWAYS_ON_UNDERLYINGS` set).
   Other underlyings keep the naive calc unchanged.
5. **Legacy-OI seed:** naive prior at first sight, then refine with flow.
6. **OI snapshot cadence:** ~15 minutes.
7. **Cold fallback:** where the book is cold/absent, render naive so the view is
   never empty.

## Core model

### Assumption made explicit

The market-maker is the **passive / resting** side of a trade; the **aggressor
(taker)** is the customer. Therefore an aggressive customer *buy* that increases
OI means the dealer is the passive *seller* → dealer is **short** that option →
**negative** gamma contribution.

### The signing rule

Computed per **venue · contract · interval** (interval ≈ snapshot cadence, ~15 min).
Inputs:

- `OI_prev`, `OI_now` — open interest at the previous and current snapshot.
- `ΔOI = OI_now − OI_prev`.
- `netFlow = Σ(buy contracts) − Σ(sell contracts)` over the interval, signed by
  taker side (from `flow_trades` or the live buffer).

| Case | Interpretation | Book update |
|---|---|---|
| `ΔOI > 0`, `netFlow > 0` | customers opened longs (aggressive buyers) | dealer **short**: `dealer += −\|ΔOI\|` |
| `ΔOI > 0`, `netFlow < 0` | customers opened shorts (aggressive sellers) | dealer **long**: `dealer += +\|ΔOI\|` |
| `ΔOI < 0` | net closing/unwind | scale: `dealer *= OI_now / OI_prev` (sign preserved, magnitude shrinks) |
| `ΔOI ≈ 0` (`\|ΔOI\| < epsilon`) | churn / no net position change | no change |
| `ΔOI > 0`, no observed flow | direction unknown | apply **naive-prior sign** for the increment: calls `+\|ΔOI\|`, puts `−\|ΔOI\|` |

Invariant: `|dealer_position| ≤ OI_now` at all times (magnitude is bounded by
`|ΔOI|` on opens and shrinks proportionally on closes). The book cannot run away.

`epsilon` is a small contract threshold (default `1e-6`) to ignore floating-point
noise; treat sub-epsilon `ΔOI` as zero.

### Bootstrap (legacy OI)

The first time a contract is observed with standing OI and no prior book row, seed:

```
dealer_position = +OI   for calls
dealer_position = −OI   for puts
```

This reproduces the naive result exactly at t0. Every subsequent interval refines
it. Consequence: GEX equals naive on day 1 and converges toward "real" as legacy
OI expires and attributed flow accumulates.

### GEX formula (replaces `computeGex`)

```
GEX_strike = Σ_venue Σ_contract(at strike)
               dealer_position(contracts) × gamma × contractSize × venueSpot²  / 1e6
```

- `gamma`, `contractSize`, `venueSpot` are unchanged from today (venue-reported
  greeks, per-venue spot reference).
- The **only** change vs the current formula: `dealer_position` (signed, from the
  book) replaces `±openInterest`. Call/put are summed together because the sign is
  now carried by the book, not by `callGex − putGex`.
- **Cold fallback:** for any contract with no book row (warm-up, DB absent,
  out-of-scope underlying), use its naive contribution (`+OI×…` for calls,
  `−OI×…` for puts). The profile is therefore never empty and is identical to
  today's output until the book warms.

## Architecture

```text
packages/core/src/core/
  enrichment.ts            — computeGex() gains optional 4th param `bookLookup`
  dealer-book.ts           — NEW. Pure book math (no I/O):
                               bootstrapNaivePosition(), signOiDelta(),
                               applyBookInterval(), DealerPosition / OiSnapshot types

packages/core/src/runtime/chain/
  projection.ts            — applyDeltas() forwards the same `bookLookup` into computeGex
  chain-runtime.ts         — snapshot build forwards `bookLookup`

packages/db/src/
  oi-snapshot-store.ts     — NEW. Postgres + Noop. time-series OI per venue·contract
  dealer-book-store.ts     — NEW. Postgres + Noop. current book state per venue·contract
  index.ts                 — export new stores + types
packages/db/migrations/
  0014_create_oi_snapshots_and_dealer_book.sql   — NEW

packages/server/src/
  services.ts              — instantiate stores (DATABASE_URL → Postgres else Noop),
                             instantiate DealerBookService, expose getBookLookup()
  dealer-book-service.ts   — NEW. ~15-min timer; reads OI via adapters, flow via
                             tradeStore/flowService, calls core book math, persists,
                             holds current book map, exposes bookLookup()
  routes/chains.ts         — pass bookLookup into buildEnrichedChain/computeGex
  routes/gex-all-expiries.ts — pass bookLookup into buildEnrichedChain

packages/web/src/features/gex/
  GexView.tsx              — update explainer copy (flow-reconstructed model +
                             cold-fallback note). No type/structure change.
```

### Why `computeGex` stays pure

`packages/core` CLAUDE.md: *"Enrichment is pure computation — no network calls,
no mutation."* The dealer book requires DB I/O and a timer, which belong in the
server. So:

- `computeGex(rows, strikes, spot, bookLookup?)` takes an **optional** injected
  `bookLookup: (venue: VenueId, symbol: string) => DealerPosition | undefined`.
- Omitted ⇒ byte-for-byte identical to today's naive output. This is the
  backward-compatibility / regression guarantee and keeps the change surgical.
- All book ownership (DB, timer, current map) lives in `server`. Core only does
  pure math and is fully unit-testable with synthetic snapshots + trade lists.

### Why this is safe for the fragile WS path

Per the project's WS guidance, new features consume feed state read-only and never
touch transport/subscription/health code. Here:

- The per-delta re-projection (`projection.ts` `applyDeltas`, which already calls
  `computeGex` when `includeGex`) receives the **same read-only `bookLookup`**.
  No socket, subscription, or health code changes.
- Book updates are out-of-band (every ~15 min), never on the delta hot path. The
  hot path only does a map lookup per contract.

## Data flow

### OI snapshot writer (DealerBookService timer, ~15 min)

For each underlying in `{BTC, ETH, SOL}`:

1. `listExpiries(underlying)` (union across adapters), then for each (venue, expiry)
   `getAdapter(venue).fetchOptionChain({underlying, expiry})` — the exact path
   `gex-all-expiries` already uses. Per-venue/expiry `try/catch`; a failed fetch is
   skipped (does not abort the tick).
2. Read `contract.quote.openInterest` per contract → build the current OI snapshot
   keyed by `(venue, symbol)` with `{strike, optionType, expiry, oi}`.
3. Persist the snapshot to `oi_snapshots` (when DB present).

### Book update (per tick, after snapshot)

For each contract in the new snapshot:

1. Look up `OI_prev` (last snapshot for this venue·symbol) and the existing book row.
2. If no prior book row → **bootstrap** (naive prior from current OI).
3. Else compute `ΔOI`, fetch interval flow, apply the **signing rule**, update the
   running `dealer_position`.
4. Interval flow source:
   - **Postgres:** `tradeStore.loadHistory({ mode:'live', underlying, venues:[v],
     instrumentName: symbol, startTs: prev_ts, endTs: now, limit })` → net signed
     contracts from `direction` + `contracts`.
   - **No DB:** the in-process `flowService` (`TradeRuntime`) ring buffer, filtered
     to `(venue, symbol)` and `tradeTs ∈ (prev_ts, now]`.
5. Upsert the book row to `dealer_book` (when DB present) and into the in-memory
   book map.

### Read path (GEX requests / pushes)

`DealerBookService.getBookLookup()` returns a synchronous closure over the
in-memory book map. `chains.ts`, `gex-all-expiries.ts`, and the chain-runtime
snapshot pass it into `buildEnrichedChain` / `computeGex`. Out-of-scope underlyings
pass `undefined` ⇒ unchanged naive behavior.

## Storage

Mirror the `flow_trades` / `iv_history_points` conventions (partitioning, pruning,
`Postgres*` + `Noop*` split keyed on `DATABASE_URL`).

`oi_snapshots` (time-series, monthly-partitioned + pruned like `flow_trades`):

```
venue TEXT, underlying TEXT, instrument_name TEXT, expiry TEXT,
strike DOUBLE PRECISION, option_type TEXT, open_interest DOUBLE PRECISION,
snapshot_ts TIMESTAMPTZ
PRIMARY KEY (instrument_name, snapshot_ts)   -- within partition
INDEX (venue, instrument_name, snapshot_ts DESC)  -- "latest prior" lookup
```

`dealer_book` (current state, one row per venue·contract, upserted):

```
venue TEXT, underlying TEXT, instrument_name TEXT, expiry TEXT,
strike DOUBLE PRECISION, option_type TEXT,
dealer_contracts DOUBLE PRECISION,   -- signed running position
last_oi DOUBLE PRECISION,            -- OI at last update (for next ΔOI)
last_snapshot_ts TIMESTAMPTZ,
updated_at TIMESTAMPTZ
PRIMARY KEY (venue, instrument_name)
INDEX (underlying)
```

Retention: prune `oi_snapshots` older than the longest live expiry window (reuse
the `flow_trades` prune cadence). Prune `dealer_book` rows whose `expiry` has
passed (expired contracts leave the book automatically).

No-DB mode: both stores are `Noop`; the book lives only in the in-memory map,
seeded fresh on each process start (naive prior) and refined with intraday flow
from the ring buffer. Resets on restart — accepted degraded mode.

## Output / UI

- `GexStrike = { strike, gexUsdMillions }` is **unchanged** — no `@oggregator/protocol`
  or `shared-types/enriched.ts` churn. The same field now carries real signs, so
  the "replace" is automatic across the GEX view, runtime projection, and
  all-expiries route.
- `GexView.tsx` copy change only: replace the "Sign convention assumes dealers are
  long calls and short puts (industry-standard approximation)" caveat with a short
  note that the sign is reconstructed from net flow (ΔOI attributed by taker side),
  and that cold/unobserved strikes fall back to the OI approximation.

## Error handling

- **Snapshot fetch failure** (per venue/expiry): caught and skipped. A missed tick
  just widens the next interval — ΔOI is computed against the last *successful*
  snapshot, so attribution still works (coarser).
- **DB absent / Noop:** in-memory intraday book (naive prior + ring-buffer flow);
  GEX never empty via cold-fallback.
- **Flow gap** (ΔOI ≠ 0 but no observed trades in the interval): apply naive-prior
  sign for that increment (documented degradation), not a hard failure.
- **Stale OI / null OI:** contracts with null OI are skipped (as today); their
  strikes fall back to naive (which also skips null-OI).

## Testing

- **Pure core (`dealer-book.test.ts`):** every signing case (open-buy, open-sell,
  close-unwind, churn, flow-gap), bootstrap naive prior, multi-interval
  accumulation, proportional-unwind scaling, `|dealer| ≤ OI` invariant,
  multi-venue summation.
- **`computeGex` regression:** with `bookLookup` omitted, output is identical to the
  current `enrichment-gex-edge.test.ts` expectations (proves backward compat). With
  a synthetic `bookLookup`, sign follows the book, not call/put.
- **DB (`oi-snapshot-store.test.ts`, `dealer-book-store.test.ts`):** insert/read
  round-trips and "latest prior snapshot" query; mirror the iv-history-store tests.
- **Server (`dealer-book-service.test.ts`):** one tick with mocked adapters
  (fixed OI) + a synthetic trade list + in-memory store → assert resulting book and
  resulting GEX sign for a known opening-buy scenario.

## Rollout (ops)

1. Add migration `0014_create_oi_snapshots_and_dealer_book.sql`; run migrations on
   the Scaleway Postgres.
2. Rebuild `@oggregator/core` (server runs from `dist/`), `@oggregator/db`,
   `@oggregator/protocol` (unchanged here but keep dist fresh), `@oggregator/server`.
3. Manual server redeploy on the Scaleway box (per deploy convention).
4. With `DATABASE_URL` set + the `packages/ingest` worker running → durable book.
   Otherwise degraded intraday mode (still correct, just non-persistent and
   shallower history).
5. The ~15-min timer adds bounded periodic load (BTC/ETH/SOL × venues × expiries,
   reusing the adapter fetch path already exercised by `gex-all-expiries`).

## Scope boundaries (v1)

- **In:** BTC / ETH / SOL; ΔOI+flow book; Postgres + buffer fallback; replace GEX
  output with cold-fallback to naive; GexView copy update; new stores + migration;
  DealerBookService.
- **Out (future):** zero-gamma / gamma-flip level derivation; per-strike
  observed-vs-assumed confidence field; trade-level (sub-interval) attribution;
  extending beyond BTC/ETH/SOL; backfilling legacy OI from any external source.

## Honest limitations

- Attribution is interval-netted, not trade-level — bursty mixed open/close flow in
  one ~15-min bucket is approximated by the net.
- Legacy OI predating `oi_snapshots` history carries the naive prior until it
  expires; the book converges, it does not start perfect.
- Durable accuracy requires `DATABASE_URL` + the ingest worker actually running.
- "Dealer = passive side" is an assumption; genuine dealer-initiated or
  inter-dealer aggressive flow is misattributed. This is inherent to all
  flow-based dealer-positioning models without a real positioning feed.
