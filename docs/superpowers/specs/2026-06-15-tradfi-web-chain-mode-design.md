# TradFi web mode (chain page) — design spec

**Date:** 2026-06-15
**Status:** Approved, pre-implementation
**Branch:** `feat/tastytrade-v2-chain` (continues the TradFi work)

## 1. Goal

Add a **TradFi mode** to the existing `@oggregator/web` SPA: a yellow **TRADFI** button flips the
whole app into a **Bloomberg-style black/amber theme** showing a **cloned chain page** wired to the
separate `@oggregator/tradfi` backend. Plus: **fix the `Cannot read properties of undefined
(reading 'toFixed')`** crash on the chain page (required — TradFi data is null-heavy and would crash
the same components).

For start, the TradFi mode contains **only the Chain page**.

## 2. Decisions (locked)

- **App *mode*, not a tab.** Zustand `assetMode: 'crypto' | 'tradfi'`. The TRADFI button toggles it;
  the black/amber theme takes over the whole shell in `tradfi` mode.
- **REST polling** for TradFi chain data (TanStack Query `refetchInterval`). Data is 15-min delayed,
  so streaming buys nothing now; the TradFi `/ws/chain` push is a later add.
- **Theme by token override** — a `[data-mode="tradfi"]` block remaps the existing CSS variables to
  black bg + amber/yellow. Components already consume tokens (and the font is already IBM Plex
  Mono), so the cloned page restyles with no per-component CSS rewrite.
- **Reuse render components** — clone the *container* (`ChainView` → `TradfiChainView`, single-venue)
  but reuse `ChainTable` / `StatStrip` / `ExpiryBar` as-is.
- **Fix the `toFixed` crash** as part of this work (harden chain-render numeric formatting +
  reproduce the reported crash).
- **Crypto app stays intact** — only additive touches (the entry button, an `assetMode` branch).

## 3. The `toFixed` fix

Confirmed unguarded: `features/chain/StatStrip.tsx:143` — `marketStats.dvol.ivr.toFixed(0)` (the `&&`
guards `dvol`, not `ivr`). Approach:
- **Reproduce** the reported crash (run web against the backend, capture the failing component/stack).
- **Sweep** every `.toFixed(` reachable from the chain render path — `StatStrip`, `ChainTable` cells,
  `ExpandedRow`, `QuickTrade`, `MobileStrikeCard`, and the shared cell UI (`VenueCard`, `SpreadPill`,
  `ForwardDeltaPill`, `IvChip`) — and guard each against `undefined`/`null` (prefer the existing
  `fmt*` helpers in `lib/format`, which already null-guard, over raw `.toFixed`).
- **Why now:** TradFi rows carry `null` bidIv/askIv, `null` fees, `OI: 0`, `null` volume, and no
  `marketStats` — the same components must render that without crashing.

## 4. Architecture

```
TopBar (crypto)  ──[TRADFI button, yellow]──>  setAssetMode('tradfi')
App.tsx: assetMode === 'tradfi'  ?  <TradfiApp/>  :  <existing crypto AppShell>
TradfiApp: root [data-mode="tradfi"]  →  TradfiShell (slim top bar: underlying + expiry + "← oggregator")
                                          └─ TradfiChainView  (single-venue 'tastytrade')
```

- **`assetMode`** lives in `app-store` (UI state). `setAssetMode` toggles; `← oggregator` returns to
  `crypto`.
- **`TradfiApp`** is a thin shell (own slim top bar + the `data-mode="tradfi"` wrapper) so the crypto
  `AppShell` is untouched. It renders only `TradfiChainView` for now.
- **`TradfiChainView`** = `ChainView` minus multi-venue machinery: no `VenueSidebar`, no
  `activeVenues` (venue fixed to `tastytrade`), data from the TradFi hooks. Reuses `ExpiryBar`,
  `StatStrip` (its `dvol` block self-skips with no `marketStats`), `ChainTable` (passed
  `activeVenues={['tastytrade']}`).

## 5. Theme

New `styles/tradfi-theme.css`, imported by `styles/index.css`:

```css
[data-mode="tradfi"] {
  --bg-base: #000000;
  --bg-surface: #0a0a00;        /* near-black with warm tint */
  --bg-elevated: #141200;
  --accent-primary: #ffb300;    /* Bloomberg amber */
  --color-warning: #ffcc00;
  --border-default: #2a2410;
  /* …remap the token set; keep profit/loss green/red for readability */
}
```

The TRADFI entry button is styled yellow/amber explicitly.

## 6. Data wiring (separate backend)

- **Env:** add `VITE_TRADFI_API_BASE` (`env.d.ts`). Dev: a Vite proxy `/tradfi-api → http://localhost:3200`
  (mirrors the existing `/api → :3100`); prod: the subdomain (e.g. `https://tradfi-api.oggregator.xyz`),
  routing owned by ops.
- **`lib/tradfi-http.ts`** — `tradfiFetchJson<T>(path)` against `VITE_TRADFI_API_BASE ?? '/tradfi-api'`
  (mirrors `lib/http.ts`, minus the paper `X-API-Key`).
- **`features/tradfi/queries.ts`** — `useTradfiUnderlyings()` (`/underlyings`),
  `useTradfiExpiries(underlying)` (`/expiries?underlying=`), `useTradfiChain(underlying, expiry)`
  (`/chains?underlying=&expiry=`, `refetchInterval: 5000`). The TradFi `/chains` returns the same
  `EnrichedChainResponse` shape, so `shared-types/enriched.ts` is reused directly.
- **Venue meta:** add a `tastytrade` entry to `lib/venue-meta` + colors (amber) so `ChainTable`
  renders the single venue column with proper chrome.

## 7. File structure

```
NEW:
  src/features/tradfi/TradfiApp.tsx        mode shell + [data-mode] wrapper + slim top bar
  src/features/tradfi/TradfiChainView.tsx  cloned single-venue chain container
  src/features/tradfi/queries.ts           TradFi TanStack Query hooks (REST poll)
  src/features/tradfi/index.ts             public exports
  src/features/tradfi/*.module.css         shell/topbar styles
  src/lib/tradfi-http.ts                   tradfiFetchJson
  src/styles/tradfi-theme.css              [data-mode="tradfi"] token overrides
TOUCH (additive):
  src/stores/app-store.ts                  + assetMode / setAssetMode
  src/App.tsx                              + assetMode branch
  src/components/layout/TopBar.tsx         + yellow TRADFI entry button
  src/env.d.ts                             + VITE_TRADFI_API_BASE
  vite.config.ts                           + /tradfi-api dev proxy
  src/styles/index.css                     @import tradfi-theme.css
  src/lib/venue-meta(+colors)              + tastytrade entry
  (bug) src/features/chain/StatStrip.tsx + chain-render cell components — guard .toFixed
```

## 8. Out of scope (later)

Other TradFi tabs (surface/gex/flow/builder); TradFi `/ws/chain` streaming (REST poll for now);
domain/subdomain routing + the real-time market-data agreement (ops); persisting `assetMode` across
reloads (nice-to-have).

## 9. Testing

- `app-store` test: `setAssetMode` toggles. (vitest, jsdom — no matchMedia/jest-dom per repo gotchas.)
- `TradfiChainView` smoke: renders the table from a mocked `useTradfiChain` payload (TradFi-shaped,
  null-heavy) **without crashing** — this is also the regression guard for the `toFixed` fix.
- `tradfi/queries`: hit the right paths against the TradFi base (mocked fetch).
- `StatStrip`: renders with `marketStats.dvol.ivr === undefined` without throwing.
- `pnpm --filter @oggregator/web typecheck` + `test:run` green; full repo green.

## 10. Risks / verify-at-implementation

- **Reproduce the exact `toFixed` crash** first (it may be a cell component, not only `StatStrip`).
- **`ChainTable` with one venue** — confirm it degrades cleanly (best-venue highlight, venue dot) for
  a single `tastytrade` column; add venue-meta so logos/colors resolve.
- **Dev proxy** — the TradFi service must be running on :3200 for the dev proxy to work; otherwise
  the page shows the loading/empty state (handle gracefully, like the crypto 503 retry).
- **`assetMode` + `useTabUrlSync`** — ensure the crypto tab-URL sync doesn't fight the mode switch.
