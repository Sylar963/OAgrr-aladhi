# TradFi GEX — Design Spec

- **Date:** 2026-06-16
- **Status:** Design approved in brainstorming; pending spec review
- **Branch (planned):** `feat/tradfi-gex`

## Goal

Clone the crypto GEX experience for the TradFi (TastyTrade/DXLink) backend: a dedicated
**GEX page** in the TradFi frontend with **Bars** and **Bands** views, powered by a
**live-signed dealer-flow** model. Reuse the crypto GEX math and rendering; source data
from the TradFi service.

## What already exists (so we don't rebuild it)

- GEX math is venue-agnostic in `@oggregator/core`: `computeGex`, `combineGex`,
  `buildEnrichedChain`. Dealer-book primitives are exported too: `signOiDelta`,
  `applyBookInterval`, `bootstrapNaivePosition`, `BookLookup`, `DealerPosition`.
- TradFi `/chains` already calls `buildEnrichedChain(...)` **without** a `bookLookup`
  (`packages/tradfi/src/runtime/chain.ts:155`), so it already emits **naive** per-expiry
  GEX in `chain.gex` — just unsigned and not rendered.
- The TradFi feed already receives DXLink `Trade`, `Quote`, `Greeks`, `Summary` events per
  contract. Present today: gamma (Greeks), OI (Summary = prior-day OCC), spot (underlying
  Quote/Trade), and the 100× contract multiplier.
- `/underlying-candles` (PR #27) supplies underlying OHLC for the Bands overlay;
  `use-tradfi-underlying-candles.ts` already wraps it on the frontend.
- The TradFi frontend is a **separate shell** (`features/tradfi/TradfiApp.tsx`, entered via
  `assetMode==='tradfi'`). It currently renders only `TradfiChainView` and has **no
  internal page nav**.

## The model — live-signed dealer flow

Equity OI refreshes only **once daily** (prior-day OCC via DXLink `Summary`), so we sign
position by **flow**, not by intraday ΔOI. Per contract:

```
dealerContracts = naiveBase − netCustomerFlow

  naiveBase       = right === 'call' ? +OI : −OI    // OI = current Summary OI, re-anchored daily
  netCustomerFlow = Σ Lee-Ready-signed taker contracts since session open   // customer-buy = +
```

- **Cold-book = byte-identical to today.** At `netCustomerFlow = 0` this reduces exactly to
  the current naive TradFi GEX (`Σcalls OI·γ − Σputs OI·γ`). The empty/cold book is a
  no-op fallback — never worse than today.
- **Sign convention** matches `signOiDelta`: customers net-buying a contract → dealer
  shorter gamma (GEX more negative for that strike); net-selling → longer.
- **Live feel.** GEX = `computeGex(rows, …, bookLookup)`. Gamma and spot are live, so GEX
  moves on every push; positioning moves on every classified trade.
- **Optional clamp** on `|dealerContracts|` to guard against a runaway session flipping a
  large-OI strike (design detail; default cap ~ `OI + dayVolume`).

### Lee-Ready classification

For each `Trade` event, compare the trade price to the contract's prevailing bid/ask mid
(already in the store from `Quote` events): above mid → buy-initiated, below → sell-initiated,
at mid → tick-rule fallback (vs last trade price). Add signed size to the contract's
`netFlow`. Reset accumulators at US session open.

**Caveat:** Lee-Ready is noisier on options than equities (wide spreads, spread legs, mid
prints, off-exchange) — the sign is a good estimate, not ground truth.

## Backend changes (`packages/tradfi`)

1. **`src/runtime/flow-book.ts`** *(new)* — owns per-contract `{ netFlow, lastTradePrice,
   lastTickDir }`. `recordTrade(symbol, price, size, bid, ask)` classifies + accumulates;
   `resetSession()` clears at the session boundary; exposes a `BookLookup` that combines
   current OI (read from the quote store) + `netFlow` → `DealerPosition` (anchored via
   `bootstrapNaivePosition`). **In-memory only**, no persistence — fully reconstructable
   from live OI + today's flow.
2. **`src/tastytrade/state.ts`** *(edit)* — in the `Trade` case, call
   `flowBook.recordTrade(...)` with the contract's current bid/ask from the store.
   (Trade + Quote are already handled here — no new event types, no new subscriptions.)
3. **`src/runtime/chain.ts`** *(edit, ~1 line)* — pass `bookLookup` into the existing
   `buildEnrichedChain` call (currently omitted → naive).
4. **`src/routes/gex-all-expiries.ts`** *(new)* — `GET /gex-all-expiries?underlying=…`:
   loop expiries → `buildEnrichedChain(…, bookLookup)` per expiry → `combineGex` →
   `{ underlying, expiries, spotPrice, gex }` (mirror the crypto route's response shape).
5. **Session reset** — clear `flowBook` at US equity session open, reusing
   `isUsEquityMarketOpen` + a date-rollover guard inside the existing health/feed loop.
   No new timers or sockets.

### Surgical guarantees

- **Crypto path untouched** — `packages/server` `DealerBookService` and `core/enrichment.ts`
  unchanged; `computeGex` naive path (`bookLookup=undefined`) stays byte-identical.
- **TradFi `/chains` non-GEX fields unchanged** — injecting `bookLookup` alters only the
  `gex` array; strikes/greeks/quotes are identical.
- **WS transport untouched** — `Trade` events already arrive; we only *retain + classify*
  in the state layer (respects the WS-fragility rule: no new sockets/subscriptions).

## Frontend changes (`packages/web`)

1. **TradFi page nav** — add a minimal page switcher to the TradFi shell
   (`features/tradfi/TradfiApp.tsx`): pages **Chain | GEX** (extensible). Track the active
   TradFi page in `app-store` (e.g. `tradfiPage`), URL-synced like the crypto tabs if cheap.
2. **`features/tradfi/TradfiGexView.tsx`** *(new)* — the GEX page. Reuses the crypto GEX
   **rendering** (Bars list, `GexBandsChart`, `gex-wall-utils`, the Bars/Bands toggle) fed
   by TradFi data:
   - **Per-expiry GEX + spot:** already in `useTradfiChain(...)` → `chain.gex` +
     `chain.stats.indexPriceUsd` (signed once the backend change lands).
   - **All-expiries GEX + spot:** new `useTradfiAllExpiriesGex(underlying)` →
     `/gex-all-expiries`.
   - **Bands underlying candles:** existing `useTradfiUnderlyingCandles(underlying)`.
3. **Reuse strategy (recommended): zero changes to the crypto `GexView`.** Export the
   presentational pieces (`GexBandsChart`, the bars renderer, `gex-wall-utils`) from
   `features/gex/index.ts` and compose them in `TradfiGexView`. This satisfies the web rule
   "import only from a feature's `index.ts`" and keeps the shipped crypto GEX page
   byte-identical.
   - *Alternative (not chosen):* refactor `GexView` into a data-injected presentational core
     plus two thin page wrappers (crypto/TradFi). DRYer, but touches the shipped crypto page.

## Scope (v1)

- **Underlyings: index-first** — SPX, NDX, RUT (liquid; dealer-gamma most watched;
  Lee-Ready least noisy). Equities are a later config flip (lazy per-chain subscription
  already scopes the trade tape to opened chains).
- **Views:** per-expiry **and** all-expiries aggregate; **Bars and Bands**.

## Testing

- `flow-book`: Lee-Ready buy/sell/at-mid tick fallback; anchor-from-OI; accumulate;
  session reset; cold→naive equivalence; clamp.
- `bookLookup` → `computeGex`: signed-vs-naive divergence on a fixture (mirrors
  `dealer-book.test.ts`).
- `/gex-all-expiries`: `combineGex` aggregation + response shape.
- Frontend: `TradfiGexView` render (jsdom constraints — mock `useIsMobile`, plain matchers,
  explicit cleanup, no array-index keys); TradFi page-nav switch.
- Regression: crypto GEX page byte-identical; TradFi `/chains` non-GEX fields unchanged.

## Risks / honest caveats

- Lee-Ready noise on options → the sign is an estimate.
- In-memory flow resets on restart → reverts toward naive until trades repopulate
  (acceptable v1; persistence is a later add).
- Positioning magnitude is only as fresh as the last OCC OI publish (daily).
- Thin per-strike option volume on illiquid names → sparse flow signal (another reason for
  index-first).

## Open calls for spec review

1. **Reuse strategy:** zero-touch crypto `GexView` (recommended) vs refactor into a shared
   presentational core.
2. **Underlyings:** index-first (recommended) vs include equities in v1.
3. **Persistence:** in-memory v1 (recommended) vs add light flow persistence now.

## Out of scope (v1)

- Persisted dealer book / flow history.
- Equity single-name coverage at scale.
- Real Thalex/live execution ties.

## Deploy notes

- `docs/` is gitignored — force-add this spec (`git add -f`) when committing.
- TradFi runs as the separate `@oggregator/tradfi` service; shipping requires a manual
  Scaleway redeploy (no DB migration needed — the flow book is in-memory).
