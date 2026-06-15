# TradFi Web Chain Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a black/amber Bloomberg-style **TradFi mode** to `@oggregator/web` — a yellow TRADFI button flips the app into a cloned, single-venue chain page wired to the separate `@oggregator/tradfi` backend — and fix the `toFixed`-of-undefined crash on the chain page.

**Architecture:** A Zustand `assetMode: 'crypto' | 'tradfi'` toggled by a TRADFI button. In `tradfi` mode, `App.tsx` renders a thin `TradfiApp` shell wrapped in `[data-mode="tradfi"]` (a CSS-token override → black bg + amber), showing only a cloned `TradfiChainView` that REST-polls the TradFi backend (`/underlyings`, `/expiries`, `/chains`) and reuses `ChainTable`/`StatStrip`/`ExpiryBar`. The crypto app is untouched except an additive entry button + a mode branch.

**Tech Stack:** Vite 6 + React 19 + TS, Zustand v5, TanStack Query v5, CSS Modules + CSS-variable tokens, Vitest (jsdom).

**Conventions (match the repo — see `packages/web/CLAUDE.md`):**
- Path aliases live in **both** `tsconfig.json` and `vite.config.ts` — if you add one, update both. (This plan adds none.)
- CSS Modules per component; global classes only in `styles/`. Theming is via CSS variables in `styles/tokens.css`.
- TanStack Query = server state; Zustand = UI state. Never store API data in Zustand.
- `import.meta.env.VITE_*` only (never `process.env`). No `const enum`.
- Tests: vitest jsdom, `globals: false` (import `{ describe, it, expect, vi }` explicitly), **no jest-dom** (use plain matchers, not `toBeInTheDocument`), mock `useIsMobile` (no `matchMedia`), avoid array-index keys (biome `noArrayIndexKey`).
- Shared types: `src/shared-types/enriched.ts` mirrors core enrichment (`EnrichedChainResponse`, `EnrichedStrike`, `ChainStats`). Reuse it for TradFi (same shape).
- `docs/` is gitignored → commit this plan with `git add -f`.

---

## File Structure

```
NEW:
  src/lib/tradfi-http.ts                    tradfiFetchJson(path) against VITE_TRADFI_API_BASE
  src/features/tradfi/queries.ts            useTradfiUnderlyings / useTradfiExpiries / useTradfiChain
  src/features/tradfi/TradfiChainView.tsx   single-venue cloned chain container
  src/features/tradfi/TradfiApp.tsx         mode shell: [data-mode] wrapper + slim top bar
  src/features/tradfi/TradfiApp.module.css  shell + top bar styles
  src/features/tradfi/index.ts             exports TradfiApp
  src/styles/tradfi-theme.css               [data-mode="tradfi"] token overrides
TOUCH (additive):
  src/features/chain/StatStrip.tsx          guard dvol.ivr / ivChange1d (the toFixed fix)
  src/stores/app-store.ts                   + assetMode, tradfiUnderlying, tradfiExpiry (+ setters)
  src/styles/index.css                      @import "./tradfi-theme.css"
  src/env.d.ts                              + VITE_TRADFI_API_BASE
  vite.config.ts                            + /tradfi-api dev proxy
  src/components/layout/TopBar.tsx          + yellow TRADFI entry button
  src/App.tsx                               + assetMode branch
```

Run all commands from `packages/web` unless noted. Per-file test: `pnpm --filter @oggregator/web exec vitest run <path>`.

---
---

# MILESTONE A — Fix the `toFixed` crash (do first)

### Task 1: Guard `StatStrip` dvol fields

**Files:**
- Modify: `src/features/chain/StatStrip.tsx`
- Test: `src/features/chain/StatStrip.test.tsx`

- [ ] **Step 1: Write the failing test** (renders with a `dvol` object whose `ivr`/`ivChange1d` are `undefined` — currently throws "Cannot read properties of undefined (reading 'toFixed')")

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StatStrip from './StatStrip';
import type { ChainStats } from '@shared/enriched';

const STATS: ChainStats = {
  indexPriceUsd: 100, forwardPriceUsd: 101, atmIv: 0.5, atmStrike: 100,
  putCallOiRatio: 1.1, skew25d: 0.02, totalOiUsd: 1000, basisPct: 0.1,
} as ChainStats;

describe('StatStrip', () => {
  it('renders when dvol fields are undefined without crashing', () => {
    // dvol object present but ivr / ivChange1d missing — the real crash shape
    const marketStats = { underlying: 'BTC', spot: null, dvol: {} } as never;
    expect(() =>
      render(<StatStrip stats={STATS} underlying="BTC" dte={7} marketStats={marketStats} />),
    ).not.toThrow();
  });

  it('renders with no marketStats (TradFi case)', () => {
    expect(() =>
      render(<StatStrip stats={STATS} underlying="AAPL" dte={7} marketStats={null} />),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/chain/StatStrip.test.tsx`
Expected: FAIL — first test throws on `.toFixed` of undefined.

- [ ] **Step 3: Guard the dvol cells** in `StatStrip.tsx`. Replace the IVR `StatCell` value and the IV Δ1d block (lines ~141-158) with null-guarded versions:

```tsx
          <StatCell
            label="IVR"
            value={marketStats.dvol.ivr != null ? `${marketStats.dvol.ivr.toFixed(0)}` : '–'}
            sub={`52w: ${fmtIv(marketStats.dvol.low52w)}–${fmtIv(marketStats.dvol.high52w)}`}
            accent
          />
          <div className={styles.divider} />
          <StatCell
            label="IV Δ1d"
            value={
              marketStats.dvol.ivChange1d != null
                ? fmtPct(marketStats.dvol.ivChange1d * 100, 2)
                : '–'
            }
            positive={
              marketStats.dvol.ivChange1d == null
                ? null
                : marketStats.dvol.ivChange1d > 0
                  ? true
                  : marketStats.dvol.ivChange1d < 0
                    ? false
                    : null
            }
          />
```

(`fmtIv` already null-guards `low52w`/`high52w`; `RegimeChip` already receives `ivChange1d ?? null`.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/chain/StatStrip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual confirmation note.** With the crypto stack running (`pnpm dev`), open the chain page and confirm the crash is gone. If a *different* component still throws `toFixed`, capture the stack and guard that call the same way (use the null-guarding `fmt*` helpers from `@lib/format`). Record any additional fix here before committing.

- [ ] **Step 6: Commit**

```bash
git add src/features/chain/StatStrip.tsx src/features/chain/StatStrip.test.tsx
git commit -m "fix(web): guard StatStrip dvol.ivr/ivChange1d against undefined (toFixed crash)"
```

---
---

# MILESTONE B — TradFi data layer (web)

### Task 2: Env var + dev proxy

**Files:**
- Modify: `src/env.d.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add the env type** — `src/env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_TRADFI_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Add the dev proxy** — in `vite.config.ts`, add to `server.proxy`:

```ts
      '/tradfi-api': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tradfi-api/, ''),
      },
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/env.d.ts vite.config.ts
git commit -m "feat(web): VITE_TRADFI_API_BASE env + /tradfi-api dev proxy"
```

---

### Task 3: TradFi HTTP client

**Files:**
- Create: `src/lib/tradfi-http.ts`
- Test: `src/lib/tradfi-http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tradfiFetchJson } from './tradfi-http';

afterEach(() => vi.unstubAllGlobals());

describe('tradfiFetchJson', () => {
  it('fetches against the tradfi base and returns json', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await tradfiFetchJson<{ ok: number }>('/underlyings');
    expect(r.ok).toBe(1);
    expect((fetchMock.mock.calls[0]![0] as string)).toContain('/underlyings');
  });

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'err' })));
    await expect(tradfiFetchJson('/chains')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/lib/tradfi-http.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `tradfi-http.ts`** (mirrors `lib/http.ts`, minus the paper API key; default base is the dev proxy path)

```ts
const TRADFI_BASE = import.meta.env.VITE_TRADFI_API_BASE ?? '/tradfi-api';
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 8;

export async function tradfiFetchJson<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${TRADFI_BASE}${path}`);
      if (res.status === 503) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error('TradFi service still initializing');
      }
      if (!res.ok) throw new Error(`TradFi API error: ${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof TypeError) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/lib/tradfi-http.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tradfi-http.ts src/lib/tradfi-http.test.ts
git commit -m "feat(web): tradfi-http client"
```

---

### Task 4: TradFi query hooks

**Files:**
- Create: `src/features/tradfi/queries.ts`
- Test: `src/features/tradfi/queries.test.ts`

- [ ] **Step 1: Write the failing test** (assert the query functions hit the right tradfi paths)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tradfiKeys, fetchTradfiChain } from './queries';

afterEach(() => vi.unstubAllGlobals());

describe('tradfi queries', () => {
  it('builds stable query keys', () => {
    expect(tradfiKeys.chain('AAPL', '2026-06-17')).toEqual(['tradfi-chain', 'AAPL', '2026-06-17']);
  });

  it('fetchTradfiChain calls /chains with underlying+expiry', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ underlying: 'AAPL' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchTradfiChain('AAPL', '2026-06-17');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/chains?underlying=AAPL&expiry=2026-06-17');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/queries.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `queries.ts`** (mirrors `features/chain/queries.ts`; single-venue, REST poll)

```ts
import { useQuery } from '@tanstack/react-query';

import { tradfiFetchJson } from '@lib/tradfi-http';
import type { EnrichedChainResponse } from '@shared/enriched';

interface TradfiUnderlyingsResponse {
  underlyings: string[];
}
interface TradfiExpiriesResponse {
  underlying: string;
  expiries: string[];
}

export const tradfiKeys = {
  underlyings: () => ['tradfi-underlyings'] as const,
  expiries: (underlying: string) => ['tradfi-expiries', underlying] as const,
  chain: (underlying: string, expiry: string) => ['tradfi-chain', underlying, expiry] as const,
};

export function fetchTradfiChain(underlying: string, expiry: string) {
  return tradfiFetchJson<EnrichedChainResponse>(
    `/chains?underlying=${underlying}&expiry=${expiry}`,
  );
}

export function useTradfiUnderlyings() {
  return useQuery({
    queryKey: tradfiKeys.underlyings(),
    queryFn: () => tradfiFetchJson<TradfiUnderlyingsResponse>('/underlyings'),
    staleTime: 60_000,
  });
}

export function useTradfiExpiries(underlying: string) {
  return useQuery({
    queryKey: tradfiKeys.expiries(underlying),
    queryFn: () => tradfiFetchJson<TradfiExpiriesResponse>(`/expiries?underlying=${underlying}`),
    enabled: Boolean(underlying),
    staleTime: 30_000,
    placeholderData: (prev: TradfiExpiriesResponse | undefined) => prev,
  });
}

export function useTradfiChain(underlying: string, expiry: string) {
  return useQuery({
    queryKey: tradfiKeys.chain(underlying, expiry),
    queryFn: () => fetchTradfiChain(underlying, expiry),
    enabled: Boolean(underlying && expiry),
    placeholderData: (prev: EnrichedChainResponse | undefined) => prev,
    refetchInterval: 5000, // delayed data — light polling is enough
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tradfi/queries.ts src/features/tradfi/queries.test.ts
git commit -m "feat(web): tradfi query hooks (underlyings/expiries/chain, REST poll)"
```

---
---

# MILESTONE C — Mode state, theme, view, shell, entry

### Task 5: `assetMode` + tradfi underlying/expiry in the store

**Files:**
- Modify: `src/stores/app-store.ts`
- Test: `src/stores/app-store.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
it('toggles assetMode and tracks tradfi underlying/expiry', () => {
  const s = useAppStore.getState();
  expect(s.assetMode).toBe('crypto');
  s.setAssetMode('tradfi');
  expect(useAppStore.getState().assetMode).toBe('tradfi');
  useAppStore.getState().setTradfiUnderlying('AAPL');
  expect(useAppStore.getState().tradfiUnderlying).toBe('AAPL');
  expect(useAppStore.getState().tradfiExpiry).toBe(''); // reset on underlying change
  useAppStore.getState().setTradfiExpiry('2026-06-17');
  expect(useAppStore.getState().tradfiExpiry).toBe('2026-06-17');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/stores/app-store.test.ts`
Expected: FAIL (`assetMode` undefined).

- [ ] **Step 3: Add to the `AppState` interface** (after `activeTab: TabId;`):

```ts
  assetMode: 'crypto' | 'tradfi';
  tradfiUnderlying: string;
  tradfiExpiry: string;
```

and in the actions block of the interface:

```ts
  setAssetMode: (m: 'crypto' | 'tradfi') => void;
  setTradfiUnderlying: (u: string) => void;
  setTradfiExpiry: (e: string) => void;
```

Add to the store object initial state (after `activeTab: 'chain',`):

```ts
  assetMode: 'crypto',
  tradfiUnderlying: '',
  tradfiExpiry: '',
```

and the implementations (after `setActiveTab`):

```ts
  setAssetMode: (assetMode) => set({ assetMode }),
  setTradfiUnderlying: (tradfiUnderlying) => set({ tradfiUnderlying, tradfiExpiry: '' }),
  setTradfiExpiry: (tradfiExpiry) => set({ tradfiExpiry }),
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/stores/app-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/app-store.ts src/stores/app-store.test.ts
git commit -m "feat(web): assetMode + tradfi underlying/expiry store slices"
```

---

### Task 6: TradFi theme (token override)

**Files:**
- Create: `src/styles/tradfi-theme.css`
- Modify: `src/styles/index.css`

- [ ] **Step 1: Create `src/styles/tradfi-theme.css`**

```css
/* Bloomberg-style black + amber. Scoped to the TradFi mode wrapper so the
   crypto theme is untouched. Reuses all existing component tokens. */
[data-mode="tradfi"] {
  --bg-base: #000000;
  --bg-surface: #0a0905;
  --bg-elevated: #14110a;
  --bg-hover: #1c1810;
  --bg-active: #261f10;
  --bg-input: #100d07;
  --bg-panel: #0a0905;

  --text-primary: #ffd24a;
  --text-secondary: #d8b24a;
  --text-tertiary: #9c8030;
  --text-dim: #6a5720;

  --border-subtle: #2a2410;
  --border-default: #3a3214;
  --border-strong: #4d421c;
  --border-focus: #ffb300;

  --accent-primary: #ffb300;
  --accent-primary-bg: #2a1f00;
  --accent-primary-dim: rgba(255, 179, 0, 0.14);

  --color-warning: #ffcc00;
  /* profit/loss stay green/red for readability */
}
```

- [ ] **Step 2: Import it** — `src/styles/index.css`:

```css
@import "./tokens.css";
@import "./reset.css";
@import "./tradfi-theme.css";
```

- [ ] **Step 3: Verify the web still builds**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: exit 0 (CSS import doesn't affect tsc, but confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add src/styles/tradfi-theme.css src/styles/index.css
git commit -m "feat(web): TradFi black/amber theme (data-mode override)"
```

---

### Task 7: `TradfiChainView` (single-venue cloned container)

**Files:**
- Create: `src/features/tradfi/TradfiChainView.tsx`
- Test: `src/features/tradfi/TradfiChainView.test.tsx`

- [ ] **Step 1: Write the failing test** (renders a TradFi-shaped, null-heavy chain without crashing — also the clone's `toFixed` regression guard). Mock `useIsMobile` (no `matchMedia`) and the chain query.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./queries', () => ({
  useTradfiUnderlyings: () => ({ data: { underlyings: ['AAPL'] } }),
  useTradfiExpiries: () => ({ data: { underlying: 'AAPL', expiries: ['2026-06-17'] } }),
  useTradfiChain: () => ({
    data: {
      underlying: 'AAPL', expiry: '2026-06-17', expiryTs: null, dte: 2,
      stats: { indexPriceUsd: 295, forwardPriceUsd: 295, atmIv: 0.27, atmStrike: 295,
        putCallOiRatio: null, skew25d: null, totalOiUsd: 0, basisPct: null },
      strikes: [{
        strike: 295,
        call: { venues: { tastytrade: { bid: 5, ask: 5.4, mid: 5.2, bidSize: 1, askSize: 2,
          markIv: 0.27, bidIv: null, askIv: null, delta: 0.5, gamma: null, theta: null, vega: null,
          spreadPct: null, totalCost: null, estimatedFees: null, openInterest: 0,
          volume24h: null, openInterestUsd: null, volume24hUsd: null } }, bestIv: 0.27, bestVenue: 'tastytrade' },
        put: { venues: { tastytrade: { bid: null, ask: null, mid: null, bidSize: null, askSize: null,
          markIv: null, bidIv: null, askIv: null, delta: null, gamma: null, theta: null, vega: null,
          spreadPct: null, totalCost: null, estimatedFees: null, openInterest: 0,
          volume24h: null, openInterestUsd: null, volume24hUsd: null } }, bestIv: null, bestVenue: null },
      }],
      gex: [],
    },
    isLoading: false, error: null,
  }),
}));

import TradfiChainView from './TradfiChainView';

it('renders a null-heavy tradfi chain without crashing', () => {
  const qc = new QueryClient();
  expect(() =>
    render(
      <QueryClientProvider client={qc}>
        <TradfiChainView />
      </QueryClientProvider>,
    ),
  ).not.toThrow();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/TradfiChainView.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `TradfiChainView.tsx`** (clone of `ChainView`, single-venue: no `VenueSidebar`/`activeVenues`/`useChainWs`/`useStats`; `marketStats={null}` so `StatStrip`'s dvol block self-skips; venue fixed to `tastytrade`). Reuses `ExpiryBar`, `StatStrip`, `ChainTable` from `@features/chain` — export them from chain's `index.ts` if not already (Step 3a).

```tsx
import { useEffect } from 'react';

import { useAppStore } from '@stores/app-store';
import { Spinner, EmptyState } from '@components/ui';
import { ExpiryBar, StatStrip, ChainTable } from '@features/chain';
import { useTradfiUnderlyings, useTradfiExpiries, useTradfiChain } from './queries';

const TRADFI_VENUES = ['tastytrade'];

export default function TradfiChainView() {
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const expiry = useAppStore((s) => s.tradfiExpiry);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const setExpiry = useAppStore((s) => s.setTradfiExpiry);

  const { data: underlyingsData } = useTradfiUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data: expiriesData } = useTradfiExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { data: chain, isLoading, error } = useTradfiChain(underlying, expiry);

  // Default underlying → first available.
  useEffect(() => {
    if (underlyings.length > 0 && !underlyings.includes(underlying)) {
      setUnderlying(underlyings[0]!);
    }
  }, [underlyings, underlying, setUnderlying]);

  // Default expiry → first available.
  useEffect(() => {
    if (expiries.length > 0 && !expiry) setExpiry(expiries[0]!);
  }, [expiries, expiry, setExpiry]);

  return (
    <div>
      <ExpiryBar
        underlying={underlying || '—'}
        spotPrice={chain?.stats.indexPriceUsd ?? undefined}
        expiries={expiries}
        selected={expiry}
        onSelect={setExpiry}
        onChangeAsset={() => {
          const i = underlyings.indexOf(underlying);
          const next = underlyings[(i + 1) % Math.max(underlyings.length, 1)];
          if (next) setUnderlying(next);
        }}
      />

      {chain && (
        <StatStrip
          stats={chain.stats}
          underlying={chain.underlying}
          dte={chain.dte}
          marketStats={null}
        />
      )}

      <div>
        {isLoading && !chain && <Spinner size="lg" label="Loading TradFi chain…" />}
        {error && !chain && (
          <EmptyState
            icon="⚠"
            title="Failed to load TradFi chain"
            detail={error instanceof Error ? error.message : 'Is the TradFi service running on :3200?'}
          />
        )}
        {chain && chain.strikes.length === 0 && (
          <EmptyState icon="∅" title="No options data" detail={`No data for ${underlying} ${expiry}.`} />
        )}
        {chain && chain.strikes.length > 0 && (
          <ChainTable
            strikes={chain.strikes}
            atmStrike={chain.stats.atmStrike}
            indexPrice={chain.stats.indexPriceUsd}
            activeVenues={TRADFI_VENUES}
            myIv={null}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3a: Ensure chain components are exported** — check `src/features/chain/index.ts`; if `ExpiryBar`, `StatStrip`, or `ChainTable` aren't exported, add:

```ts
export { default as ExpiryBar } from './ExpiryBar';
export { default as StatStrip } from './StatStrip';
export { default as ChainTable } from './ChainTable';
```

(Do not import chain internals directly from `@features/tradfi` — only via `@features/chain` per the repo's no-cross-feature-internals rule.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/TradfiChainView.test.tsx`
Expected: PASS — renders without throwing (confirms null-heavy TradFi data is safe).

- [ ] **Step 5: Commit**

```bash
git add src/features/tradfi/TradfiChainView.tsx src/features/tradfi/TradfiChainView.test.tsx src/features/chain/index.ts
git commit -m "feat(web): TradfiChainView single-venue cloned chain"
```

---

### Task 8: `TradfiApp` shell

**Files:**
- Create: `src/features/tradfi/TradfiApp.tsx`
- Create: `src/features/tradfi/TradfiApp.module.css`
- Create: `src/features/tradfi/index.ts`

- [ ] **Step 1: Implement `TradfiApp.tsx`** (slim top bar: amber TRADFI brand + underlying `<select>` + "← oggregator" back button; wraps everything in `[data-mode="tradfi"]`)

```tsx
import { useAppStore } from '@stores/app-store';
import { useTradfiUnderlyings } from './queries';
import TradfiChainView from './TradfiChainView';
import styles from './TradfiApp.module.css';

export default function TradfiApp() {
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const { data } = useTradfiUnderlyings();
  const underlyings = data?.underlyings ?? [];

  return (
    <div className={styles.root} data-mode="tradfi">
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => setAssetMode('crypto')}>
          ← oggregator
        </button>
        <span className={styles.brand}>TRADFI</span>
        <select
          className={styles.select}
          value={underlying}
          onChange={(e) => setUnderlying(e.target.value)}
        >
          {underlyings.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <span className={styles.delayed}>15-min delayed</span>
      </header>
      <main className={styles.main}>
        <TradfiChainView />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Implement `TradfiApp.module.css`** (uses theme tokens, so it's auto-themed)

```css
.root {
  min-height: 100vh;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-mono);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 48px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-surface);
}
.back {
  background: none;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.brand {
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent-primary);
}
.select {
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-family: var(--font-mono);
}
.delayed {
  margin-left: auto;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}
.main {
  padding: var(--space-3);
}
```

- [ ] **Step 2a: Create `index.ts`**

```ts
export { default as TradfiApp } from './TradfiApp';
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/tradfi/TradfiApp.tsx src/features/tradfi/TradfiApp.module.css src/features/tradfi/index.ts
git commit -m "feat(web): TradfiApp shell (slim bloomberg top bar)"
```

---

### Task 9: TRADFI entry button + App mode branch

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/TopBar.module.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the yellow TRADFI button** to `TopBar.tsx`. Pull `setAssetMode` from the store and add a button in the right group (before `⌘K`):

```tsx
  const setAssetMode = useAppStore((s) => s.setAssetMode);
```

In the `.right` div, before the `cmdk` button:

```tsx
        <button className={styles.tradfi} onClick={() => setAssetMode('tradfi')} title="TradFi (TastyTrade)">
          TRADFI
        </button>
```

- [ ] **Step 2: Style it amber** — append to `TopBar.module.css`:

```css
.tradfi {
  background: #ffb300;
  color: #000;
  font-weight: 700;
  letter-spacing: 0.08em;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.tradfi:hover { background: #ffc333; }
```

- [ ] **Step 3: Branch on `assetMode`** in `App.tsx`. Add the import and a short-circuit at the top of the returned tree:

```tsx
import { TradfiApp } from '@features/tradfi';
```

Inside `App()`, after the existing hooks, before the crypto `return`:

```tsx
  const assetMode = useAppStore((s) => s.assetMode);
  if (assetMode === 'tradfi') return <TradfiApp />;
```

- [ ] **Step 4: Verify typecheck + full web test run**

Run: `pnpm --filter @oggregator/web typecheck && pnpm --filter @oggregator/web test:run`
Expected: exit 0; all web tests pass (including the new tradfi + StatStrip tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/TopBar.tsx src/components/layout/TopBar.module.css src/App.tsx
git commit -m "feat(web): TRADFI entry button + assetMode branch"
```

---
---

# MILESTONE D — Finalize

### Task 10: Full green + visual smoke

**Files:** none (verification).

- [ ] **Step 1: Whole repo green**

Run (from repo root): `pnpm typecheck && pnpm test`
Expected: exit 0 across all packages.

- [ ] **Step 2: Visual smoke** (manual). Start both: the TradFi backend (`pnpm --filter @oggregator/tradfi dev`, needs the `.env` creds) and the web (`pnpm --filter @oggregator/web dev`). In the browser: click **TRADFI** → confirm the app flips to **black/amber**, shows the underlying selector + expiry bar + chain table with TradFi (delayed) quotes/greeks, and **← oggregator** returns to the normal crypto theme. Confirm no `toFixed` console errors on either the crypto chain page or the TradFi page.

- [ ] **Step 3: Commit any smoke-driven tweaks** (if needed), otherwise done.

---

## Out of scope (later)
Other TradFi tabs (surface/gex/flow/builder); TradFi `/ws/chain` streaming (REST poll for now); persisting `assetMode` across reloads; a real TastyTrade venue logo (uses the `TAS` text fallback for now); domain/subdomain prod routing + the real-time market-data agreement (ops).

## Self-review notes (verify during execution)
- **`ExpiryBar` props:** the clone passes `underlying`, `spotPrice`, `expiries`, `selected`, `onSelect`, `onChangeAsset` (omitting `spotChange` — optional). If `ExpiryBar` requires `spotChange`, pass `undefined` explicitly.
- **`ChainTable` single-venue chrome:** with `activeVenues={['tastytrade']}` and no `VENUES['tastytrade']` entry, the venue chip renders the built-in fallback (`TAS` via `venueColor`). That's acceptable for v1 (amber theme covers it). Do NOT add `tastytrade` to the shared `VENUES`/`VENUE_IDS` map — it would pollute the crypto default `activeVenues`.
- **`StatStrip` for TradFi:** `marketStats={null}` skips the dvol block entirely; `connectionState` omitted (no Feed cell). Confirmed safe after Task 1.
- **RTL availability:** the web suite already renders components (e.g. existing tests), so `@testing-library/react` is present; if a render import fails, follow the pattern in a sibling `*.test.tsx`.
