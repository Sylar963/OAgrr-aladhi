# TradFi Per-Strike Chart + Greeks PnL Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-strike **"Chart"** button work on the TradFi chain so it opens the option's **price chart + greeks PnL attribution** (popout on desktop, modal on mobile), and remove the bolted-on global "Price" tab.

**Architecture:** TradFi is a **separate venue/service** (`@oggregator/tradfi`, its own systemd unit) and `'tastytrade'` is **not** a `VenueId`, so we must NOT route it through the crypto chart pipeline (which is `VenueId`-typed and hits crypto endpoints). Instead we build an **isolated TradFi chart flow** that reuses only the *presentational leaves* (`InstrumentChart`, `InstrumentAttributionChart`, `AttributionSummary`) and the *pure math* (`attributePnL` from `pnl-attribution.ts`), fed by TradFi data sources. The shared `ChainTable`/`ExpandedRow` gain ONE optional generic `chartOverride` callback so they never import tradfi code (feature isolation preserved); when present, the per-strike "Chart" button is enabled and calls it.

**Tech Stack:** Backend: Fastify + DXLink `CandleClient` (`@oggregator/tradfi`). Frontend: React 19 + Vite + TanStack Query v5 + Zod v4 + lightweight-charts (`@oggregator/web`). Tests: Vitest.

---

## Root Cause (for context)

- TradFi reuses the shared `ChainTable` → `ExpandedRow`, which renders a per-strike **"Chart"** button (`ExpandedRow.tsx:414-443`). For TradFi it is **permanently disabled** because `'tastytrade'` is not in `CHART_SUPPORTED_VENUES` (`instrument-symbol.ts:5-15`) and `pickPrimaryVenue` returns `null`.
- The crypto popout/panel (`ChartPanelView` → `useInstrumentCandles`/`useInstrumentAttribution`) is `VenueId`-typed and queries `/instrument-candles` + `/spot-candles` + the `['chain',…]` cache. It cannot serve TradFi.
- A global **"Price" tab** was bolted on (`TradfiChainView.tsx:63-118` + `TradfiPriceChart.tsx`) as a workaround. We replace it with the per-strike Chart flow.
- `attributePnL` (`pnl-attribution.ts:178`) is **pure, underlying-agnostic** math: it needs `{ts, mark, forward}` bars + `strike` + `right` + `expirationMs`. The "BTC/ETH only" gate is purely data-availability. TradFi option marks already exist (`/candles` closes); the forward series needs a new TradFi underlying-candles endpoint.

---

## File Structure

**Backend (`packages/tradfi/`):**
- Modify `src/runtime/candles.ts` — factor a `mapRawCandles` helper; add `buildUnderlyingCandlesResponse(...)`.
- Create `src/routes/underlying-candles.ts` — `GET /underlying-candles?underlying&interval&range`.
- Modify `src/app.ts` — register the new route.
- Modify `src/runtime/candles.test.ts` — tests for `buildUnderlyingCandlesResponse`.

**Frontend (`packages/web/src/`):**
- Create `features/tradfi/use-tradfi-underlying-candles.ts` — fetch the forward-proxy series.
- Create `features/tradfi/use-tradfi-attribution.ts` — align option closes ↔ underlying closes, run `attributePnL`.
- Create `features/tradfi/TradfiChartPanel.tsx` (+ `.module.css`) — Price/Attribution panel (single venue, USD); reused by popout page AND mobile modal.
- Create `features/tradfi/tradfi-chart-popout.ts` — `openTradfiChartPopout` + `parseTradfiPopoutParams`.
- Create `features/tradfi/TradfiPopoutChartPage.tsx` — desktop popout page.
- Modify `features/tradfi/TradfiChainView.tsx` — remove the Price tab; render `ChainTable` with `chartOverride`; hold mobile-modal local state.
- Modify `features/tradfi/index.ts` — export `TradfiPopoutChartPage`.
- Modify `main.tsx` — detect `provider=tradfi` → render `TradfiPopoutChartPage`.
- Modify `features/chain/ChainTable.tsx` — thread optional `chartOverride` prop.
- Modify `features/chain/ExpandedRow.tsx` — accept `chartOverride`; enable the Chart button when present.
- Modify `features/chain/index.ts` — re-export `attributePnL` + types and the presentational components (so tradfi imports a stable surface).
- Delete `features/tradfi/TradfiPriceChart.tsx`, `TradfiPriceChart.module.css`, `TradfiPriceChart.test.tsx` (the dead Price tab).
- Tests: `use-tradfi-attribution.test.ts`, `use-tradfi-underlying-candles.test.ts`, `tradfi-chart-popout.test.ts`, `TradfiChartPanel.test.tsx`, modify `TradfiChainView.test.tsx`, `ExpandedRow` chartOverride test.

---

## Task 1: Backend — `buildUnderlyingCandlesResponse`

**Files:**
- Modify: `packages/tradfi/src/runtime/candles.ts`
- Test: `packages/tradfi/src/runtime/candles.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/tradfi/src/runtime/candles.test.ts`:

```ts
import { buildUnderlyingCandlesResponse } from './candles.js';

describe('buildUnderlyingCandlesResponse', () => {
  const rawBars = [
    { symbol: 'SPY{=1h}', flags: 0, time: 1_700_000_000_000, o: 500, h: 505, l: 499, c: 503, v: 10 },
    { symbol: 'SPY{=1h}', flags: 0, time: 1_700_003_600_000, o: 503, h: 507, l: 502, c: 506, v: 12 },
  ];

  it('fetches candles for the plain underlying symbol and maps them to USD', async () => {
    const calls: Array<{ symbol: string; period: string }> = [];
    const client = {
      getCandles: async (symbol: string, period: string) => {
        calls.push({ symbol, period });
        return rawBars;
      },
    };
    const res = await buildUnderlyingCandlesResponse(client, {
      underlying: 'SPY', interval: '1h', range: '7d', nowMs: 1_700_004_000_000,
    });
    expect(calls).toEqual([{ symbol: 'SPY', period: '1h' }]);
    expect(res.symbol).toBe('SPY');
    expect(res.priceCurrency).toBe('USD');
    expect(res.candles).toHaveLength(2);
    expect(res.candles[0]).toMatchObject({ ts: 1_700_000_000_000, o: 500, h: 505, l: 499, c: 503, vol: 10, synthetic: false });
    expect(res.markLine).toEqual([]);
  });

  it('drops bars with non-finite OHLC', async () => {
    const client = {
      getCandles: async () => [
        { symbol: 'SPY{=1h}', flags: 0, time: 1, o: NaN, h: 1, l: 1, c: 1, v: 0 },
        { symbol: 'SPY{=1h}', flags: 0, time: 2, o: 1, h: 1, l: 1, c: 1, v: 0 },
      ],
    };
    const res = await buildUnderlyingCandlesResponse(client, {
      underlying: 'SPY', interval: '1h', range: '1d', nowMs: 1000,
    });
    expect(res.candles).toHaveLength(1);
    expect(res.candles[0]!.ts).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/tradfi test -- candles`
Expected: FAIL with "buildUnderlyingCandlesResponse is not a function" / not exported.

- [ ] **Step 3: Implement**

In `packages/tradfi/src/runtime/candles.ts`, refactor the option mapper into a shared helper and add the underlying builder. Replace the body of `buildCandlesResponse`'s mapping with the helper and append the new function:

```ts
// Add near the top-level (after imports), a shared mapper:
function mapRawCandles(raw: RawCandle[]) {
  return raw
    .filter((b) => Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .map((b) => ({ ts: b.time, o: b.o, h: b.h, l: b.l, c: b.c, vol: Number.isFinite(b.v) ? b.v : 0, synthetic: false }));
}

export interface UnderlyingCandlesQuery {
  underlying: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  nowMs: number;
}

// The underlying equity/index streams candles under its plain symbol — the same
// string the feed subscribes for spot (see tastytrade/state.ts: spot is keyed by
// eventSymbol === underlying). This is the forward-proxy series for attribution.
export async function buildUnderlyingCandlesResponse(
  client: CandleSource,
  q: UnderlyingCandlesQuery,
): Promise<TradfiCandlesResponse> {
  const period = intervalToPeriod(q.interval);
  const fromTime = rangeToFromTimeSec(q.range, q.nowMs);
  const raw = await client.getCandles(q.underlying, period, fromTime);
  return { symbol: q.underlying, interval: q.interval, priceCurrency: 'USD', candles: mapRawCandles(raw), markLine: [] };
}
```

Then update the existing `buildCandlesResponse` to use the helper (replace its inline `.filter(...).map(...)` with `const candles = mapRawCandles(raw);`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/tradfi test -- candles`
Expected: PASS (new tests + existing `buildCandlesResponse` tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/runtime/candles.ts packages/tradfi/src/runtime/candles.test.ts
git commit -m "feat(tradfi): underlying-candle response builder (attribution forward proxy)"
```

---

## Task 2: Backend — `/underlying-candles` route

**Files:**
- Create: `packages/tradfi/src/routes/underlying-candles.ts`
- Modify: `packages/tradfi/src/app.ts`
- Test: `packages/tradfi/src/app.test.ts` (add a route case)

- [ ] **Step 1: Write the failing test**

Add to `packages/tradfi/src/app.test.ts` (mirror the existing `/candles` route test — reuse its app/deps harness; if the file builds the app via a `makeApp`/`buildApp` helper, follow that exact pattern). Minimal assertions:

```ts
it('GET /underlying-candles returns 400 without underlying', async () => {
  const app = buildApp(depsWithCandleClient());
  const res = await app.inject({ method: 'GET', url: '/underlying-candles?interval=1h&range=7d' });
  expect(res.statusCode).toBe(400);
});

it('GET /underlying-candles returns candles for a known underlying', async () => {
  const app = buildApp(depsWithCandleClient()); // candleClient.isReady() === true, getCandles → 1 bar
  const res = await app.inject({ method: 'GET', url: '/underlying-candles?underlying=SPY&interval=1h&range=7d' });
  expect(res.statusCode).toBe(200);
  expect(res.json().symbol).toBe('SPY');
  expect(Array.isArray(res.json().candles)).toBe(true);
});

it('GET /underlying-candles returns 503 when candle feed is not ready', async () => {
  const app = buildApp(depsWithCandleClient({ ready: false }));
  const res = await app.inject({ method: 'GET', url: '/underlying-candles?underlying=SPY&interval=1h&range=7d' });
  expect(res.statusCode).toBe(503);
});
```

> If `app.test.ts` lacks a candleClient harness, add a small local `depsWithCandleClient` factory that returns `TradfiDeps` with a stub `store`, a stub `feed.readiness()`, and a `candleClient` exposing `isReady()` + `getCandles()`. Mirror the shape used by the existing `/candles` test in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/tradfi test -- app`
Expected: FAIL — route 404 (not registered) so statusCode is 404, not 400/200/503.

- [ ] **Step 3: Implement the route**

Create `packages/tradfi/src/routes/underlying-candles.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildUnderlyingCandlesResponse } from '../runtime/candles.js';
import { InstrumentCandleIntervalSchema, InstrumentCandleRangeSchema } from '@oggregator/protocol';

export function underlyingCandlesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: Record<string, string> }>('/underlying-candles', async (req, reply) => {
      const { underlying, interval, range } = req.query;
      const i = InstrumentCandleIntervalSchema.safeParse(interval);
      const r = InstrumentCandleRangeSchema.safeParse(range);
      if (!underlying || !i.success || !r.success) {
        return reply.status(400).send({ error: 'underlying, interval, range required' });
      }
      if (!deps.candleClient || !deps.candleClient.isReady()) {
        return reply.status(503).send({ error: 'candle feed not ready' });
      }
      return buildUnderlyingCandlesResponse(deps.candleClient, {
        underlying, interval: i.data, range: r.data, nowMs: Date.now(),
      });
    });
  };
}
```

In `packages/tradfi/src/app.ts`, add the import and registration:

```ts
import { underlyingCandlesRoute } from './routes/underlying-candles.js';
// …inside buildApp, after candlesRoute:
void app.register(underlyingCandlesRoute(deps));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/tradfi test -- app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/routes/underlying-candles.ts packages/tradfi/src/app.ts packages/tradfi/src/app.test.ts
git commit -m "feat(tradfi): GET /underlying-candles route"
```

---

## Task 3: Frontend — `useTradfiUnderlyingCandles` hook

**Files:**
- Create: `packages/web/src/features/tradfi/use-tradfi-underlying-candles.ts`
- Test: `packages/web/src/features/tradfi/use-tradfi-underlying-candles.test.ts`

- [ ] **Step 1: Write the failing test** (pure parser, no React needed)

```ts
import { describe, it, expect } from 'vitest';
import { parseTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';

describe('parseTradfiUnderlyingCandles', () => {
  it('parses a valid payload', () => {
    const out = parseTradfiUnderlyingCandles({
      candles: [{ ts: 1, o: 1, h: 2, l: 0.5, c: 1.5, vol: 3, synthetic: false }],
      markLine: [],
    });
    expect(out.candles).toHaveLength(1);
  });
  it('throws on a malformed payload', () => {
    expect(() => parseTradfiUnderlyingCandles({ candles: [{ ts: 'x' }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- use-tradfi-underlying-candles`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (mirror `use-tradfi-candles.ts` — local Zod v4 schemas, NOT protocol's v3 schemas)

```ts
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { tradfiFetchJson } from '@lib/tradfi-http';

const CandleSchema = z.object({
  ts: z.number().int().nonnegative(),
  o: z.number().nonnegative(),
  h: z.number().nonnegative(),
  l: z.number().nonnegative(),
  c: z.number().nonnegative(),
  vol: z.number().nonnegative(),
  synthetic: z.boolean(),
});

const PayloadSchema = z.object({ candles: z.array(CandleSchema), markLine: z.array(z.unknown()) });

export function parseTradfiUnderlyingCandles(raw: unknown) {
  const p = PayloadSchema.safeParse(raw);
  if (!p.success) throw new Error(`tradfi underlying candles schema mismatch: ${p.error.message}`);
  return p.data;
}

export function useTradfiUnderlyingCandles(args: {
  underlying: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
}) {
  const { underlying, interval, range, enabled = true } = args;
  return useQuery({
    queryKey: ['tradfi-underlying-candles', underlying, interval, range],
    queryFn: async () =>
      parseTradfiUnderlyingCandles(
        await tradfiFetchJson(
          `/underlying-candles?underlying=${encodeURIComponent(underlying)}&interval=${interval}&range=${range}`,
        ),
      ),
    enabled: enabled && !!underlying,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test -- use-tradfi-underlying-candles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/use-tradfi-underlying-candles.ts packages/web/src/features/tradfi/use-tradfi-underlying-candles.test.ts
git commit -m "feat(web): useTradfiUnderlyingCandles (attribution forward proxy)"
```

---

## Task 4: Frontend — re-export pure attribution math + presentational components from chain index

**Files:**
- Modify: `packages/web/src/features/chain/index.ts`

> Rationale: tradfi already deep-imports `@features/chain/InstrumentChart`. To keep a stable, intentional surface for the attribution math + charts, re-export them from the chain feature's `index.ts`. This avoids pulling the React-hook module (`use-instrument-attribution.ts`) into tradfi; tradfi imports only the pure `attributePnL` + types and the presentational components.

- [ ] **Step 1: Add exports** to `packages/web/src/features/chain/index.ts`:

```ts
export { default as InstrumentChart } from './InstrumentChart';
export { default as InstrumentAttributionChart } from './InstrumentAttributionChart';
export { AttributionSummary } from './AttributionSummary';
export { attributePnL } from './pnl-attribution';
export type { AttributionResult, AttributionBar, OptionRight } from './pnl-attribution';
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS (pure additive exports). If the protocol dist is stale and typecheck reports missing members, run `pnpm --filter @oggregator/protocol build` first (see project memory).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/features/chain/index.ts
git commit -m "chore(web): export attribution math + chart leaves from chain feature index"
```

---

## Task 5: Frontend — `useTradfiAttribution` hook

**Files:**
- Create: `packages/web/src/features/tradfi/use-tradfi-attribution.ts`
- Test: `packages/web/src/features/tradfi/use-tradfi-attribution.test.ts`

The hook composes option candles (closes = option mark series) + underlying candles (closes = forward series), aligns them by exact `ts`, computes `expirationMs` from the expiry date, and runs the pure `attributePnL`. Expose a pure `computeTradfiAttribution(...)` for testing.

- [ ] **Step 1: Write the failing test** (pure function only)

```ts
import { describe, it, expect } from 'vitest';
import { alignTradfiBars, expiryToMs, computeTradfiAttribution } from './use-tradfi-attribution';

describe('alignTradfiBars', () => {
  it('joins option and underlying closes by exact ts and drops unmatched', () => {
    const bars = alignTradfiBars(
      [{ ts: 100, c: 5 }, { ts: 200, c: 6 }, { ts: 300, c: 7 }],
      [{ ts: 100, c: 500 }, { ts: 300, c: 530 }],
    );
    expect(bars).toEqual([
      { ts: 100, mark: 5, forward: 500 },
      { ts: 300, mark: 7, forward: 530 },
    ]);
  });
});

describe('expiryToMs', () => {
  it('maps a YYYY-MM-DD expiry to ~US close (21:00 UTC) ms', () => {
    expect(expiryToMs('2026-06-19')).toBe(Date.parse('2026-06-19T21:00:00Z'));
  });
});

describe('computeTradfiAttribution', () => {
  it('returns null when fewer than 2 aligned bars', () => {
    const r = computeTradfiAttribution({
      optionCandles: [{ ts: 100, c: 5 }],
      underlyingCandles: [{ ts: 100, c: 500 }],
      strike: 500, right: 'call', expiry: '2026-12-18',
    });
    expect(r).toBeNull();
  });

  it('produces an attribution result for a multi-bar series', () => {
    const optionCandles = Array.from({ length: 6 }, (_, k) => ({ ts: 1_700_000_000_000 + k * 3_600_000, c: 10 + k }));
    const underlyingCandles = optionCandles.map((b, k) => ({ ts: b.ts, c: 500 + k * 2 }));
    const r = computeTradfiAttribution({
      optionCandles, underlyingCandles, strike: 500, right: 'call', expiry: '2027-01-15',
    });
    expect(r).not.toBeNull();
    expect(r!.points.length).toBeGreaterThan(0);
    expect(r!.summary).toHaveProperty('deltaPct');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- use-tradfi-attribution`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useMemo } from 'react';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { attributePnL, type AttributionBar, type AttributionResult, type OptionRight } from '@features/chain';
import { useTradfiCandles } from './use-tradfi-candles';
import { useTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';

interface CloseBar { ts: number; c: number }

// Join option closes to underlying closes by exact bucket timestamp. Bars without
// a forward match are dropped — attribution needs both legs at the same instant.
export function alignTradfiBars(option: readonly CloseBar[], underlying: readonly CloseBar[]): AttributionBar[] {
  const fwd = new Map<number, number>();
  for (const u of underlying) fwd.set(u.ts, u.c);
  const out: AttributionBar[] = [];
  for (const o of option) {
    const f = fwd.get(o.ts);
    if (f == null) continue;
    out.push({ ts: o.ts, mark: o.c, forward: f });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// US equity options stop trading at the 4pm ET close. We approximate the
// expiration instant as 21:00 UTC on the expiry date (≈ 4pm EST / 5pm EDT). The
// exact close time only matters for the final hours; far-dated bars are unaffected.
export function expiryToMs(expiry: string): number {
  return Date.parse(`${expiry}T21:00:00Z`);
}

export function computeTradfiAttribution(args: {
  optionCandles: readonly CloseBar[];
  underlyingCandles: readonly CloseBar[];
  strike: number;
  right: OptionRight;
  expiry: string;
}): AttributionResult | null {
  const expirationMs = expiryToMs(args.expiry);
  if (!Number.isFinite(expirationMs)) return null;
  const bars = alignTradfiBars(args.optionCandles, args.underlyingCandles);
  if (bars.length < 2) return null;
  return attributePnL({ bars, strike: args.strike, right: args.right, expirationMs });
}

export interface UseTradfiAttributionArgs {
  underlying: string;
  expiry: string;
  strike: number | null;
  right: OptionRight;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
}

export function useTradfiAttribution(args: UseTradfiAttributionArgs) {
  const { underlying, expiry, strike, right, interval, range, enabled = true } = args;
  const option = useTradfiCandles({ underlying, expiry, strike, right, interval, range, enabled });
  const under = useTradfiUnderlyingCandles({ underlying, interval, range, enabled });

  const result = useMemo<AttributionResult | null>(() => {
    if (!option.data || !under.data || strike == null) return null;
    return computeTradfiAttribution({
      optionCandles: option.data.candles.map((c) => ({ ts: c.ts, c: c.c })),
      underlyingCandles: under.data.candles.map((c) => ({ ts: c.ts, c: c.c })),
      strike, right, expiry,
    });
  }, [option.data, under.data, strike, right, expiry]);

  const isLoading = option.isLoading || under.isLoading;
  const error = (option.error ?? under.error) as Error | null;
  const insufficientData = !isLoading && !error && result == null && strike != null;

  return { result, isLoading, error, insufficientData, displayCurrency: 'USD' as const };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test -- use-tradfi-attribution`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/use-tradfi-attribution.ts packages/web/src/features/tradfi/use-tradfi-attribution.test.ts
git commit -m "feat(web): useTradfiAttribution (greeks PnL attribution for tastytrade)"
```

---

## Task 6: Frontend — `TradfiChartPanel` (Price + Attribution UI)

**Files:**
- Create: `packages/web/src/features/tradfi/TradfiChartPanel.tsx`
- Create: `packages/web/src/features/tradfi/TradfiChartPanel.module.css`
- Test: `packages/web/src/features/tradfi/TradfiChartPanel.test.tsx`

Single-venue (tastytrade), USD. Price mode → `InstrumentChart` fed by `useTradfiCandles`. Attribution mode → `AttributionSummary` + `InstrumentAttributionChart` fed by `useTradfiAttribution`. Mirrors `ChartPanelView` controls (mode toggle, interval, range) minus venue dots/overlays-complexity.

- [ ] **Step 1: Write the failing test** (stub the lightweight-charts leaves, as `TradfiPriceChart.test.tsx` already does)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@features/chain', async (orig) => ({
  ...(await orig()),
  InstrumentChart: () => <div data-testid="price-chart" />,
  InstrumentAttributionChart: () => <div data-testid="attr-chart" />,
  AttributionSummary: () => <div data-testid="attr-summary" />,
}));

vi.mock('./use-tradfi-candles', () => ({
  useTradfiCandles: () => ({ data: { candles: [{ ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0, synthetic: false }], markLine: [] }, isLoading: false, error: null }),
}));
vi.mock('./use-tradfi-attribution', () => ({
  useTradfiAttribution: () => ({ result: null, isLoading: false, error: null, insufficientData: true, displayCurrency: 'USD' }),
}));

import TradfiChartPanel from './TradfiChartPanel';

function renderPanel(mode: 'price' | 'attribution') {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TradfiChartPanel
        data={{ underlying: 'SPY', expiry: '2026-06-19', strike: 500, type: 'call', interval: '1h', range: '7d', chartMode: mode }}
        onPatch={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('TradfiChartPanel', () => {
  it('renders the price chart in price mode', () => {
    cleanup();
    renderPanel('price');
    expect(screen.getByTestId('price-chart')).toBeTruthy();
  });
  it('shows insufficient-data note in attribution mode when no result', () => {
    cleanup();
    renderPanel('attribution');
    expect(screen.queryByTestId('attr-chart')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- TradfiChartPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `TradfiChartPanel.tsx`

```tsx
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { InstrumentChart, InstrumentAttributionChart, AttributionSummary, type OptionRight } from '@features/chain';
import { useTradfiCandles } from './use-tradfi-candles';
import { useTradfiAttribution } from './use-tradfi-attribution';
import styles from './TradfiChartPanel.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

export interface TradfiChartPanelData {
  underlying: string;
  expiry: string;
  strike: number;
  type: OptionRight;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  chartMode: 'price' | 'attribution';
}

interface Props {
  data: TradfiChartPanelData;
  onPatch: (patch: Partial<TradfiChartPanelData>) => void;
  onClose?: () => void;
}

export default function TradfiChartPanel({ data, onPatch, onClose }: Props) {
  const { underlying, expiry, strike, type, interval, range, chartMode } = data;

  const candles = useTradfiCandles({ underlying, expiry, strike, right: type, interval, range, enabled: chartMode === 'price' });
  const attribution = useTradfiAttribution({ underlying, expiry, strike, right: type, interval, range, enabled: chartMode === 'attribution' });

  return (
    <div className={styles.panel}>
      <div className={styles.titlebar}>
        <span className={styles.title}>
          {underlying} {strike} {type.toUpperCase()} · {expiry} <span className={styles.cur}>· USD</span>
        </span>
        {onClose && <button type="button" onClick={onClose} aria-label="Close">✕</button>}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.modes}>
          <button type="button" data-active={chartMode === 'price' || undefined} onClick={() => onPatch({ chartMode: 'price' })}>Price</button>
          <button type="button" data-active={chartMode === 'attribution' || undefined} onClick={() => onPatch({ chartMode: 'attribution' })}>Attribution</button>
        </div>
        <div className={styles.group}>
          {INTERVALS.map((i) => (
            <button key={i} type="button" data-active={interval === i || undefined} onClick={() => onPatch({ interval: i })}>{i}</button>
          ))}
        </div>
        <div className={styles.group}>
          {RANGES.map((r) => (
            <button key={r} type="button" data-active={range === r || undefined} onClick={() => onPatch({ range: r })}>{r}</button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        {chartMode === 'price' ? (
          <>
            {candles.isLoading && !candles.data && <div className={styles.empty}>loading…</div>}
            {candles.error && <div className={styles.empty}>error — retry</div>}
            {candles.data && candles.data.candles.length === 0 && <div className={styles.empty}>No candle history for this strike.</div>}
            {candles.data && candles.data.candles.length > 0 && (
              <InstrumentChart candles={candles.data.candles} markLine={candles.data.markLine} overlays={{ mark: false, ma9: true, ma20: true }} />
            )}
          </>
        ) : (
          <>
            {attribution.isLoading && <div className={styles.empty}>computing attribution…</div>}
            {attribution.error && <div className={styles.empty}>error — retry</div>}
            {attribution.insufficientData && <div className={styles.empty}>insufficient option / underlying overlap for this strike + range</div>}
            {attribution.result && (
              <>
                <AttributionSummary summary={attribution.result.summary} priceCurrency="USD" />
                <InstrumentAttributionChart result={attribution.result} priceCurrency="USD" />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

`TradfiChartPanel.module.css` (mirror the visual language of `ChartPanelView`/`PopoutChartPage` modules — fill container, mono font, dark theme):

```css
.panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #0b0b0c; color: #e6e6e6; }
.titlebar { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #1a1a1a; font: 600 12px 'IBM Plex Mono', monospace; }
.title { letter-spacing: 0.02em; }
.cur { color: #7a7f87; font-weight: 400; }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #1a1a1a; }
.modes, .group { display: inline-flex; gap: 2px; }
.toolbar button { background: #141416; color: #9aa0a6; border: 1px solid #232327; border-radius: 4px; padding: 2px 8px; font: 11px 'IBM Plex Mono', monospace; cursor: pointer; }
.toolbar button[data-active] { color: #0b0b0c; background: #94b3fd; border-color: #94b3fd; }
.body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.empty { margin: auto; color: #7a7f87; font: 12px 'IBM Plex Mono', monospace; padding: 24px; text-align: center; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test -- TradfiChartPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/TradfiChartPanel.tsx packages/web/src/features/tradfi/TradfiChartPanel.module.css packages/web/src/features/tradfi/TradfiChartPanel.test.tsx
git commit -m "feat(web): TradfiChartPanel — price + greeks PnL attribution"
```

---

## Task 7: Frontend — popout URL helpers

**Files:**
- Create: `packages/web/src/features/tradfi/tradfi-chart-popout.ts`
- Test: `packages/web/src/features/tradfi/tradfi-chart-popout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildTradfiPopoutSearch, parseTradfiPopoutParams } from './tradfi-chart-popout';

describe('tradfi popout params round-trip', () => {
  it('builds and re-parses', () => {
    const search = buildTradfiPopoutSearch({ underlying: 'SPY', expiry: '2026-06-19', strike: 500, type: 'call' });
    const parsed = parseTradfiPopoutParams(`?${search}`);
    expect(parsed).toMatchObject({ underlying: 'SPY', expiry: '2026-06-19', strike: 500, type: 'call', mode: 'price' });
  });
  it('returns null when provider is not tradfi', () => {
    expect(parseTradfiPopoutParams('?popout=1&provider=crypto&underlying=SPY')).toBeNull();
  });
  it('returns null on missing fields', () => {
    expect(parseTradfiPopoutParams('?popout=1&provider=tradfi&underlying=SPY')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- tradfi-chart-popout`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (factor `buildTradfiPopoutSearch` so it's testable without `window.open`)

```ts
import type { OptionRight } from '@features/chain';

export interface TradfiPopoutArgs {
  underlying: string;
  expiry: string;
  strike: number;
  type: OptionRight;
}

export interface TradfiPopoutParams extends TradfiPopoutArgs {
  interval: string;
  range: string;
  mode: 'price' | 'attribution';
}

export function buildTradfiPopoutSearch(args: TradfiPopoutArgs): string {
  return new URLSearchParams({
    popout: '1', provider: 'tradfi',
    underlying: args.underlying, expiry: args.expiry,
    strike: String(args.strike), type: args.type,
    interval: '1h', range: '7d', mode: 'price',
  }).toString();
}

export function parseTradfiPopoutParams(search: string): TradfiPopoutParams | null {
  const p = new URLSearchParams(search);
  if (p.get('popout') !== '1' || p.get('provider') !== 'tradfi') return null;
  const underlying = p.get('underlying');
  const expiry = p.get('expiry');
  const strikeStr = p.get('strike');
  const type = p.get('type');
  if (!underlying || !expiry || !strikeStr || (type !== 'call' && type !== 'put')) return null;
  const strike = Number(strikeStr);
  if (!Number.isFinite(strike)) return null;
  const mode = p.get('mode') === 'attribution' ? 'attribution' : 'price';
  return { underlying, expiry, strike, type, interval: p.get('interval') ?? '1h', range: p.get('range') ?? '7d', mode };
}

export function openTradfiChartPopout(args: TradfiPopoutArgs): Window | null {
  const url = `${window.location.origin}/?${buildTradfiPopoutSearch(args)}`;
  const name = `tradfi-chart-${args.underlying}-${args.expiry}-${args.strike}-${args.type}`;
  const win = window.open(url, name, 'popup=yes,width=720,height=520');
  if (win) win.focus();
  return win;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test -- tradfi-chart-popout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/tradfi-chart-popout.ts packages/web/src/features/tradfi/tradfi-chart-popout.test.ts
git commit -m "feat(web): tradfi chart popout url helpers"
```

---

## Task 8: Frontend — `TradfiPopoutChartPage`

**Files:**
- Create: `packages/web/src/features/tradfi/TradfiPopoutChartPage.tsx`
- Modify: `packages/web/src/features/tradfi/index.ts`

- [ ] **Step 1: Implement the page** (no test beyond typecheck — it's a thin state shell around the already-tested panel)

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import TradfiChartPanel, { type TradfiChartPanelData } from './TradfiChartPanel';
import { parseTradfiPopoutParams } from './tradfi-chart-popout';
import styles from './TradfiPopoutChartPage.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

export default function TradfiPopoutChartPage() {
  const initial = useMemo(() => parseTradfiPopoutParams(window.location.search), []);
  const [data, setData] = useState<TradfiChartPanelData | null>(() =>
    initial
      ? {
          underlying: initial.underlying,
          expiry: initial.expiry,
          strike: initial.strike,
          type: initial.type,
          interval: (INTERVALS as string[]).includes(initial.interval) ? (initial.interval as InstrumentCandleInterval) : '1h',
          range: (RANGES as string[]).includes(initial.range) ? (initial.range as InstrumentCandleRange) : '7d',
          chartMode: initial.mode,
        }
      : null,
  );

  useEffect(() => {
    if (data) document.title = `${data.underlying} ${data.strike} ${data.type.toUpperCase()} · TradFi`;
  }, [data]);

  if (!data) return <div className={styles.error}>Invalid TradFi popout URL.</div>;
  return (
    <div className={styles.root}>
      <TradfiChartPanel data={data} onPatch={(patch) => setData((d) => (d ? { ...d, ...patch } : d))} />
    </div>
  );
}
```

`TradfiPopoutChartPage.module.css`:

```css
.root { position: fixed; inset: 0; background: #0b0b0c; }
.error { padding: 40px; color: #f87171; font: 13px 'IBM Plex Mono', monospace; }
```

In `packages/web/src/features/tradfi/index.ts` add:

```ts
export { default as TradfiPopoutChartPage } from './TradfiPopoutChartPage';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/features/tradfi/TradfiPopoutChartPage.tsx packages/web/src/features/tradfi/TradfiPopoutChartPage.module.css packages/web/src/features/tradfi/index.ts
git commit -m "feat(web): TradfiPopoutChartPage (desktop chart window)"
```

---

## Task 9: Frontend — route the TradFi popout in `main.tsx`

**Files:**
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Implement** — branch on `provider=tradfi` (crypto popout path byte-identical otherwise)

Replace the popout detection + render in `main.tsx`:

```tsx
import { TradfiPopoutChartPage } from '@features/tradfi';
// …
const search = new URLSearchParams(window.location.search);
const isPopout = search.get('popout') === '1';
const isTradfiPopout = isPopout && search.get('provider') === 'tradfi';
// …inside render:
<ErrorBoundary label={isPopout ? 'Chart popout' : 'Application'}>
  {isTradfiPopout ? <TradfiPopoutChartPage /> : isPopout ? <PopoutChartPage /> : <App />}
</ErrorBoundary>
```

- [ ] **Step 2: Typecheck + full web tests**

Run: `pnpm --filter @oggregator/web typecheck && pnpm --filter @oggregator/web test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/main.tsx
git commit -m "feat(web): mount TradfiPopoutChartPage for provider=tradfi popouts"
```

---

## Task 10: Shared chain — `chartOverride` callback on `ExpandedRow`/`ChainTable`

**Files:**
- Modify: `packages/web/src/features/chain/ExpandedRow.tsx`
- Modify: `packages/web/src/features/chain/ChainTable.tsx`
- Test: `packages/web/src/features/chain/ExpandedRow.test.tsx` (create if absent)

> Additive, generic callback. When `chartOverride` is provided, the "Chart" button is **enabled regardless of venue gating** and calls `chartOverride({underlying, expiry, strike, type})` instead of the crypto popout/panel. When absent, crypto behavior is byte-identical. `features/chain` gains NO tradfi import.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ExpandedRow from './ExpandedRow';

const emptySide = { venues: {}, bestVenue: null, bestIv: null } as never;

describe('ExpandedRow chartOverride', () => {
  it('enables the Chart button and calls chartOverride for a no-VenueId chain', () => {
    cleanup();
    const onChart = vi.fn();
    render(
      <ExpandedRow
        strike={500} callSide={emptySide} putSide={emptySide} myIv={null}
        activeVenues={['tastytrade']} atmStrike={500} atmConsensusForward={null}
        underlying="SPY" expiry="2026-06-19" chartOverride={onChart}
      />,
    );
    const btns = screen.getAllByRole('button', { name: /chart/i });
    expect(btns[0]).not.toBeDisabled();
    fireEvent.click(btns[0]!);
    expect(onChart).toHaveBeenCalledWith({ underlying: 'SPY', expiry: '2026-06-19', strike: 500, type: 'call' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- ExpandedRow`
Expected: FAIL — `chartOverride` not a prop; button disabled.

- [ ] **Step 3: Implement** — in `ExpandedRow.tsx`:

Add to `ExpandedRowProps`:
```ts
  chartOverride?: (args: { underlying: string; expiry: string; strike: number; type: 'call' | 'put' }) => void;
```
Destructure `chartOverride` in `ExpandedRow(...)` and pass it to both `<ChartButton …>` usages: add prop `chartOverride={chartOverride}`.

Extend `ChartButtonProps`:
```ts
  chartOverride?: (args: { underlying: string; expiry: string; strike: number; type: 'call' | 'put' }) => void;
```
Update `ChartButton` so the override short-circuits venue gating:
```tsx
function ChartButton({ underlying, expiry, strike, type, side, activeVenues, chartOverride }: ChartButtonProps) {
  const openPanel = useChartPanelsStore((s) => s.openPanel);
  const isMobile = useIsMobile();
  const venue = pickPrimaryVenue(side, activeVenues);
  const disabled = chartOverride ? false : venue == null;
  return (
    <button
      type="button"
      className={styles.chartBtn}
      disabled={disabled}
      title={disabled ? 'No venue available for this strike' : `Open chart for ${type.toUpperCase()}`}
      onClick={() => {
        if (chartOverride) { chartOverride({ underlying, expiry, strike, type }); return; }
        if (!venue) return;
        try {
          const symbol = toVenueSymbol({ venue, underlying, expiry, strike, type });
          if (isMobile) openPanel({ venue, symbol, underlying, expiry, strike, type });
          else openChartPopout({ venue, symbol, underlying, expiry, strike, type });
        } catch (err) {
          if (err instanceof NotSupportedVenueError) return;
          throw err;
        }
      }}
    >
      Chart
    </button>
  );
}
```

In `ChainTable.tsx`: add `chartOverride?` to `NewChainTableProps`, thread it through `StrikeRowItem` props (add to `StrikeRowProps` + `StrikeRowItemPropsInternal`), pass into `<ExpandedRow … chartOverride={chartOverride} />`, and pass `chartOverride={chartOverride}` from `NewChainTable` down to each `<StrikeRowItem>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/web test -- ExpandedRow ChainTable`
Expected: PASS. Also run the crypto chain tests to confirm no regression: `pnpm --filter @oggregator/web test -- chain`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/chain/ExpandedRow.tsx packages/web/src/features/chain/ChainTable.tsx packages/web/src/features/chain/ExpandedRow.test.tsx
git commit -m "feat(web): generic chartOverride hook on chain Chart button (no tradfi coupling)"
```

---

## Task 11: TradFi chain view — replace Price tab with per-strike Chart flow

**Files:**
- Modify: `packages/web/src/features/tradfi/TradfiChainView.tsx`
- Modify: `packages/web/src/features/tradfi/TradfiChainView.test.tsx`
- Delete: `packages/web/src/features/tradfi/TradfiPriceChart.tsx`, `TradfiPriceChart.module.css`, `TradfiPriceChart.test.tsx`

- [ ] **Step 1: Update the test** to assert the Price tab is gone and the chain renders (replace the tab-switching assertions). Keep the existing `InstrumentChart` stub. Add an assertion that there is no `Price` tab button:

```tsx
it('renders the chain without a Price tab', async () => {
  // …existing render setup with mocked useTradfiChain returning strikes…
  expect(screen.queryByRole('button', { name: 'Price' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chain' })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test -- TradfiChainView`
Expected: FAIL — Price/Chain tab buttons still present.

- [ ] **Step 3: Implement** — rewrite `TradfiChainView.tsx` to drop the tab bar + `TradfiPriceChart`, render `ChainTable` directly, and wire `chartOverride` (desktop popout / mobile in-page modal via local state):

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '@stores/app-store';
import { Spinner, EmptyState } from '@components/ui';
import { useIsMobile } from '@hooks/useIsMobile';
import { ExpiryBar, StatStrip, ChainTable } from '@features/chain';
import { useTradfiUnderlyings, useTradfiExpiries, useTradfiChain } from './queries';
import TradfiChartPanel, { type TradfiChartPanelData } from './TradfiChartPanel';
import { openTradfiChartPopout } from './tradfi-chart-popout';
import styles from './TradfiChainView.module.css';

const TRADFI_VENUES = ['tastytrade'];

export default function TradfiChainView() {
  const isMobile = useIsMobile();
  const [modal, setModal] = useState<TradfiChartPanelData | null>(null);
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const expiry = useAppStore((s) => s.tradfiExpiry);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const setExpiry = useAppStore((s) => s.setTradfiExpiry);

  const { data: underlyingsData } = useTradfiUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data: expiriesData } = useTradfiExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { data: chain, isLoading, error } = useTradfiChain(underlying, expiry);

  useEffect(() => {
    if (underlyings.length > 0 && !underlyings.includes(underlying)) setUnderlying(underlyings[0]!);
  }, [underlyings, underlying, setUnderlying]);
  useEffect(() => {
    if (expiries.length > 0 && !expiry) setExpiry(expiries[0]!);
  }, [expiries, expiry, setExpiry]);

  function openChart(args: { underlying: string; expiry: string; strike: number; type: 'call' | 'put' }) {
    if (isMobile) {
      setModal({ ...args, interval: '1h', range: '7d', chartMode: 'price' });
    } else {
      openTradfiChartPopout(args);
    }
  }

  return (
    <div className={styles.view}>
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

      {chain && <StatStrip stats={chain.stats} underlying={chain.underlying} dte={chain.dte} marketStats={null} />}

      <div className={styles.tableArea}>
        {isLoading && !chain && <Spinner size="lg" label="Loading TradFi chain…" />}
        {error && !chain && (
          <EmptyState icon="⚠" title="Failed to load TradFi chain" detail={error instanceof Error ? error.message : 'Is the TradFi service running on :3200?'} />
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
            expiry={expiry}
            underlying={underlying}
            chartOverride={openChart}
          />
        )}
      </div>

      {modal && (
        <div className={styles.modalBackdrop} onClick={() => setModal(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <TradfiChartPanel data={modal} onPatch={(patch) => setModal((m) => (m ? { ...m, ...patch } : m))} onClose={() => setModal(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
```

Append modal styles to `TradfiChainView.module.css`:

```css
.modalBackdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: stretch; justify-content: center; z-index: 50; }
.modalCard { width: 100%; max-width: 760px; margin: auto; height: 80vh; max-height: 600px; background: #0b0b0c; border: 1px solid #232327; border-radius: 8px; overflow: hidden; }
```

Then delete the dead Price-tab files:

```bash
git rm packages/web/src/features/tradfi/TradfiPriceChart.tsx packages/web/src/features/tradfi/TradfiPriceChart.module.css packages/web/src/features/tradfi/TradfiPriceChart.test.tsx
```

If `TradfiChainView.module.css` still declares `.tabBar`/`.tabBtn`, remove those now-unused rules.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/web test -- TradfiChainView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/
git commit -m "feat(web): TradFi per-strike Chart flow replaces the global Price tab"
```

---

## Task 12: Full verification

- [ ] **Step 1: Typecheck both packages**

Run: `pnpm --filter @oggregator/protocol build && pnpm --filter @oggregator/web typecheck && pnpm --filter @oggregator/tradfi typecheck`
Expected: PASS.

- [ ] **Step 2: Run both test suites**

Run: `pnpm --filter @oggregator/web test && pnpm --filter @oggregator/tradfi test`
Expected: PASS (no regressions in crypto chain tests).

- [ ] **Step 3: Lint/format** (biome) on changed files

Run: `pnpm --filter @oggregator/web lint` (or repo-root biome). Fix `noArrayIndexKey` / import-order issues.

- [ ] **Step 4: Manual smoke (dev)**

With the TradFi service reachable: open the app → TRADFI mode → expand a strike → click **Chart**. Desktop: a popout opens showing the option price candles; toggle **Attribution** → greeks PnL decomposition (Δ/Γ/Θ/V/residual). Verify a sub-$1 / cheap option still renders (sub-dollar scaling). Mobile viewport: the in-page modal opens with the same panel.

- [ ] **Step 5: Final commit if any fixups**

```bash
git add -A && git commit -m "chore(tradfi-charts): lint + verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** price-on-Chart-button (Tasks 6,9,10,11) ✓; greeks PnL attribution (Tasks 1–6) ✓; replace Price tab (Task 11) ✓; popout desktop + modal mobile (Tasks 7,8,9,11) ✓; isolation from crypto / no `VenueId` pollution (Task 10 generic callback; separate tradfi data path) ✓.
- **Known approximations (documented):** `expiryToMs` uses 21:00 UTC (≈ US close) — fine for attribution; underlying candle symbol = plain `underlying` (equities clean; index symbols like SPX may need a streamer-symbol map — follow-up if live smoke shows empty underlying candles).
- **Deploy:** TradFi backend change (new route) → manual **Scaleway redeploy** of `@oggregator/tradfi`; web → push + deploy. (Auto-commit/push is intermittent — verify with `git log` before claiming pushed.)
