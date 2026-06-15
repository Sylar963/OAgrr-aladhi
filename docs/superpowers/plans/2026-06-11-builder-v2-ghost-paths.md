# Builder V2 Ghost-Candle Projection Paths + Snapshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay three always-distinct ghost-candle projection paths (Up / Down / Flat-θ, each colored by its own at-expiry P&L) on the Builder V2 candle chart, plus local snapshot capture + re-overlay to compare projections against realized price later.

**Architecture:** Two new pure modules — `ghost-paths.ts` (band math + synthetic candle geometry, built on the existing `pnlAtPrice`) and `snapshots-store.ts` (localStorage CRUD, zod-validated). `PayoffChartV2.tsx` renders the paths as three translucent lightweight-charts `Candlestick` series + a legend overlay. `ArchitectView.tsx` computes the live paths, owns the toggle/snapshot UI state, and feeds either the live paths or a selected snapshot to the chart. Client-only, additive, no server/WS/deps.

**Tech Stack:** React 19, TypeScript, lightweight-charts 5.1.0, zod, Vitest (jsdom), CSS Modules.

**Design doc:** `docs/superpowers/specs/2026-06-11-builder-v2-ghost-paths-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/web/src/features/architect/ghost-paths.ts` | Pure: band → 3 targets → P&L/color; synthetic candle geometry | Create |
| `packages/web/src/features/architect/ghost-paths.test.ts` | Unit tests for the above | Create |
| `packages/web/src/features/architect/snapshots-store.ts` | localStorage CRUD + zod schema for snapshots | Create |
| `packages/web/src/features/architect/snapshots-store.test.ts` | Unit tests for the store | Create |
| `packages/web/src/features/architect/PayoffChartV2.tsx` | Render 3 ghost candlestick series + legend overlay | Modify |
| `packages/web/src/features/architect/ArchitectView.tsx` | Compute live paths, projection/snapshot state + controls, wire props | Modify |
| `packages/web/src/features/architect/Architect.module.css` | Styles for the controls row + legend | Modify |

**Note on git:** these are all under `packages/` (NOT gitignored), so commits behave normally. End every commit message with the `Co-Authored-By` trailer shown in the steps.

---

## Task 1: `ghost-paths.ts` — constants + `buildPathCandles`

**Files:**
- Create: `packages/web/src/features/architect/ghost-paths.ts`
- Test: `packages/web/src/features/architect/ghost-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/features/architect/ghost-paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPathCandles, WICK_PCT } from './ghost-paths';

const DAY_MS = 86_400_000;

describe('buildPathCandles', () => {
  it('walks one bar per bucket from spot to target, ascending', () => {
    const candles = buildPathCandles(100, 130, 0, 90 * DAY_MS, 86_400);
    expect(candles).toHaveLength(90);
    expect(candles[0]!.open).toBe(100);
    expect(candles.at(-1)!.close).toBeCloseTo(130, 5);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp).toBeGreaterThan(candles[i - 1]!.timestamp);
    }
  });

  it('keeps a flat (theta) path visible via the wick floor', () => {
    const candles = buildPathCandles(100, 100, 0, 7 * DAY_MS, 86_400);
    const c = candles[0]!;
    expect(c.open).toBe(c.close);
    expect(c.high - c.low).toBeCloseTo(2 * 100 * WICK_PCT, 6);
    expect(c.high).toBeGreaterThan(c.low);
  });

  it('returns [] for a non-positive span', () => {
    expect(buildPathCandles(100, 130, 1000, 1000, 86_400)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && pnpm vitest run src/features/architect/ghost-paths.test.ts`
Expected: FAIL — `Failed to resolve import './ghost-paths'` / `buildPathCandles is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/web/src/features/architect/ghost-paths.ts`:

```ts
import type { Leg } from './payoff';
import { pnlAtPrice } from './payoff';
import type { SpotCandle } from './queries';

export type GhostPathKind = 'up' | 'down' | 'theta';

export interface GhostPath {
  kind: GhostPathKind;
  isProfit: boolean;
  targetPrice: number;
  pnlAtExpiry: number;
  candles: SpotCandle[];
}

// Tunables — see design doc §9.
export const SIGMA_MULTIPLE = 1;
export const MIN_BAND_PCT = 0.015;
export const DEFAULT_IV = 0.6;
export const WICK_PCT = 0.0005;
export const WICK_BODY_FRAC = 0.15;
export const MAX_PROJECTION_BARS = 1000;

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * Synthetic ghost-candle walk gliding linearly from `spot` (at anchorBarTimeMs)
 * to `target` (at expiryMs), one bar per resolution bucket. These are scenario
 * illustrations, NOT forecasts — the glide is deliberately straight. The
 * WICK_PCT floor keeps a flat (theta) path readable as candles.
 */
export function buildPathCandles(
  spot: number,
  target: number,
  anchorBarTimeMs: number,
  expiryMs: number,
  resolutionSec: number,
): SpotCandle[] {
  const stepMs = resolutionSec * 1000;
  const span = expiryMs - anchorBarTimeMs;
  if (span <= 0 || stepMs <= 0 || spot <= 0) return [];

  const barCount = Math.min(MAX_PROJECTION_BARS, Math.ceil(span / stepMs));
  const candles: SpotCandle[] = [];
  let prevPrice = spot;
  for (let i = 1; i <= barCount; i++) {
    const t = anchorBarTimeMs + i * stepMs;
    const frac = Math.min(1, (t - anchorBarTimeMs) / span);
    const close = spot + (target - spot) * frac;
    const open = prevPrice;
    const wick = Math.max(spot * WICK_PCT, Math.abs(close - open) * WICK_BODY_FRAC);
    candles.push({
      timestamp: t,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
    });
    prevPrice = close;
  }
  return candles;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && pnpm vitest run src/features/architect/ghost-paths.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/architect/ghost-paths.ts packages/web/src/features/architect/ghost-paths.test.ts
git commit -m "feat(architect): add buildPathCandles ghost-candle geometry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `ghost-paths.ts` — `computeGhostPaths`

**Files:**
- Modify: `packages/web/src/features/architect/ghost-paths.ts`
- Test: `packages/web/src/features/architect/ghost-paths.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/web/src/features/architect/ghost-paths.test.ts`:

```ts
import { computeGhostPaths, type GhostPath } from './ghost-paths';
import type { Leg } from './payoff';

function leg(over: Partial<Leg> = {}): Leg {
  return {
    id: over.id ?? 'l1',
    type: over.type ?? 'call',
    direction: over.direction ?? 'buy',
    strike: over.strike ?? 100,
    expiry: over.expiry ?? '2026-09-01',
    quantity: over.quantity ?? 1,
    entryPrice: over.entryPrice ?? 5,
    venue: over.venue ?? 'deribit',
    delta: over.delta ?? null,
    gamma: over.gamma ?? null,
    theta: over.theta ?? null,
    vega: over.vega ?? null,
    iv: over.iv === undefined ? 0.6 : over.iv,
  };
}

const ANCHOR = 0;
const EXPIRY_90D = 90 * DAY_MS;
const RES = 86_400;
const byKind = (paths: GhostPath[], k: string) => paths.find((p) => p.kind === k)!;

describe('computeGhostPaths', () => {
  it('long call: up wins, down & flat lose', () => {
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES);
    expect(paths.map((p) => p.kind)).toEqual(['up', 'down', 'theta']);
    expect(byKind(paths, 'up').isProfit).toBe(true);
    expect(byKind(paths, 'down').isProfit).toBe(false);
    expect(byKind(paths, 'theta').isProfit).toBe(false);
  });

  it('long straddle: both moves win, flat loses (theta red)', () => {
    const legs = [leg({ type: 'call' }), leg({ id: 'l2', type: 'put' })];
    const paths = computeGhostPaths(legs, 100, EXPIRY_90D, ANCHOR, RES);
    expect(byKind(paths, 'up').isProfit).toBe(true);
    expect(byKind(paths, 'down').isProfit).toBe(true);
    expect(byKind(paths, 'theta').isProfit).toBe(false);
  });

  it('short strangle: both moves lose, flat earns (theta green = sell-vol flip)', () => {
    const legs = [
      leg({ type: 'call', direction: 'sell', strike: 110, entryPrice: 3 }),
      leg({ id: 'l2', type: 'put', direction: 'sell', strike: 90, entryPrice: 3 }),
    ];
    const paths = computeGhostPaths(legs, 100, EXPIRY_90D, ANCHOR, RES);
    expect(byKind(paths, 'up').isProfit).toBe(false);
    expect(byKind(paths, 'down').isProfit).toBe(false);
    expect(byKind(paths, 'theta').isProfit).toBe(true);
  });

  it('caps the target band near 1 sigma (~spot*iv*sqrt(T))', () => {
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES);
    // bandHalf = 100 * 0.6 * sqrt(90/365) ≈ 29.79
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(129.79, 1);
    expect(byKind(paths, 'down').targetPrice).toBeCloseTo(70.21, 1);
  });

  it('applies the visibility floor near expiry', () => {
    const paths = computeGhostPaths([leg()], 100, 3_600_000, ANCHOR, 300);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(101.5, 5); // 100 * MIN_BAND_PCT
  });

  it('falls back to DEFAULT_IV when no leg reports iv', () => {
    const paths = computeGhostPaths([leg({ iv: null })], 100, EXPIRY_90D, ANCHOR, RES);
    expect(paths).toHaveLength(3);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(129.79, 1);
  });

  it('returns [] for empty legs', () => {
    expect(computeGhostPaths([], 100, EXPIRY_90D, ANCHOR, RES)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/web && pnpm vitest run src/features/architect/ghost-paths.test.ts`
Expected: FAIL — `computeGhostPaths is not a function`.

- [ ] **Step 3: Implement `computeGhostPaths`**

Append to `packages/web/src/features/architect/ghost-paths.ts`:

```ts
/** Mean implied vol (fraction) across legs that report it; DEFAULT_IV when none do. */
function representativeIv(legs: Leg[]): number {
  const ivs = legs.map((l) => l.iv).filter((iv): iv is number => iv != null && iv > 0);
  if (ivs.length === 0) return DEFAULT_IV;
  return ivs.reduce((sum, iv) => sum + iv, 0) / ivs.length;
}

/**
 * Three projected price paths for the open structure, from `anchorBarTimeMs` to
 * the nearest-expiry horizon: Up (+1σ), Down (−1σ), Flat (θ). Each is colored by
 * its own at-expiry P&L, so the win/lose direction and the buy-vol/sell-vol theta
 * flip fall out of one rule (see design doc §3).
 */
export function computeGhostPaths(
  legs: Leg[],
  spotPrice: number,
  horizonExpiryMs: number,
  anchorBarTimeMs: number,
  resolutionSec: number,
): GhostPath[] {
  if (legs.length === 0 || spotPrice <= 0) return [];
  if (!Number.isFinite(horizonExpiryMs) || horizonExpiryMs <= anchorBarTimeMs) return [];

  const tYears = Math.max(0, (horizonExpiryMs - anchorBarTimeMs) / MS_PER_YEAR);
  const sigmaMove = spotPrice * representativeIv(legs) * Math.sqrt(tYears);
  const bandHalf = Math.max(sigmaMove * SIGMA_MULTIPLE, spotPrice * MIN_BAND_PCT);

  const targets: { kind: GhostPathKind; target: number }[] = [
    { kind: 'up', target: spotPrice + bandHalf },
    { kind: 'down', target: Math.max(spotPrice * 0.01, spotPrice - bandHalf) },
    { kind: 'theta', target: spotPrice },
  ];

  return targets.map(({ kind, target }) => {
    const pnl = pnlAtPrice(legs, target);
    return {
      kind,
      isProfit: pnl >= 0,
      targetPrice: target,
      pnlAtExpiry: pnl,
      candles: buildPathCandles(spotPrice, target, anchorBarTimeMs, horizonExpiryMs, resolutionSec),
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/web && pnpm vitest run src/features/architect/ghost-paths.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/architect/ghost-paths.ts packages/web/src/features/architect/ghost-paths.test.ts
git commit -m "feat(architect): add computeGhostPaths up/down/theta projection model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `snapshots-store.ts`

**Files:**
- Create: `packages/web/src/features/architect/snapshots-store.ts`
- Test: `packages/web/src/features/architect/snapshots-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/features/architect/snapshots-store.test.ts` (jsdom provides `localStorage`; `globals:false` so import test fns explicitly):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addSnapshot, listSnapshots, removeSnapshot, clearSnapshots,
  MAX_SNAPSHOTS, type GhostSnapshot,
} from './snapshots-store';

function snap(over: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return {
    id: over.id ?? 'a',
    createdAt: over.createdAt ?? 1000,
    underlying: over.underlying ?? 'BTC',
    structureLabel: over.structureLabel ?? 'Long Call',
    spotAtSnapshot: over.spotAtSnapshot ?? 100,
    expiryMs: over.expiryMs ?? 9_999,
    resolutionSec: over.resolutionSec ?? 86_400,
    paths: over.paths ?? [{ kind: 'up', isProfit: true, targetPrice: 130, pnlAtExpiry: 25 }],
  };
}

describe('snapshots-store', () => {
  beforeEach(() => localStorage.clear());

  it('adds and lists newest-first', () => {
    addSnapshot(snap({ id: 'a', createdAt: 1 }));
    addSnapshot(snap({ id: 'b', createdAt: 2 }));
    expect(listSnapshots().map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('filters by underlying', () => {
    addSnapshot(snap({ id: 'a', underlying: 'BTC' }));
    addSnapshot(snap({ id: 'b', underlying: 'ETH' }));
    expect(listSnapshots('ETH').map((s) => s.id)).toEqual(['b']);
  });

  it('removes by id and clears', () => {
    addSnapshot(snap({ id: 'a' }));
    addSnapshot(snap({ id: 'b' }));
    removeSnapshot('a');
    expect(listSnapshots().map((s) => s.id)).toEqual(['b']);
    clearSnapshots();
    expect(listSnapshots()).toEqual([]);
  });

  it('caps at MAX_SNAPSHOTS, dropping the oldest', () => {
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) addSnapshot(snap({ id: `s${i}`, createdAt: i }));
    const all = listSnapshots();
    expect(all).toHaveLength(MAX_SNAPSHOTS);
    expect(all.at(-1)!.id).toBe('s5'); // s0..s4 evicted
  });

  it('returns [] on corrupt storage', () => {
    localStorage.setItem('oggregator.architect.ghostSnapshots', 'not json');
    expect(listSnapshots()).toEqual([]);
  });

  it('rejects schema-invalid rows', () => {
    localStorage.setItem('oggregator.architect.ghostSnapshots', JSON.stringify([{ id: 1 }]));
    expect(listSnapshots()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/web && pnpm vitest run src/features/architect/snapshots-store.test.ts`
Expected: FAIL — `Failed to resolve import './snapshots-store'`.

- [ ] **Step 3: Implement the store**

Create `packages/web/src/features/architect/snapshots-store.ts`:

```ts
import { z } from 'zod';

const STORAGE_KEY = 'oggregator.architect.ghostSnapshots';
export const MAX_SNAPSHOTS = 50;

const GhostPathSnapshotSchema = z.object({
  kind: z.enum(['up', 'down', 'theta']),
  isProfit: z.boolean(),
  targetPrice: z.number(),
  pnlAtExpiry: z.number(),
});

const GhostSnapshotSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  underlying: z.string(),
  structureLabel: z.string(),
  spotAtSnapshot: z.number(),
  expiryMs: z.number(),
  resolutionSec: z.number(),
  paths: z.array(GhostPathSnapshotSchema),
});

export type GhostSnapshot = z.infer<typeof GhostSnapshotSchema>;

const GhostSnapshotArraySchema = z.array(GhostSnapshotSchema);

function read(): GhostSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = GhostSnapshotArraySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(snapshots: GhostSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // localStorage unavailable / quota exceeded — degrade to session-only silently.
  }
}

export function listSnapshots(underlying?: string): GhostSnapshot[] {
  const all = read().sort((a, b) => b.createdAt - a.createdAt);
  return underlying ? all.filter((s) => s.underlying === underlying) : all;
}

export function addSnapshot(snapshot: GhostSnapshot): GhostSnapshot[] {
  const next = [snapshot, ...read()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SNAPSHOTS);
  write(next);
  return next;
}

export function removeSnapshot(id: string): GhostSnapshot[] {
  const next = read().filter((s) => s.id !== id);
  write(next);
  return next;
}

export function clearSnapshots(): void {
  write([]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/web && pnpm vitest run src/features/architect/snapshots-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/architect/snapshots-store.ts packages/web/src/features/architect/snapshots-store.test.ts
git commit -m "feat(architect): add localStorage ghost-projection snapshot store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Render ghost series + legend in `PayoffChartV2.tsx`

lightweight-charts renders canvas, which jsdom can't drive — so this task is verified by typecheck + the manual smoke in Task 6, not a unit test.

**Files:**
- Modify: `packages/web/src/features/architect/PayoffChartV2.tsx`
- Modify: `packages/web/src/features/architect/Architect.module.css`

- [ ] **Step 1: Add imports + module constants**

In `PayoffChartV2.tsx`, add to the existing imports:

```ts
import { fmtUsd } from '@lib/format';
import type { GhostPath, GhostPathKind } from './ghost-paths';
```

Add module-level constants below the imports (after line 18):

```ts
const GHOST_RGB: Record<'profit' | 'loss', string> = {
  profit: '0,233,151',
  loss: '203,56,85',
};
const GHOST_LABEL: Record<GhostPathKind, string> = { up: '↑ up', down: '↓ down', theta: 'θ flat' };
const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;
```

- [ ] **Step 2: Extend the props interface**

Replace the `PayoffChartV2Props` interface with:

```ts
interface PayoffChartV2Props {
  candles: SpotCandle[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  resolutionSec: number;
  loading: boolean;
  available: boolean;
  onSwitchToV1: () => void;
  ghostPaths: GhostPath[];
  showProjections: boolean;
  snapshotMeta: { agoLabel: string } | null;
  projectionKey: string;
}
```

And add the new fields to the destructured params in the function signature:

```ts
}: PayoffChartV2Props) {
```
becomes — add `ghostPaths, showProjections, snapshotMeta, projectionKey,` to the destructure list alongside the existing `onSwitchToV1`.

- [ ] **Step 3: Add the ghost-series ref + effect**

Add a ref next to the other refs (after `lastWindowKeyRef`):

```ts
const ghostSeriesRef = useRef<ISeriesApi<'Candlestick'>[]>([]);
const lastGhostFitKeyRef = useRef<string>('');
```

Add this effect **after** the existing zones effect (it must run after the main-series effect so its `fitContent` wins on mount):

```ts
// Render the projection paths as translucent candlestick series. Each series'
// future data points extend the shared time scale into the projection region.
useEffect(() => {
  const chart = chartApiRef.current;
  if (!chart) return;

  for (const s of ghostSeriesRef.current) chart.removeSeries(s);
  ghostSeriesRef.current = [];

  if (!showProjections || ghostPaths.length === 0) return;

  for (const path of ghostPaths) {
    if (path.candles.length === 0) continue;
    const rgb = path.isProfit ? GHOST_RGB.profit : GHOST_RGB.loss;
    const bodyAlpha = path.kind === 'theta' ? 0.18 : 0.3;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: rgba(rgb, bodyAlpha),
      downColor: rgba(rgb, bodyAlpha),
      borderUpColor: rgba(rgb, 0.55),
      borderDownColor: rgba(rgb, 0.55),
      wickUpColor: rgba(rgb, 0.55),
      wickDownColor: rgba(rgb, 0.55),
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(
      path.candles.map((c) => ({
        time: Math.floor(c.timestamp / 1000) as number, // seconds — match the main series
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })) as never,
    );
    ghostSeriesRef.current.push(series);
  }

  // Bring the projection into view only when the projection identity changes
  // (toggle on, snapshot switch, tenor/resolution change) — not on every tick,
  // so the user's pan/zoom is preserved during rolling updates.
  if (projectionKey !== lastGhostFitKeyRef.current) {
    chart.timeScale().fitContent();
    lastGhostFitKeyRef.current = projectionKey;
  }
}, [ghostPaths, showProjections, projectionKey]);
```

- [ ] **Step 4: Add the legend overlay JSX**

In the returned chart markup, add the legend inside `chartV2Inner`, immediately after the `{loading && (...)}` block:

```tsx
{showProjections && ghostPaths.length > 0 && (
  <div className={styles.ghostLegend}>
    {snapshotMeta && <div className={styles.ghostLegendSnap}>snapshot · {snapshotMeta.agoLabel}</div>}
    {ghostPaths.map((p) => (
      <div key={p.kind} className={styles.ghostLegendRow}>
        <span className={styles.ghostLegendDot} data-profit={p.isProfit} />
        <span className={styles.ghostLegendLabel}>{GHOST_LABEL[p.kind]}</span>
        <span className={styles.ghostLegendPnl} data-profit={p.isProfit}>
          {fmtUsd(p.pnlAtExpiry)}
        </span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Add legend CSS**

Append to `packages/web/src/features/architect/Architect.module.css`:

```css
.ghostLegend {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: rgba(10, 10, 10, 0.72);
  border: 1px solid #1f2937;
  border-radius: 4px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  pointer-events: none;
}
.ghostLegendSnap {
  color: #f0b90b;
  margin-bottom: 2px;
}
.ghostLegendRow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ghostLegendDot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.ghostLegendDot[data-profit='true'] {
  background: #00e997;
}
.ghostLegendDot[data-profit='false'] {
  background: #cb3855;
}
.ghostLegendLabel {
  color: #9aa0a6;
  min-width: 44px;
}
.ghostLegendPnl[data-profit='true'] {
  color: #00e997;
}
.ghostLegendPnl[data-profit='false'] {
  color: #cb3855;
}
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: PASS (no errors). If it reports the new props are missing at the `<PayoffChartV2 ...>` call site, that is wired in Task 5 — proceed; you'll re-run typecheck there.

> NOTE: typecheck will fail on the unsatisfied call site in `ArchitectView.tsx` until Task 5 passes the new props. That is expected; do not "fix" it here. Commit the component changes now and finish wiring in Task 5.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/architect/PayoffChartV2.tsx packages/web/src/features/architect/Architect.module.css
git commit -m "feat(architect): render ghost projection paths + legend in V2 chart

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire projections + snapshots in `ArchitectView.tsx`

**Files:**
- Modify: `packages/web/src/features/architect/ArchitectView.tsx`
- Modify: `packages/web/src/features/architect/Architect.module.css`

- [ ] **Step 1: Add imports + a relative-time helper**

Add to the architect imports in `ArchitectView.tsx`:

```ts
import { computeGhostPaths, buildPathCandles, type GhostPath } from './ghost-paths';
import {
  listSnapshots, addSnapshot, removeSnapshot, type GhostSnapshot,
} from './snapshots-store';
```

Ensure `detectStrategy` is imported from `./payoff` (add it to the existing `./payoff` import if absent). Also confirm `useState`, `useMemo`, `useEffect`, `useCallback` are imported from `react` (add any missing).

Add this module-scope helper near the top of the file (outside the component):

```ts
function formatAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
```

- [ ] **Step 2: Add state, horizon, and computed paths**

Inside the component, near the other `useState`/`useMemo` hooks (after `candleSpec` is defined), add:

```ts
const [showProjections, setShowProjections] = useState(true);
const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
const [snapshots, setSnapshots] = useState<GhostSnapshot[]>(() => listSnapshots(underlying));

// Reset the snapshot list + selection when the underlying changes.
useEffect(() => {
  setSnapshots(listSnapshots(underlying));
  setSelectedSnapshotId(null);
}, [underlying]);

// Anchor the projection at the last real candle's bucket (grid-aligned).
const lastBarMs = visibleSpotCandles?.candles.at(-1)?.timestamp ?? Date.now();

// Nearest-leg expiry → ms at 08:00 UTC (Deribit convention; 'YYYY-MM-DD'
// strings sort lexicographically, so the min string is the earliest date).
const nearestExpiryMs = useMemo(() => {
  const expiries = pricedLegs.map((l) => l.expiry).filter(Boolean);
  if (expiries.length === 0) return Number.NaN;
  const earliest = expiries.reduce((a, b) => (a < b ? a : b));
  return Date.parse(`${earliest}T08:00:00Z`);
}, [pricedLegs]);

const liveGhostPaths = useMemo(
  () => computeGhostPaths(pricedLegs, spotPrice, nearestExpiryMs, lastBarMs, candleSpec.resolutionSec),
  [pricedLegs, spotPrice, nearestExpiryMs, lastBarMs, candleSpec.resolutionSec],
);

const selectedSnapshot = useMemo(
  () => snapshots.find((s) => s.id === selectedSnapshotId) ?? null,
  [snapshots, selectedSnapshotId],
);

// Active set: a selected snapshot (rebuilt at its original anchor) or live.
const activeGhostPaths: GhostPath[] = useMemo(() => {
  if (!selectedSnapshot) return liveGhostPaths;
  return selectedSnapshot.paths.map((p) => ({
    kind: p.kind,
    isProfit: p.isProfit,
    targetPrice: p.targetPrice,
    pnlAtExpiry: p.pnlAtExpiry,
    candles: buildPathCandles(
      selectedSnapshot.spotAtSnapshot,
      p.targetPrice,
      selectedSnapshot.createdAt,
      selectedSnapshot.expiryMs,
      selectedSnapshot.resolutionSec,
    ),
  }));
}, [selectedSnapshot, liveGhostPaths]);

const snapshotMeta = useMemo(
  () => (selectedSnapshot ? { agoLabel: formatAgo(selectedSnapshot.createdAt) } : null),
  [selectedSnapshot],
);

const handleSnapshot = useCallback(() => {
  if (liveGhostPaths.length === 0 || !Number.isFinite(nearestExpiryMs)) return;
  const snap: GhostSnapshot = {
    id: crypto.randomUUID(),
    createdAt: lastBarMs,
    underlying,
    structureLabel: detectStrategy(pricedLegs),
    spotAtSnapshot: spotPrice,
    expiryMs: nearestExpiryMs,
    resolutionSec: candleSpec.resolutionSec,
    paths: liveGhostPaths.map((p) => ({
      kind: p.kind,
      isProfit: p.isProfit,
      targetPrice: p.targetPrice,
      pnlAtExpiry: p.pnlAtExpiry,
    })),
  };
  setSnapshots(addSnapshot(snap));
}, [liveGhostPaths, nearestExpiryMs, lastBarMs, underlying, pricedLegs, spotPrice, candleSpec.resolutionSec]);
```

> If `visibleSpotCandles`, `underlying`, `spotPrice`, or `pricedLegs` are named differently in the file, use the local names already present (they are read elsewhere in the same component — e.g. `useSpotCandles(underlying, …)` and the existing `pickCandleSpec(pricedLegs)` call confirm `underlying` and `pricedLegs`).

- [ ] **Step 3: Add the controls row in the v2 block**

In the `variant === 'v2'` branch, insert this **between** the `SnapshotBanner` block and the `<PayoffChartV2 .../>` element:

```tsx
<div className={styles.projControls}>
  <button
    className={styles.projToggle}
    data-active={showProjections}
    onClick={() => setShowProjections((v) => !v)}
  >
    Projections {showProjections ? 'on' : 'off'}
  </button>
  <button
    className={styles.projSnapBtn}
    onClick={handleSnapshot}
    disabled={liveGhostPaths.length === 0}
  >
    ⎙ Snapshot
  </button>
  {snapshots.length > 0 && (
    <select
      className={styles.projSnapSelect}
      value={selectedSnapshotId ?? ''}
      onChange={(e) => setSelectedSnapshotId(e.target.value || null)}
    >
      <option value="">Live</option>
      {snapshots.map((s) => (
        <option key={s.id} value={s.id}>
          {s.structureLabel} · {formatAgo(s.createdAt)}
        </option>
      ))}
    </select>
  )}
  {selectedSnapshot && (
    <button
      className={styles.projSnapDel}
      onClick={() => {
        setSnapshots(removeSnapshot(selectedSnapshot.id));
        setSelectedSnapshotId(null);
      }}
    >
      ✕
    </button>
  )}
</div>
```

- [ ] **Step 4: Pass the new props to `PayoffChartV2`**

Add these props to the existing `<PayoffChartV2 .../>` element:

```tsx
ghostPaths={activeGhostPaths}
showProjections={showProjections}
snapshotMeta={snapshotMeta}
projectionKey={`${underlying}:${selectedSnapshotId ?? 'live'}:${nearestExpiryMs}:${candleSpec.resolutionSec}`}
```

- [ ] **Step 5: Add controls CSS**

Append to `packages/web/src/features/architect/Architect.module.css`:

```css
.projControls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
}
.projToggle,
.projSnapBtn,
.projSnapDel {
  padding: 3px 8px;
  background: #101010;
  border: 1px solid #1f2937;
  border-radius: 4px;
  color: #9aa0a6;
  cursor: pointer;
}
.projToggle[data-active='true'] {
  color: #00e997;
  border-color: #00e997;
}
.projSnapBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.projSnapSelect {
  padding: 3px 6px;
  background: #101010;
  border: 1px solid #1f2937;
  border-radius: 4px;
  color: #cdd2d6;
  font-family: inherit;
  font-size: 11px;
}
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: PASS. Fix any type mismatches (most likely a missing import or a renamed local for `visibleSpotCandles`/`detectStrategy`).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/architect/ArchitectView.tsx packages/web/src/features/architect/Architect.module.css
git commit -m "feat(architect): wire ghost projections + snapshot capture/overlay into Builder V2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full web typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Run the architect test suite**

Run: `cd packages/web && pnpm vitest run src/features/architect`
Expected: PASS — all prior architect tests plus the new `ghost-paths` (10) and `snapshots-store` (6) tests.

- [ ] **Step 3: Manual smoke in the dev app**

Run: `pnpm dev` (from repo root) and open the Builder, V2 chart.
Verify:
1. Add a **long call** → three ghost paths extend right of "now": ↑ green, ↓ red, θ red flat; legend shows three P&L values.
2. Switch to a **short strangle** → ↑ red, ↓ red, θ **green** (the sell-vol flip).
3. Toggle **Projections off/on** → paths disappear/reappear; on toggle-on the view refits to include the projection.
4. Click **Snapshot**, change a leg, then select the snapshot in the dropdown → the saved paths overlay anchored at their original time; the legend shows "snapshot · Nm ago"; ✕ deletes it and returns to Live.
5. Confirm the paths actually appear in the **future** region (right of the last real candle). If they do not, the time scale didn't auto-extend — apply the fallback in Step 4.

- [ ] **Step 4 (only if Step 3.5 failed): whitespace fallback**

If ghost candles don't appear to the right of "now", add whitespace bars to the main series so the axis spans the projection. In `PayoffChartV2.tsx`, inside the ghost effect before adding series, compute the max ghost time and extend the main series with whitespace:

```ts
const maxGhostSec = Math.max(
  ...ghostPaths.flatMap((p) => p.candles.map((c) => Math.floor(c.timestamp / 1000))),
);
const lastRealSec = Math.floor((candles.at(-1)?.timestamp ?? 0) / 1000);
const stepSec = resolutionSec;
const whitespace: { time: number }[] = [];
for (let t = lastRealSec + stepSec; t <= maxGhostSec; t += stepSec) whitespace.push({ time: t });
// Re-set the main series with its real candles followed by whitespace:
seriesRef.current?.setData([...mainCandleData, ...whitespace] as never);
```

(Reuse the same de-duped/sorted `mainCandleData` the main effect builds — lift it to a ref if needed.) Re-verify Step 3.5, then commit with message `fix(architect): extend V2 axis with whitespace bars for ghost projection`.

- [ ] **Step 5: Comment cleanup**

Invoke the `comment-cleanup` skill against the diff of all changed files; strip any conversation artifacts, keep only the non-obvious "why" comments already present.

- [ ] **Step 6: Final commit (if Steps 4–5 changed anything)**

```bash
git add -A packages/web/src/features/architect
git commit -m "chore(architect): ghost-paths verification fixes + comment cleanup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Model (§3): Task 2 (`computeGhostPaths` band/targets/color) + Task 1 (`buildPathCandles`). ✓
- `ghost-paths.ts` module (§4.1): Tasks 1–2. ✓
- `snapshots-store.ts` (§4.2): Task 3. ✓
- Render: 3 candlestick series + units + axis extension + viewport + legend (§4.3): Task 4 (+ Task 6 Step 4 fallback). ✓
- Wiring + controls (§4.4): Task 5. ✓
- Edge cases (§6): empty legs, missing IV, near-expiry floor, unbounded cap → Task 2 tests; corrupt/quota storage → Task 3 + `write()` catch. ✓
- Testing (§7): Tasks 1–3 unit tests; render verified manually in Task 6 (jsdom can't drive lightweight-charts). ✓
- Non-goals (§8): no PNG export, V3 untouched, nearest-expiry horizon — respected. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; the only conditional ("if Step 3.5 failed") includes real fallback code. ✓

**Type consistency:** `GhostPath`/`GhostPathKind`/`computeGhostPaths`/`buildPathCandles` signatures identical across Tasks 1–5; `GhostSnapshot` shape matches between store (Task 3), capture (Task 5 `handleSnapshot`), and replay (Task 5 `activeGhostPaths`); `PayoffChartV2` props added in Task 4 match those passed in Task 5 Step 4 (`ghostPaths`, `showProjections`, `snapshotMeta`, `projectionKey`). ✓
