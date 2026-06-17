# Shareable ticker routes — design

- **Date:** 2026-06-16
- **Status:** Approved (design)
- **Area:** `@oggregator/web` — client-side hash routing
- **Server / WS impact:** none

## Problem

Sharing a link to the app loses the ticker you were looking at. The hash
router (`hooks/useTabUrlSync.ts`) encodes only the **tab** (`#chain`,
`#volatility`, …) or the TradFi asset mode (`#tradfi`). The selected ticker
lives in Zustand (`underlying` for crypto, `tradfiUnderlying` for TradFi) and is
never written to the URL. So `app.oggregator.xyz/#tradfi` always reopens the
default ticker, no matter what the sharer was viewing.

This affects TradFi primarily, and crypto venues equally (same mechanism).

## Scope

**In scope**

- Encode the selected ticker in the URL hash so a shared link restores it.
- Encode the sub-view: the crypto tab (already encoded) and the TradFi page
  (`chain` | `gex`).
- Works for both TradFi and crypto.

**Out of scope (explicit decisions)**

- **Link-preview / Open Graph cards.** Decided: *skip for now.* The app is a
  static SPA on Vercel with hash routing; the fragment after `#` is never sent
  to the server and crawlers don't run JS, so per-ticker preview images would
  require a Vercel edge/serverless function + an OG-image generator. Deferred as
  a separate piece of work.
- **Expiry in the URL.** Decided: not encoded; expiry resets to its default when
  a shared link is opened. (`setUnderlying` / `setTradfiUnderlying` already clear
  expiry on ticker change, so this is consistent.)
- **Venue filter in the URL.** Out of scope — the ask is "ticker", and encoding
  the venue set would bloat URLs.

## URL grammar

| View   | Hash format            | Examples                                 |
| ------ | ---------------------- | ---------------------------------------- |
| Crypto | `#<tab>/<TICKER>`      | `#chain/BTC`, `#volatility/ETH`, `#gex/SOL` |
| TradFi | `#tradfi/<page>/<TICKER>` | `#tradfi/chain/AAPL`, `#tradfi/gex/TSLA` |

Rules:

- **Ticker is UPPERCASE** when written; parsed case-insensitively.
- **Empty ticker → segment omitted.** Before any TradFi selection
  (`tradfiUnderlying === ''`) the hash is `#tradfi/chain`, not `#tradfi/chain/`.
  Crypto `underlying` defaults to `BTC`, so crypto always has a ticker segment.
- **Back-compatible.** Legacy links resolve cleanly:
  - `#chain` → chain tab, default underlying.
  - `#tradfi` → TradFi, `chain` page, current/empty ticker.
- **Resilient to an omitted page.** `#tradfi/AAPL` — `AAPL` is not a known page
  slug (`chain` | `gex`), so it is treated as the ticker and the page defaults
  to `chain`.
- **Unknown tab slug → default tab**, with no ticker inference (we do not treat
  an unknown first crypto segment as a ticker — avoids masking typos).

## Module design

The grammar is extracted into a pure, DOM-free module so it is unit-testable in
isolation; the hook becomes a thin adapter between that module and the
DOM/store.

### New: `lib/route-hash.ts` (pure)

```ts
type RouteState =
  | { mode: 'crypto'; tab: TabId; ticker: string | null }
  | { mode: 'tradfi'; page: TradfiPage; ticker: string | null };

// Hash string → normalized route state (mount + hashchange).
function parseHash(rawHash: string): RouteState;

// Current store-derived state → hash string (store change → history).
function buildHash(state: RouteState): string;
```

- `parseHash` strips a leading `#`, splits on `/`, and applies the grammar
  rules above. Unknown/empty input falls back to
  `{ mode: 'crypto', tab: DEFAULT_TAB, ticker: null }`.
- `buildHash` is the inverse; omits the ticker segment when `ticker` is null/empty
  and uppercases the ticker.
- Reuses `tabIdFromSlug` / `slugFromTabId` from `lib/tabs.ts`.

### Changed: `hooks/useTabUrlSync.ts` (thin)

- **Hash → store** (mount + `hashchange`): call `parseHash`, then dispatch the
  mode-appropriate setters — `setAssetMode`, `setActiveTab` / `setTradfiPage`,
  and `setUnderlying` / `setTradfiUnderlying` (only when the parsed ticker is
  present and differs from current state, to avoid clobbering with `null`).
- **Store → hash** (effect): build the desired hash from current state via
  `buildHash`; write it only if it differs from `window.location.hash`.
  Effect deps grow to `[activeTab, assetMode, underlying, tradfiUnderlying,
  tradfiPage]`.
- Preserve `window.location.search` when writing the URL (the hook already does:
  `${pathname}${search}${desired}`) — this keeps ArchitectView's independent
  `?query` state intact.

## History behavior (back button)

- **View change** (tab, asset-mode, or TradFi page) → `pushState`. Back navigates
  between views — today's behavior, unchanged.
- **Ticker-only change** within the same view → `replaceState`. A ticker is a
  filter, not a navigation step; flipping through many tickers should not bury
  the back button.
- **Initial mount** → `replaceState` (unchanged).
- Implemented by keeping a ref of the previous **view key**
  (`mode` + `tab` + `page`, ticker excluded). If the view key changed since the
  last write → `pushState`; otherwise → `replaceState`.

## Validation stance

Optimistic. The hash is applied at mount, **before** the async `/underlyings`
list (crypto) loads, so synchronous validation would race the data. The parsed
ticker is set as-is (uppercased); a typo/unknown ticker surfaces through the
existing empty-state. A "snap to nearest valid ticker once the list loads"
refinement is possible later but is out of scope (YAGNI).

## Back-compatibility

- Existing shared/bookmarked links (`#chain`, `#tradfi`, etc.) keep working.
- ArchitectView's separate `window.location.search` state is untouched.
- The crypto `gex` tab and the TradFi `gex` page do not collide — the `tradfi`
  prefix namespaces them.

## Testing

Unit tests on `lib/route-hash.ts` (pure functions — no jsdom, sidestepping the
known web-Vitest jsdom constraints):

- Round-trip `buildHash(parseHash(x))` for crypto and TradFi.
- Back-compat: `#chain` and `#tradfi` parse to sensible defaults.
- Uppercase normalization (`#chain/btc` → ticker `BTC`).
- Page-omitted resilience: `#tradfi/AAPL` → page `chain`, ticker `AAPL`.
- Unknown slug → `DEFAULT_TAB`, `ticker: null`.
- Empty ticker → segment omitted by `buildHash`.

## Files touched

- **New:** `packages/web/src/lib/route-hash.ts`
- **New:** `packages/web/src/lib/route-hash.test.ts`
- **Changed:** `packages/web/src/hooks/useTabUrlSync.ts`

No server, WS, protocol, or migration changes.
