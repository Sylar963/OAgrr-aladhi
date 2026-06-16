# Shareable Ticker Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the selected ticker (and sub-view) in the URL hash so a shared link to the app restores that ticker, for both TradFi and crypto.

**Architecture:** A new pure, DOM-free module `lib/route-hash.ts` owns the hash grammar (`parseHash` / `buildHash`). The existing `hooks/useTabUrlSync.ts` becomes a thin adapter: it parses the hash into the Zustand store on mount/`hashchange`, and writes the store back to the hash on change (push for a view change, replace for a ticker-only change). No server, WS, protocol, or preview/OG work.

**Tech Stack:** React 19, Zustand v5, Vite 6, Vitest v4, TypeScript (strict). Reference spec: `docs/superpowers/specs/2026-06-16-shareable-ticker-routes-design.md`.

---

## File Structure

- **Create** `packages/web/src/lib/route-hash.ts` — pure hash grammar: `RouteState` type, `parseHash`, `buildHash`. No DOM, no store access. Single responsibility: string ⇄ route state.
- **Create** `packages/web/src/lib/route-hash.test.ts` — unit tests for the two pure functions.
- **Modify** `packages/web/src/hooks/useTabUrlSync.ts` — replace inline slug logic with `parseHash`/`buildHash`; add ticker + TradFi page to both sync directions; add push-vs-replace logic.
- **Modify** `packages/web/CLAUDE.md` — one bullet documenting the hash grammar.

Reference (read-only, do not change):
- `packages/web/src/lib/tabs.ts` — `TabId`, `DEFAULT_TAB`, `tabIdFromSlug`, `slugFromTabId`.
- `packages/web/src/stores/app-store.ts` — `TradfiPage` type; setters `setUnderlying`, `setActiveTab`, `setAssetMode`, `setTradfiUnderlying`, `setTradfiPage`. Note `setUnderlying`/`setTradfiUnderlying` clear expiry as a side effect — this is why the hook only calls them when the parsed ticker actually differs.

---

## Task 1: Pure hash grammar (`lib/route-hash.ts`)

**Files:**
- Create: `packages/web/src/lib/route-hash.ts`
- Test: `packages/web/src/lib/route-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/route-hash.test.ts`:

```ts
import { DEFAULT_TAB } from '@lib/tabs';
import { describe, expect, it } from 'vitest';
import { buildHash, parseHash, type RouteState } from './route-hash';

describe('parseHash', () => {
  it('parses a crypto tab + ticker', () => {
    expect(parseHash('#chain/BTC')).toEqual({ mode: 'crypto', tab: 'chain', ticker: 'BTC' });
    expect(parseHash('#volatility/ETH')).toEqual({
      mode: 'crypto',
      tab: 'surface',
      ticker: 'ETH',
    });
  });

  it('uppercases the ticker', () => {
    expect(parseHash('#chain/btc')).toEqual({ mode: 'crypto', tab: 'chain', ticker: 'BTC' });
  });

  it('back-compat: crypto tab with no ticker', () => {
    expect(parseHash('#chain')).toEqual({ mode: 'crypto', tab: 'chain', ticker: null });
  });

  it('unknown crypto slug falls back to the default tab with no ticker', () => {
    expect(parseHash('#nope')).toEqual({ mode: 'crypto', tab: DEFAULT_TAB, ticker: null });
  });

  it('parses a tradfi page + ticker', () => {
    expect(parseHash('#tradfi/gex/AAPL')).toEqual({ mode: 'tradfi', page: 'gex', ticker: 'AAPL' });
    expect(parseHash('#tradfi/chain/TSLA')).toEqual({
      mode: 'tradfi',
      page: 'chain',
      ticker: 'TSLA',
    });
  });

  it('back-compat: bare #tradfi → chain page, no ticker', () => {
    expect(parseHash('#tradfi')).toEqual({ mode: 'tradfi', page: 'chain', ticker: null });
  });

  it('tradfi with the page omitted treats the segment as a ticker', () => {
    expect(parseHash('#tradfi/AAPL')).toEqual({ mode: 'tradfi', page: 'chain', ticker: 'AAPL' });
  });

  it('tolerates a missing leading # and empty input', () => {
    expect(parseHash('chain/BTC')).toEqual({ mode: 'crypto', tab: 'chain', ticker: 'BTC' });
    expect(parseHash('')).toEqual({ mode: 'crypto', tab: DEFAULT_TAB, ticker: null });
    expect(parseHash('#')).toEqual({ mode: 'crypto', tab: DEFAULT_TAB, ticker: null });
  });
});

describe('buildHash', () => {
  it('builds crypto hashes with the tab slug + uppercased ticker', () => {
    expect(buildHash({ mode: 'crypto', tab: 'chain', ticker: 'BTC' })).toBe('#chain/BTC');
    expect(buildHash({ mode: 'crypto', tab: 'surface', ticker: 'eth' })).toBe('#volatility/ETH');
  });

  it('omits the ticker segment when ticker is null/empty', () => {
    expect(buildHash({ mode: 'crypto', tab: 'chain', ticker: null })).toBe('#chain');
    expect(buildHash({ mode: 'tradfi', page: 'chain', ticker: null })).toBe('#tradfi/chain');
  });

  it('builds tradfi hashes with page + ticker', () => {
    expect(buildHash({ mode: 'tradfi', page: 'gex', ticker: 'AAPL' })).toBe('#tradfi/gex/AAPL');
  });
});

describe('round-trip', () => {
  it('buildHash → parseHash is stable', () => {
    const states: RouteState[] = [
      { mode: 'crypto', tab: 'chain', ticker: 'BTC' },
      { mode: 'crypto', tab: 'surface', ticker: 'ETH' },
      { mode: 'crypto', tab: 'gex', ticker: null },
      { mode: 'tradfi', page: 'chain', ticker: 'AAPL' },
      { mode: 'tradfi', page: 'gex', ticker: null },
    ];
    for (const state of states) {
      expect(parseHash(buildHash(state))).toEqual(state);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run route-hash`
Expected: FAIL — `Failed to resolve import "./route-hash"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/web/src/lib/route-hash.ts`:

```ts
import { DEFAULT_TAB, slugFromTabId, tabIdFromSlug, type TabId } from '@lib/tabs';
import type { TradfiPage } from '@stores/app-store';

const TRADFI_PREFIX = 'tradfi';
const TRADFI_PAGES: readonly TradfiPage[] = ['chain', 'gex'];

// Hash route state, discriminated by asset mode. `ticker` is null when no
// ticker is encoded (e.g. a legacy `#chain` link or TradFi before selection).
export type RouteState =
  | { mode: 'crypto'; tab: TabId; ticker: string | null }
  | { mode: 'tradfi'; page: TradfiPage; ticker: string | null };

function isTradfiPage(value: string): value is TradfiPage {
  return (TRADFI_PAGES as readonly string[]).includes(value);
}

function normalizeTicker(raw: string | undefined): string | null {
  if (!raw) return null;
  const ticker = raw.trim().toUpperCase();
  return ticker.length > 0 ? ticker : null;
}

// Parse a `location.hash` value into route state. Tolerant of a missing
// leading `#`, empty input, unknown slugs, and an omitted TradFi page.
export function parseHash(rawHash: string): RouteState {
  const segments = rawHash
    .replace(/^#/, '')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (segments[0] === TRADFI_PREFIX) {
    const maybePage = segments[1];
    if (maybePage && isTradfiPage(maybePage)) {
      return { mode: 'tradfi', page: maybePage, ticker: normalizeTicker(segments[2]) };
    }
    // Page omitted: treat segment[1] (if present) as the ticker, default to chain.
    return { mode: 'tradfi', page: 'chain', ticker: normalizeTicker(maybePage) };
  }

  const tab = tabIdFromSlug(segments[0] ?? '') ?? DEFAULT_TAB;
  return { mode: 'crypto', tab, ticker: normalizeTicker(segments[1]) };
}

// Build the canonical `location.hash` (including the leading `#`) for a state.
export function buildHash(state: RouteState): string {
  const ticker = normalizeTicker(state.ticker ?? undefined);
  const base =
    state.mode === 'tradfi' ? `${TRADFI_PREFIX}/${state.page}` : slugFromTabId(state.tab);
  return `#${ticker ? `${base}/${ticker}` : base}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run route-hash`
Expected: PASS — all `parseHash`, `buildHash`, and round-trip cases green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/route-hash.ts packages/web/src/lib/route-hash.test.ts
git commit -m "feat(web): pure hash grammar for shareable ticker routes"
```

---

## Task 2: Wire ticker + page into `useTabUrlSync`

**Files:**
- Modify: `packages/web/src/hooks/useTabUrlSync.ts` (full rewrite of the file — shown below)

- [ ] **Step 1: Replace the hook implementation**

Replace the entire contents of `packages/web/src/hooks/useTabUrlSync.ts` with:

```ts
import { buildHash, parseHash, type RouteState } from '@lib/route-hash';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef } from 'react';

// The "view key" is everything in the hash EXCEPT the ticker. It decides
// push vs replace: a view change (tab / asset-mode / TradFi page) pushes a
// history entry; a ticker-only change replaces, so cycling tickers doesn't
// bury the back button.
function viewKey(state: RouteState): string {
  return state.mode === 'tradfi' ? `tradfi/${state.page}` : `crypto/${state.tab}`;
}

// Bidirectional sync between `location.hash` and the store's view state
// (tab / asset-mode / TradFi page) plus the selected ticker.
//   Hash → store on mount and on `hashchange` (back/forward, manual edits).
//   Store → hash on change. The first mount adopts an incoming hash as-is and
//   only seeds a canonical hash when none is present, so a shared deep link is
//   never overwritten or flickered.
export function useTabUrlSync(): void {
  const activeTab = useAppStore((s) => s.activeTab);
  const assetMode = useAppStore((s) => s.assetMode);
  const underlying = useAppStore((s) => s.underlying);
  const tradfiUnderlying = useAppStore((s) => s.tradfiUnderlying);
  const tradfiPage = useAppStore((s) => s.tradfiPage);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  const setTradfiUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const setTradfiPage = useAppStore((s) => s.setTradfiPage);
  const initialMount = useRef(true);
  const lastViewKey = useRef<string | null>(null);

  // Hash → store.
  useEffect(() => {
    const apply = () => {
      const route = parseHash(window.location.hash);
      const s = useAppStore.getState();
      if (route.mode === 'tradfi') {
        if (s.assetMode !== 'tradfi') setAssetMode('tradfi');
        if (route.page !== s.tradfiPage) setTradfiPage(route.page);
        // Only set when present and changed — the setter clears expiry.
        if (route.ticker && route.ticker !== s.tradfiUnderlying) {
          setTradfiUnderlying(route.ticker);
        }
        return;
      }
      if (s.assetMode !== 'crypto') setAssetMode('crypto');
      if (route.tab !== s.activeTab) setActiveTab(route.tab);
      if (route.ticker && route.ticker !== s.underlying) {
        setUnderlying(route.ticker);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [setActiveTab, setAssetMode, setUnderlying, setTradfiUnderlying, setTradfiPage]);

  // Store → hash.
  useEffect(() => {
    const route: RouteState =
      assetMode === 'tradfi'
        ? { mode: 'tradfi', page: tradfiPage, ticker: tradfiUnderlying || null }
        : { mode: 'crypto', tab: activeTab, ticker: underlying || null };
    const desired = buildHash(route);
    const key = viewKey(route);

    if (initialMount.current) {
      initialMount.current = false;
      lastViewKey.current = key;
      // Adopt an incoming hash as-is (Hash → store already applied it).
      if (window.location.hash && window.location.hash !== '#') return;
      // No hash on first load — seed the canonical URL without a history entry.
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${desired}`,
      );
      return;
    }

    if (window.location.hash === desired) {
      lastViewKey.current = key;
      return;
    }

    const url = `${window.location.pathname}${window.location.search}${desired}`;
    if (lastViewKey.current === key) {
      // Ticker-only change within the same view — replace, don't grow history.
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    lastViewKey.current = key;
  }, [activeTab, assetMode, underlying, tradfiUnderlying, tradfiPage]);
}
```

- [ ] **Step 2: Confirm the route-hash tests still pass and typecheck**

Run: `pnpm --filter @oggregator/web test:run route-hash`
Expected: PASS (unchanged).

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

- [ ] **Step 3: Lint the changed files**

Run: `pnpm --filter @oggregator/web lint`
Expected: no errors for `route-hash.ts`, `route-hash.test.ts`, `useTabUrlSync.ts`. (Import order is `@lib/*`, `@stores/*`, then `react` — alphabetical by source — matching Biome's organize-imports order used elsewhere in the repo.)

- [ ] **Step 4: Manual browser verification**

The hook's behavior depends on DOM history + `hashchange`, so verify it live. Start the dev server: `pnpm --filter @oggregator/web dev` (opens on `:5173`). Walk this checklist:

1. **Fresh load, no hash** — open `http://localhost:5173/` → URL becomes `#chain/BTC` (canonical), no extra history entry (Back leaves the app).
2. **Crypto deep link** — open `http://localhost:5173/#volatility/ETH` directly → lands on the Volatility tab with ETH selected. No flicker to a different ticker/tab on load.
3. **TradFi deep link** — open `http://localhost:5173/#tradfi/gex/AAPL` → TradFi GEX page with AAPL. Then `http://localhost:5173/#tradfi/chain/TSLA` → TradFi Chain with TSLA.
4. **Ticker change = replace** — on `#chain/BTC`, switch underlying to ETH → URL becomes `#chain/ETH`; pressing Back does NOT step through BTC (it leaves the view).
5. **View change = push** — from `#chain/ETH` switch to the Volatility tab → `#volatility/ETH`; press Back → returns to `#chain/ETH` (ticker preserved).
6. **Back/forward into TradFi** — from a crypto view, switch to TradFi and pick a ticker, then Back → returns to the crypto view; Forward → returns to the TradFi ticker.
7. **Legacy links** — `#chain` and `#tradfi` (no ticker) still load (default ticker / chain page), confirming back-compat.

Expected: every item behaves as described. If any fails, fix the hook (do not weaken the `route-hash` tests) and re-run this checklist.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useTabUrlSync.ts
git commit -m "feat(web): deep-link the selected ticker via the URL hash"
```

---

## Task 3: Document + full-suite gate

**Files:**
- Modify: `packages/web/CLAUDE.md`

- [ ] **Step 1: Add a hash-grammar note to web CLAUDE.md**

In `packages/web/CLAUDE.md`, under the "Non-obvious decisions" list, add this bullet (keep the existing bullets unchanged):

```markdown
- **URL hash carries view + ticker**: `lib/route-hash.ts` is the source of truth for the hash grammar — `#<tab>/<TICKER>` (crypto) and `#tradfi/<page>/<TICKER>` (TradFi). `hooks/useTabUrlSync.ts` is the only reader/writer of `location.hash`; it parses the hash into the store on load and writes it back on change (push on a view change, replace on a ticker-only change). Ticker is uppercased; expiry is intentionally not encoded.
```

- [ ] **Step 2: Run the full web test suite**

Run: `pnpm --filter @oggregator/web test:run`
Expected: PASS — all suites green, including the pre-existing `app-store` and TradFi tests (confirms no regression in the routing-adjacent state).

- [ ] **Step 3: Full typecheck + lint**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

Run: `pnpm --filter @oggregator/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/CLAUDE.md
git commit -m "docs(web): note the URL hash grammar in CLAUDE.md"
```

---

## Out of scope (do not implement here)

- Open Graph / Twitter preview cards (static or per-ticker) — deferred by decision; would need a Vercel edge/serverless function because hash fragments are invisible to crawlers.
- Encoding the expiry or the venue filter in the URL.
- Any change to the server, WS transport, protocol package, or DB.

## Self-review notes (author)

- **Spec coverage:** URL grammar (Task 1 `parseHash`/`buildHash` + tests), module split (Task 1 file + Task 2 hook), history push/replace (Task 2 Step 1 + manual checklist), optimistic validation (Task 2 — ticker set as-is, no list lookup), back-compat (Task 1 tests for `#chain`/`#tradfi`; Task 2 manual item 7), testing (Task 1 unit tests; hook via manual checklist per spec scope). All covered.
- **Type consistency:** `RouteState`, `parseHash`, `buildHash`, `viewKey`, `TradfiPage`, `TabId`, and the store setter names are used identically across Tasks 1–2.
- **No placeholders:** every code and command step is complete.
