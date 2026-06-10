# Builder V3 "Lego Ladder" Chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third, fully custom payoff renderer to the Builder (`features/architect`) — a vertical price ladder where each option leg is a lego block (edge = break-even) over a net green/red P&L wash, with on-chart construction and game-like hovers.

**Architecture:** A new `PayoffChartV3.tsx` (SVG/DOM + CSS, no new deps) consumes the exact props `ArchitectView` already computes for V1/V2 plus three callbacks. All payoff math is reused from `payoff.ts` (no changes there). A new pure module `ladder-geometry.ts` holds the price↔pixel scale, block geometry, zone building (port of V2's `buildZones`), and lane packing — fully unit-tested. `ArchitectView` gets a minimal, additive `variant: 'v3'` branch mirroring how V2 was added. V1, V2, the strategy store, and the WS/feed layer are untouched.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Vitest 4 + jsdom, SVG + CSS Modules. Reuses `@lib/format` and `styles/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-06-09-builder-v3-lego-ladder-chart-design.md`

**Branch:** `feat/builder-v3-lego-ladder` (already created; the spec is committed there).

**All commands run from `packages/web/`** unless noted. Single test file: `pnpm exec vitest run <path>`. Full web suite: `pnpm test:run`. Typecheck: `pnpm typecheck`. Lint: `pnpm lint`. Build: `pnpm build`.

---

## Reference: verbatim facts this plan depends on

These are exact, already-verified from the codebase — do not re-derive:

- **`payoff.ts` exports** (import these; do NOT reimplement): `pnlAtPrice(legs: Leg[], underlyingPrice: number): number`, `computePayoff(legs, spotPrice, numPoints?=200): PayoffPoint[]`, `computeMetrics(legs, spotPrice): StrategyMetrics`, and the types `Leg`, `PayoffPoint`, `StrategyMetrics`. (`legPnlAtExpiry`, `findBreakevens`, `computeRangeHalf` are NOT exported.)
- **`Leg`** = `{ id; type: 'call'|'put'; direction: 'buy'|'sell'; strike; expiry; quantity; entryPrice /* USD/contract */; venue; delta|null; gamma|null; theta|null; vega|null; iv|null }`. `entryPrice` and `strike` live in the **same USD price space** — do NOT multiply by contractSize/inverse for geometry.
- **`PayoffPoint`** = `{ underlyingPrice: number; pnl: number }`.
- **`StrategyMetrics`** = `{ maxProfit; maxLoss; breakevens: number[]; netDebit; netDelta; netGamma; netTheta; netVega; greeksMissingLegs }` (nullable numbers where noted).
- **V2's `buildZones`** logic (we port it): if no legs → `[]`; if no breakevens → one zone `(-∞, +∞)` with `profit = pnlAtPrice(legs, spotPrice) >= 0`; else boundaries `[-Infinity, ...sortedBEs, Infinity]`, each band's `profit = pnlAtPrice(legs, probe) >= 0` where probe is the midpoint (both finite), `high*0.5` (only high finite), `low*1.5` (only low finite), or `spotPrice` (both infinite). `PriceZone = { low; high; profit }`.
- **`ArchitectView` in-scope identifiers** (for wiring): `variant`/`setVariant` (line 190), `payoffPoints`, `metrics`, `spotPrice`, `availableStrikes`, `pricedLegs`, `underlying`, `chain`, `pricingVenues`, `builderExpiry`, `addLeg`, `removeLeg`, `handleLegStrikeDrag`, and `repriceLeg` (imported from `./reprice`). `repriceLeg(chain, pricingVenues, { type, direction, strike, expiry, quantity }, { exactStrike })` returns `Omit<Leg,'id'>`. `addLeg(legWithoutId, underlying)`.
- **Format helpers** (`@lib/format`): `fmtUsd(v)` (null/0 → `'–'`, decimals scale by magnitude), `fmtIv(v)` (fraction×100 → `'NN.N%'`), `fmtPct(v, decimals=2)`.
- **Tokens** (`styles/tokens.css`): `--color-profit #00e997`, `--color-loss #cb3855`, `--accent-primary #50d2c1`, `--color-info #88b6ff` (use as **call** hue), `--color-iv #ae9ff9` (use as **put** hue), `--color-warning #fef9a0` (break-even line), `--transition-fast 120ms ease`, `--transition-base 200ms ease-out`, `--bg-panel #111111`, `--text-primary/secondary/tertiary`, `--font-mono`.
- **Test constraints**: `vite.config.ts` test block is `{ environment:'jsdom', globals:false, clearMocks:true, restoreMocks:true }`. So: `/** @vitest-environment jsdom */` at top of `.tsx` tests, import `{ describe,it,expect,vi,afterEach,beforeEach }` from `'vitest'`, NO jest-dom (plain matchers: `toBe`, `toBeNull`, `toBeTruthy`, check `.textContent`/`querySelector`), call `cleanup()` in `afterEach`. **jsdom has no `ResizeObserver` and no canvas `getContext`** — the V3 component must be SVG-only and must default to a non-zero size so it renders without a live ResizeObserver.
- **Path aliases**: `@`, `@components`, `@hooks`, `@features`, `@lib`, `@shared`, `@stores`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/architect/ladder-geometry.ts` | **New.** Pure: `derivePriceDomain`, `makePriceScale`, `legToBlock`, `buildLadderZones`, `packLanes`, `netPnlReadout`, `shouldUseKFormat`/`pickDecimals`/`formatPriceTick`. No React/DOM. Composes `payoff.ts`. |
| `src/features/architect/ladder-geometry.test.ts` | **New.** Unit tests for every helper above. |
| `src/features/architect/PayoffChartV3.module.css` | **New.** Block/zone/line/crosshair/card/picker styles, hover transitions, keyframes, reduced-motion guard. |
| `src/features/architect/PayoffChartV3.tsx` | **New.** The SVG renderer + interactions. Props-only; emits via callbacks. |
| `src/features/architect/PayoffChartV3.test.tsx` | **New.** Smoke tests (SVG output, crosshair, picker/remove callbacks). |
| `src/features/architect/ArchitectView.tsx` | **Modify (additive).** Widen `variant` union, add V3 toggle button + title + render branch, add `handleAddLegAtStrike`/`handleRemoveLeg`. |

---

# PHASE 1 — Geometry + render (read-only over store legs)

## Task 1: Price scale + price domain (`ladder-geometry.ts`)

**Files:**
- Create: `src/features/architect/ladder-geometry.ts`
- Test: `src/features/architect/ladder-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/architect/ladder-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Leg } from './payoff';
import {
  derivePriceDomain,
  makePriceScale,
} from './ladder-geometry';

function makeLeg(over: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1',
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry: '2026-12-25',
    quantity: 1,
    entryPrice: 3,
    venue: 'deribit',
    delta: 0.5,
    gamma: 0.01,
    theta: -0.1,
    vega: 0.2,
    iv: 0.5,
    ...over,
  };
}

describe('makePriceScale', () => {
  it('maps priceMax to padTop and priceMin to padTop+plotH (price runs up)', () => {
    const s = makePriceScale(90, 110, 20, 200);
    expect(s.y(110)).toBeCloseTo(20);
    expect(s.y(90)).toBeCloseTo(220);
    expect(s.y(100)).toBeCloseTo(120);
  });

  it('priceAt is the inverse of y', () => {
    const s = makePriceScale(90, 110, 20, 200);
    expect(s.priceAt(20)).toBeCloseTo(110);
    expect(s.priceAt(220)).toBeCloseTo(90);
    expect(s.priceAt(s.y(103.7))).toBeCloseTo(103.7);
  });

  it('does not divide by zero when domain is degenerate', () => {
    const s = makePriceScale(100, 100, 20, 200);
    expect(Number.isFinite(s.y(100))).toBe(true);
  });
});

describe('derivePriceDomain', () => {
  it('uses the payoff points range when present', () => {
    const d = derivePriceDomain(
      [
        { underlyingPrice: 80, pnl: -3 },
        { underlyingPrice: 130, pnl: 27 },
      ],
      100,
    );
    expect(d.priceMin).toBe(80);
    expect(d.priceMax).toBe(130);
  });

  it('falls back to a spot-relative window when there are no points', () => {
    const d = derivePriceDomain([], 100);
    expect(d.priceMin).toBeCloseTo(90);
    expect(d.priceMax).toBeCloseTo(110);
  });

  it('never returns a negative priceMin', () => {
    const d = derivePriceDomain([], 0.5);
    expect(d.priceMin).toBeGreaterThanOrEqual(0);
  });
});

// makeLeg is reused by later tasks in this file.
export {};
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./ladder-geometry"` / `makePriceScale is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/features/architect/ladder-geometry.ts`:

```ts
import { pnlAtPrice, type Leg, type PayoffPoint } from './payoff';

export interface PriceScale {
  priceMin: number;
  priceMax: number;
  /** price → pixel y (price runs UP: high price → small y) */
  y: (price: number) => number;
  /** pixel y → price (inverse of y) */
  priceAt: (yPx: number) => number;
}

/** Build a linear price→pixel scale. Guards a zero-width domain (mirrors V1's `rangeY || 1`). */
export function makePriceScale(
  priceMin: number,
  priceMax: number,
  padTop: number,
  plotH: number,
): PriceScale {
  const span = priceMax - priceMin || 1;
  return {
    priceMin,
    priceMax,
    y: (price: number) => padTop + ((priceMax - price) / span) * plotH,
    priceAt: (yPx: number) => priceMax - ((yPx - padTop) / plotH) * span,
  };
}

/**
 * Price-axis domain for the ladder. Reuses the existing payoff-points range
 * (computePayoff already widens it to keep every break-even inside), with a
 * spot-relative fallback for the empty-legs case.
 */
export function derivePriceDomain(
  points: PayoffPoint[],
  spotPrice: number,
): { priceMin: number; priceMax: number } {
  if (points.length > 0) {
    return {
      priceMin: points[0]!.underlyingPrice,
      priceMax: points[points.length - 1]!.underlyingPrice,
    };
  }
  const half = Math.max(spotPrice * 0.1, 1);
  return { priceMin: Math.max(0, spotPrice - half), priceMax: spotPrice + half };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/architect/ladder-geometry.ts src/features/architect/ladder-geometry.test.ts
git commit -m "feat(architect): V3 ladder price scale + price domain helpers"
```

---

## Task 2: Block geometry (`legToBlock`)

**Files:**
- Modify: `src/features/architect/ladder-geometry.ts`
- Test: `src/features/architect/ladder-geometry.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `ladder-geometry.test.ts` (add `legToBlock` to the existing import from `./ladder-geometry`):

```ts
import { legToBlock } from './ladder-geometry';

describe('legToBlock', () => {
  it('long call: block spans strike → strike+premium, far edge above', () => {
    const b = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 100, entryPrice: 3, quantity: 1 }));
    expect(b.legBreakeven).toBeCloseTo(103);
    expect(b.spanLowPrice).toBeCloseTo(100);
    expect(b.spanHighPrice).toBeCloseTo(103);
    expect(b.label).toBe('+1 C 100');
  });

  it('long put: block spans strike-premium → strike, far edge below', () => {
    const b = legToBlock(makeLeg({ type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }));
    expect(b.legBreakeven).toBeCloseTo(97);
    expect(b.spanLowPrice).toBeCloseTo(97);
    expect(b.spanHighPrice).toBeCloseTo(100);
  });

  it('short call: same span as long call but sell direction + minus label', () => {
    const b = legToBlock(makeLeg({ type: 'call', direction: 'sell', strike: 100, entryPrice: 3, quantity: 2 }));
    expect(b.spanLowPrice).toBeCloseTo(100);
    expect(b.spanHighPrice).toBeCloseTo(103);
    expect(b.direction).toBe('sell');
    expect(b.label).toBe('−2 C 100');
  });

  it('sub-$1 underlying keeps full precision (no rounding to strike)', () => {
    const b = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 0.5, entryPrice: 0.02 }));
    expect(b.legBreakeven).toBeCloseTo(0.52);
    expect(b.spanHighPrice).toBeCloseTo(0.52);
    expect(b.spanLowPrice).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts -t legToBlock`
Expected: FAIL — `legToBlock is not a function`.

- [ ] **Step 3: Implement**

Append to `ladder-geometry.ts`:

```ts
export interface LadderBlock {
  legId: string;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  quantity: number;
  strike: number;
  /** This leg's own break-even: strike ± premium. */
  legBreakeven: number;
  /** Lower price edge of the block (= min(strike, legBreakeven)). */
  spanLowPrice: number;
  /** Upper price edge of the block (= max(strike, legBreakeven)). */
  spanHighPrice: number;
  /** Compact label, e.g. "+1 C 100" / "−2 P 95". */
  label: string;
}

/** Map a priced leg to its block geometry on the price axis. */
export function legToBlock(leg: Leg): LadderBlock {
  const premium = Math.abs(leg.entryPrice);
  const legBreakeven = leg.type === 'call' ? leg.strike + premium : leg.strike - premium;
  const spanLowPrice = Math.min(leg.strike, legBreakeven);
  const spanHighPrice = Math.max(leg.strike, legBreakeven);
  const sign = leg.direction === 'buy' ? '+' : '−'; // U+2212 minus, matches app typography
  const typeChar = leg.type === 'call' ? 'C' : 'P';
  const label = `${sign}${leg.quantity} ${typeChar} ${leg.strike}`;
  return {
    legId: leg.id,
    type: leg.type,
    direction: leg.direction,
    quantity: leg.quantity,
    strike: leg.strike,
    legBreakeven,
    spanLowPrice,
    spanHighPrice,
    label,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts -t legToBlock`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/architect/ladder-geometry.ts src/features/architect/ladder-geometry.test.ts
git commit -m "feat(architect): V3 legToBlock geometry (4 primitives + sub-\$1)"
```

---

## Task 3: Net P&L wash zones (`buildLadderZones`)

**Files:**
- Modify: `src/features/architect/ladder-geometry.ts`
- Test: `src/features/architect/ladder-geometry.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `ladder-geometry.test.ts` (add `buildLadderZones` to the import):

```ts
import { buildLadderZones } from './ladder-geometry';

describe('buildLadderZones', () => {
  it('returns [] for no legs', () => {
    expect(buildLadderZones([], [], 100)).toEqual([]);
  });

  it('long call → loss below break-even, profit above', () => {
    const legs = [makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 })];
    const zones = buildLadderZones(legs, [103], 100);
    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({ lowPrice: -Infinity, highPrice: 103, profit: false });
    expect(zones[1]).toMatchObject({ lowPrice: 103, highPrice: Infinity, profit: true });
  });

  it('long straddle → red band between break-evens, green outside (the hero case)', () => {
    const legs = [
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }),
    ];
    const zones = buildLadderZones(legs, [94, 106], 100);
    expect(zones.map((z) => z.profit)).toEqual([true, false, true]);
    expect(zones[1]).toMatchObject({ lowPrice: 94, highPrice: 106, profit: false });
  });

  it('no break-evens → single zone signed by spot P&L', () => {
    const legs = [makeLeg({ id: 'leg-1', type: 'call', direction: 'sell', strike: 200, entryPrice: 5 })];
    const zones = buildLadderZones(legs, [], 100);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ lowPrice: -Infinity, highPrice: Infinity, profit: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts -t buildLadderZones`
Expected: FAIL — `buildLadderZones is not a function`.

- [ ] **Step 3: Implement** (direct port of V2's `buildZones`, on price→y naming)

Append to `ladder-geometry.ts`:

```ts
export interface LadderZone {
  /** May be -Infinity for the unbounded lower band. */
  lowPrice: number;
  /** May be +Infinity for the unbounded upper band. */
  highPrice: number;
  profit: boolean;
}

/**
 * Net P&L wash bands between break-evens. Port of PayoffChartV2's buildZones:
 * sign each band by probing pnlAtPrice at a representative price.
 */
export function buildLadderZones(
  legs: Leg[],
  breakevens: number[],
  spotPrice: number,
): LadderZone[] {
  if (legs.length === 0) return [];
  if (breakevens.length === 0) {
    return [{ lowPrice: -Infinity, highPrice: Infinity, profit: pnlAtPrice(legs, spotPrice) >= 0 }];
  }
  const sorted = [...breakevens].sort((a, b) => a - b);
  const boundaries = [-Infinity, ...sorted, Infinity];
  const zones: LadderZone[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const low = boundaries[i]!;
    const high = boundaries[i + 1]!;
    let probe: number;
    if (Number.isFinite(low) && Number.isFinite(high)) probe = (low + high) / 2;
    else if (Number.isFinite(high)) probe = high * 0.5;
    else if (Number.isFinite(low)) probe = low * 1.5;
    else probe = spotPrice;
    zones.push({ lowPrice: low, highPrice: high, profit: pnlAtPrice(legs, probe) >= 0 });
  }
  return zones;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts -t buildLadderZones`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/architect/ladder-geometry.ts src/features/architect/ladder-geometry.test.ts
git commit -m "feat(architect): V3 net P&L wash zones (port of buildZones)"
```

---

## Task 4: Lane packing + readout + tick format

**Files:**
- Modify: `src/features/architect/ladder-geometry.ts`
- Test: `src/features/architect/ladder-geometry.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `ladder-geometry.test.ts` (add the new symbols to the import):

```ts
import { packLanes, netPnlReadout, formatPriceTick } from './ladder-geometry';

describe('packLanes', () => {
  it('straddle: touching call/put blocks share one lane (they tile)', () => {
    const blocks = [
      legToBlock(makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 })), // [100,103]
      legToBlock(makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 })), // [97,100]
    ];
    const lanes = packLanes(blocks);
    expect(lanes.get('leg-1')).toBe(0);
    expect(lanes.get('leg-2')).toBe(0);
  });

  it('overlapping same-strike blocks split into separate lanes', () => {
    const blocks = [
      legToBlock(makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 5 })), // [100,105]
      legToBlock(makeLeg({ id: 'leg-2', type: 'call', direction: 'sell', strike: 100, entryPrice: 5 })), // [100,105]
    ];
    const lanes = packLanes(blocks);
    const used = new Set([lanes.get('leg-1'), lanes.get('leg-2')]);
    expect(used.size).toBe(2);
  });
});

describe('netPnlReadout', () => {
  it('long call: ~0 at break-even, positive above', () => {
    const legs = [makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 })];
    expect(netPnlReadout(legs, 103, -3).pnl).toBeCloseTo(0);
    expect(netPnlReadout(legs, 110, -3).pnl).toBeGreaterThan(0);
  });

  it('pct is null when there is no cost basis', () => {
    const legs = [makeLeg({ id: 'leg-1' })];
    expect(netPnlReadout(legs, 100, 0).pct).toBeNull();
  });
});

describe('formatPriceTick', () => {
  it('uses k-format above 1000 and decimals scaled to span', () => {
    expect(formatPriceTick(64000, 4000)).toBe('64.0k');
    expect(formatPriceTick(100, 40)).toBe('100');
    expect(formatPriceTick(0.52, 0.3)).toBe('0.52');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts -t "packLanes|netPnlReadout|formatPriceTick"`
Expected: FAIL — those exports are not functions.

- [ ] **Step 3: Implement**

Append to `ladder-geometry.ts`:

```ts
/**
 * Greedy interval packing by price-span overlap. Blocks whose spans don't
 * overlap reuse a lane (touching edges, e.g. a straddle's two legs, count as
 * non-overlapping so they stay centered and tile). Overlapping blocks get
 * separate lanes for horizontal offset.
 */
export function packLanes(blocks: LadderBlock[]): Map<string, number> {
  const laneHighs: number[] = []; // laneHighs[i] = highest spanHighPrice placed in lane i
  const assignment = new Map<string, number>();
  const sorted = [...blocks].sort((a, b) => a.spanLowPrice - b.spanLowPrice);
  for (const block of sorted) {
    let placed = false;
    for (let i = 0; i < laneHighs.length; i++) {
      if (laneHighs[i]! <= block.spanLowPrice) {
        laneHighs[i] = block.spanHighPrice;
        assignment.set(block.legId, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      laneHighs.push(block.spanHighPrice);
      assignment.set(block.legId, laneHighs.length - 1);
    }
  }
  return assignment;
}

/** Net position P&L at a price, plus % of cost basis (|netDebit|). */
export function netPnlReadout(
  legs: Leg[],
  price: number,
  netDebit: number,
): { pnl: number; pct: number | null } {
  const pnl = pnlAtPrice(legs, price);
  const cost = Math.abs(netDebit);
  return { pnl, pct: cost > 0 ? (pnl / cost) * 100 : null };
}

/** True when a price is large enough to render with a 'k' suffix. Ported from V1. */
export function shouldUseKFormat(maxPrice: number): boolean {
  return maxPrice >= 1000;
}

/** Decimal places for a price tick, scaled by axis span. Ported from V1. */
export function pickDecimals(span: number, useK: boolean): number {
  const effective = useK ? span / 1000 : span;
  if (effective >= 10) return 0;
  if (effective >= 2) return 1;
  if (effective >= 0.5) return 2;
  if (effective >= 0.05) return 3;
  return 4;
}

/** Format a price-axis tick label, sub-$1 safe and k-suffixed for large values. */
export function formatPriceTick(price: number, span: number): string {
  const useK = shouldUseKFormat(price);
  const dp = pickDecimals(span, useK);
  return useK ? `${(price / 1000).toFixed(dp)}k` : price.toFixed(dp);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/ladder-geometry.test.ts`
Expected: PASS (whole file green — ~20 tests).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm typecheck
pnpm exec biome lint src/features/architect/ladder-geometry.ts src/features/architect/ladder-geometry.test.ts
git add src/features/architect/ladder-geometry.ts src/features/architect/ladder-geometry.test.ts
git commit -m "feat(architect): V3 lane packing, net readout, price tick format"
```
Expected: typecheck clean, lint clean.

---

## Task 5: Styles (`PayoffChartV3.module.css`)

**Files:**
- Create: `src/features/architect/PayoffChartV3.module.css`

No test (pure CSS). This file is consumed by Task 6.

- [ ] **Step 1: Create the stylesheet**

Create `src/features/architect/PayoffChartV3.module.css`:

```css
.container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  font-family: var(--font-mono);
  --lego-call: var(--color-info);
  --lego-put: var(--color-iv);
  --lego-profit: var(--color-profit);
  --lego-loss: var(--color-loss);
  --lego-be: var(--color-warning);
}

.svg {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
  touch-action: none;
}

/* Blocks: a group per leg. Lift + glow on hover/active. */
.block {
  cursor: grab;
  transition:
    transform var(--transition-fast),
    filter var(--transition-fast),
    opacity var(--transition-fast);
  transform-box: fill-box;
  transform-origin: center;
}
.block:hover,
.block[data-active='true'] {
  transform: translateY(-2px) scale(1.03);
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
}
.block[data-dragging='true'] {
  cursor: grabbing;
}
.blockEnter {
  animation: legoDropIn var(--transition-base);
}
.blockExit {
  animation: legoRemove var(--transition-fast) forwards;
}

/* Hover detail card (DOM overlay positioned over the SVG). */
.card {
  position: absolute;
  z-index: 4;
  min-width: 130px;
  padding: 8px 10px;
  background: var(--bg-panel);
  border: 1px solid var(--bg-active);
  border-radius: 8px;
  pointer-events: none;
  animation: legoRise var(--transition-fast);
  font-size: var(--text-2xs);
  color: var(--text-secondary);
}
.cardTitle {
  color: var(--text-primary);
  margin-bottom: 4px;
}

/* Price-scrub crosshair chip. */
.crosshairChip {
  position: absolute;
  z-index: 3;
  transform: translateY(-50%);
  padding: 2px 6px;
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
  border-radius: 5px;
  color: var(--accent-primary);
  pointer-events: none;
  font-size: var(--text-2xs);
  white-space: nowrap;
}

/* Click-rung placement picker (DOM overlay). */
.picker {
  position: absolute;
  z-index: 5;
  display: flex;
  gap: 4px;
  padding: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--bg-active);
  border-radius: 8px;
  animation: legoRise var(--transition-fast);
}
.pickerBtn {
  padding: 3px 6px;
  background: var(--bg-input);
  border: 1px solid var(--bg-active);
  border-radius: 5px;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-2xs);
  cursor: pointer;
}
.pickerBtn:hover {
  color: var(--text-primary);
  border-color: var(--accent-primary);
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  pointer-events: none;
}

@keyframes legoDropIn {
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes legoRemove {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.8); }
}
@keyframes legoRise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .block,
  .blockEnter,
  .blockExit,
  .card,
  .picker {
    animation: none;
    transition: none;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/architect/PayoffChartV3.module.css
git commit -m "feat(architect): V3 lego ladder stylesheet (blocks, card, crosshair, picker)"
```

---

## Task 6: Static render — zones, lines, blocks (`PayoffChartV3.tsx`)

**Files:**
- Create: `src/features/architect/PayoffChartV3.tsx`
- Test: `src/features/architect/PayoffChartV3.test.tsx`

This task renders the ladder read-only: net wash, break-even/spot lines, and lego blocks (4 primitives, hue + long/short treatment, lane-packed). No interaction yet.

- [ ] **Step 1: Write the failing smoke test**

Create `src/features/architect/PayoffChartV3.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Leg } from './payoff';
import PayoffChartV3 from './PayoffChartV3';

afterEach(() => cleanup());

function makeLeg(over: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1', type: 'call', direction: 'buy', strike: 100, expiry: '2026-12-25',
    quantity: 1, entryPrice: 3, venue: 'deribit',
    delta: 0.5, gamma: 0.01, theta: -0.1, vega: 0.2, iv: 0.5, ...over,
  };
}

function renderChart(legs: Leg[]) {
  const points = legs.length
    ? [
        { underlyingPrice: 70, pnl: -3 },
        { underlyingPrice: 130, pnl: 27 },
      ]
    : [];
  return render(
    <PayoffChartV3
      points={points}
      breakevens={legs.length ? [103] : []}
      spotPrice={100}
      legs={legs}
      maxProfit={null}
      maxLoss={-3}
      netDebit={-3}
      strikes={[90, 95, 100, 105, 110]}
    />,
  );
}

describe('PayoffChartV3 (render)', () => {
  it('renders one block group per leg', () => {
    const { container } = renderChart([
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100 }),
    ]);
    const blocks = container.querySelectorAll('[data-leg-id]');
    expect(blocks.length).toBe(2);
  });

  it('labels a long call block "+1 C 100"', () => {
    const { container } = renderChart([makeLeg({ id: 'leg-1', strike: 100 })]);
    expect(container.textContent).toContain('+1 C 100');
  });

  it('shows the empty hint when there are no legs', () => {
    const { container } = renderChart([]);
    expect(container.textContent).toContain('click a rung');
  });

  it('renders an SVG (not a canvas) so jsdom can introspect it', () => {
    const { container } = renderChart([makeLeg()]);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx`
Expected: FAIL — cannot resolve `./PayoffChartV3`.

- [ ] **Step 3: Implement the component (static render)**

Create `src/features/architect/PayoffChartV3.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';

import { fmtUsd } from '@lib/format';
import type { Leg, PayoffPoint } from './payoff';
import {
  buildLadderZones,
  derivePriceDomain,
  formatPriceTick,
  legToBlock,
  makePriceScale,
  packLanes,
  type LadderBlock,
} from './ladder-geometry';
import s from './PayoffChartV3.module.css';

interface PayoffChartV3Props {
  points: PayoffPoint[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  maxProfit: number | null;
  maxLoss: number | null;
  netDebit: number;
  strikes?: number[];
  onLegStrikeDrag?: (legId: string, newStrike: number) => void;
  onAddLegAtStrike?: (
    strike: number,
    type: 'call' | 'put',
    direction: 'buy' | 'sell',
    quantity: number,
  ) => void;
  onRemoveLeg?: (legId: string) => void;
}

const PAD = { top: 18, right: 64, bottom: 18, left: 48 };
const BLOCK_W = 64;
const LANE_STEP = BLOCK_W + 8;
const MIN_BLOCK_PX = 6;

/** Map a price to a clamped pixel y inside the plot; ±Infinity → plot edges. */
function clampY(price: number, yOf: (p: number) => number, plotTop: number, plotBottom: number): number {
  if (price === Infinity) return plotTop;
  if (price === -Infinity) return plotBottom;
  return Math.max(plotTop, Math.min(plotBottom, yOf(price)));
}

export default function PayoffChartV3({
  points,
  breakevens,
  spotPrice,
  legs,
  netDebit,
  strikes = [],
  onLegStrikeDrag: _onLegStrikeDrag,
  onAddLegAtStrike: _onAddLegAtStrike,
  onRemoveLeg: _onRemoveLeg,
}: PayoffChartV3Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Default to a non-zero size so the chart renders before (and without) a live
  // ResizeObserver — jsdom has no ResizeObserver, and the first paint has no box.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 400 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr && cr.width > 0 && cr.height > 0) setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const plotTop = PAD.top;
  const plotBottom = h - PAD.bottom;
  const plotH = Math.max(1, plotBottom - plotTop);
  const plotLeft = PAD.left;
  const plotRight = w - PAD.right;
  const plotW = Math.max(1, plotRight - plotLeft);
  const centerX = plotLeft + plotW / 2;

  const domain = useMemo(() => derivePriceDomain(points, spotPrice), [points, spotPrice]);
  const scale = useMemo(
    () => makePriceScale(domain.priceMin, domain.priceMax, plotTop, plotH),
    [domain, plotTop, plotH],
  );
  const span = domain.priceMax - domain.priceMin || 1;

  const blocks = useMemo(() => legs.map(legToBlock), [legs]);
  const lanes = useMemo(() => packLanes(blocks), [blocks]);
  const laneCount = useMemo(
    () => (lanes.size ? Math.max(...lanes.values()) + 1 : 1),
    [lanes],
  );
  const zones = useMemo(
    () => buildLadderZones(legs, breakevens, spotPrice),
    [legs, breakevens, spotPrice],
  );

  const blockX = (legId: string): number => {
    const lane = lanes.get(legId) ?? 0;
    const groupW = (laneCount - 1) * LANE_STEP;
    return centerX - groupW / 2 - BLOCK_W / 2 + lane * LANE_STEP;
  };

  const spotY = clampY(spotPrice, scale.y, plotTop, plotBottom);

  return (
    <div className={s.container} ref={containerRef}>
      <svg className={s.svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <pattern id="lego-hatch-call" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--lego-call)" strokeWidth="1.2" opacity="0.6" />
          </pattern>
          <pattern id="lego-hatch-put" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--lego-put)" strokeWidth="1.2" opacity="0.6" />
          </pattern>
        </defs>

        {/* Net P&L wash */}
        {zones.map((z, i) => {
          const yHigh = clampY(z.highPrice, scale.y, plotTop, plotBottom);
          const yLow = clampY(z.lowPrice, scale.y, plotTop, plotBottom);
          return (
            <rect
              key={`zone-${i}`}
              x={plotLeft}
              y={yHigh}
              width={plotW}
              height={Math.max(0, yLow - yHigh)}
              fill={z.profit ? 'var(--lego-profit)' : 'var(--lego-loss)'}
              opacity={0.09}
            />
          );
        })}

        {/* Break-even lines */}
        {breakevens.map((be, i) => {
          const y = scale.y(be);
          if (y < plotTop || y > plotBottom) return null;
          return (
            <g key={`be-${i}`}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--lego-be)" strokeWidth="1.3" strokeDasharray="5 3" />
              <text x={plotLeft - 4} y={y + 3} fill="var(--lego-be)" fontSize="9" textAnchor="end">
                {formatPriceTick(be, span)}
              </text>
            </g>
          );
        })}

        {/* Spot line */}
        <line x1={plotLeft} y1={spotY} x2={plotRight} y2={spotY} stroke="var(--accent-primary)" strokeWidth="1.5" />
        <text x={plotRight + 4} y={spotY + 3} fill="var(--accent-primary)" fontSize="9">
          {formatPriceTick(spotPrice, span)}
        </text>

        {/* Blocks */}
        {blocks.map((b) => (
          <Block
            key={b.legId}
            block={b}
            x={blockX(b.legId)}
            yOf={scale.y}
            plotTop={plotTop}
            plotBottom={plotBottom}
          />
        ))}
      </svg>

      {legs.length === 0 && <div className={s.empty}>Spot ladder — click a rung to add a leg</div>}
    </div>
  );
}

interface BlockProps {
  block: LadderBlock;
  x: number;
  yOf: (price: number) => number;
  plotTop: number;
  plotBottom: number;
}

function Block({ block, x, yOf, plotTop, plotBottom }: BlockProps) {
  const isCall = block.type === 'call';
  const isLong = block.direction === 'buy';
  const hue = isCall ? 'var(--lego-call)' : 'var(--lego-put)';
  const hatch = isCall ? 'url(#lego-hatch-call)' : 'url(#lego-hatch-put)';

  const yTop = Math.max(plotTop, Math.min(plotBottom, yOf(block.spanHighPrice)));
  const yBottom = Math.max(plotTop, Math.min(plotBottom, yOf(block.spanLowPrice)));
  const height = Math.max(MIN_BLOCK_PX, yBottom - yTop);
  const beEdgeY = isCall ? yTop : yTop + height; // call B/E is the top edge, put B/E the bottom
  const arrowApexY = isCall
    ? (isLong ? yTop - 12 : yTop + 14)
    : (isLong ? yTop + height + 12 : yTop + height - 14);
  const arrowBaseY = isCall ? (isLong ? yTop : yTop + 14) : (isLong ? yTop + height : yTop + height - 14);
  const cx = x + BLOCK_W / 2;

  return (
    <g className={s.block} data-leg-id={block.legId} data-active="false">
      <rect
        x={x}
        y={yTop}
        width={BLOCK_W}
        height={height}
        rx={6}
        fill={isLong ? hue : hatch}
        fillOpacity={isLong ? 0.32 : 1}
        stroke={hue}
        strokeWidth={1.5}
        strokeDasharray={isLong ? undefined : '4 3'}
      />
      {/* Short: red cap bar on the break-even edge */}
      {!isLong && (
        <line x1={x} y1={beEdgeY} x2={x + BLOCK_W} y2={beEdgeY} stroke="var(--lego-loss)" strokeWidth="3.5" />
      )}
      {/* Direction arrow */}
      <polygon points={`${cx},${arrowApexY} ${cx - 8},${arrowBaseY} ${cx + 8},${arrowBaseY}`} fill={hue} />
      {/* Label */}
      <text x={cx} y={yTop + height / 2 + 3} fill="var(--text-primary)" fontSize="10" textAnchor="middle">
        {block.label}
      </text>
    </g>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm typecheck
pnpm exec biome lint src/features/architect/PayoffChartV3.tsx src/features/architect/PayoffChartV3.test.tsx
git add src/features/architect/PayoffChartV3.tsx src/features/architect/PayoffChartV3.test.tsx
git commit -m "feat(architect): V3 static lego-ladder render (zones, lines, blocks)"
```
Expected: typecheck clean, lint clean (the `_`-prefixed unused callbacks are intentional placeholders for Phase 2/3 — if biome flags them, that is expected and resolved when they are used).

---

## Task 7: Crosshair + hover detail card

**Files:**
- Modify: `src/features/architect/PayoffChartV3.tsx`
- Test: `src/features/architect/PayoffChartV3.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `PayoffChartV3.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';

describe('PayoffChartV3 (crosshair)', () => {
  it('shows a net P&L readout chip when the ladder is hovered', () => {
    const { container } = renderChart([makeLeg({ id: 'leg-1', strike: 100 })]);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 100 });
    const chip = container.querySelector('[data-testid="crosshair-chip"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('@');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx -t crosshair`
Expected: FAIL — no `crosshair-chip` element.

- [ ] **Step 3: Implement crosshair + card**

In `PayoffChartV3.tsx`:

(a) Add to imports:

```tsx
import { fmtIv, fmtPct } from '@lib/format';
import { netPnlReadout } from './ladder-geometry';
```

(b) Add hover state near the `size` state:

```tsx
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverLegId, setHoverLegId] = useState<string | null>(null);
```

(c) Add an SVG pointer handler. Put this just above the `return`:

```tsx
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    setHoverY(y >= plotTop && y <= plotBottom ? y : null);
  };
  const handlePointerLeave = () => {
    setHoverY(null);
    setHoverLegId(null);
  };

  const hoverPrice = hoverY != null ? scale.priceAt(hoverY) : null;
  const hoverReadout = hoverPrice != null ? netPnlReadout(legs, hoverPrice, netDebit) : null;
  const hoveredLeg = hoverLegId != null ? legs.find((l) => l.id === hoverLegId) ?? null : null;
```

(d) Wire `onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}` onto the `<svg>` element.

(e) Add `data-active` + hover handlers to the `<Block>` usage by passing two props and an `active` flag — change the blocks map to:

```tsx
        {blocks.map((b) => (
          <Block
            key={b.legId}
            block={b}
            x={blockX(b.legId)}
            yOf={scale.y}
            plotTop={plotTop}
            plotBottom={plotBottom}
            active={hoverLegId === b.legId}
            onEnter={() => setHoverLegId(b.legId)}
            onLeave={() => setHoverLegId(null)}
          />
        ))}
```

(f) Extend `BlockProps` and the `<g>` in `Block`:

```tsx
interface BlockProps {
  block: LadderBlock;
  x: number;
  yOf: (price: number) => number;
  plotTop: number;
  plotBottom: number;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}
```
and change the opening group tag to:
```tsx
    <g
      className={s.block}
      data-leg-id={block.legId}
      data-active={active}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
```

(g) Add the crosshair chip + detail card as DOM overlays just after the `</svg>` (and suppress the chip while a block is hovered):

```tsx
      {hoverY != null && hoverReadout != null && hoverLegId == null && (
        <div className={s.crosshairChip} data-testid="crosshair-chip" style={{ left: plotLeft + 6, top: hoverY }}>
          @{formatPriceTick(hoverPrice as number, span)} → {fmtUsd(hoverReadout.pnl)}
          {hoverReadout.pct != null ? ` (${fmtPct(hoverReadout.pct, 0)})` : ''}
        </div>
      )}

      {hoveredLeg != null && (
        <div className={s.card} style={{ left: centerX + BLOCK_W, top: scale.y(hoveredLeg.strike) - 40 }}>
          <div className={s.cardTitle}>{legToBlock(hoveredLeg).label}</div>
          <div>prem {fmtUsd(hoveredLeg.entryPrice)}</div>
          <div>IV {fmtIv(hoveredLeg.iv)}</div>
          <div>Δ {hoveredLeg.delta ?? '–'} · Θ {hoveredLeg.theta ?? '–'}</div>
          <div>P/L @spot {fmtUsd(netPnlReadout([hoveredLeg], spotPrice, hoveredLeg.entryPrice).pnl)}</div>
        </div>
      )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/features/architect/PayoffChartV3.tsx src/features/architect/PayoffChartV3.test.tsx
git commit -m "feat(architect): V3 price-scrub crosshair + hover detail card"
```

---

## Task 8: Mount V3 in ArchitectView (toggle + branch)

**Files:**
- Modify: `src/features/architect/ArchitectView.tsx`

After this task V3 is selectable in the running app (read-only render).

- [ ] **Step 1: Add the import**

Below `import PayoffChartV2, { pickCandleSpec } from './PayoffChartV2';` add:

```tsx
import PayoffChartV3 from './PayoffChartV3';
```

- [ ] **Step 2: Widen the variant union**

Change line ~190 from:

```tsx
  const [variant, setVariant] = useState<'v1' | 'v2'>('v1');
```
to:
```tsx
  const [variant, setVariant] = useState<'v1' | 'v2' | 'v3'>('v1');
```

- [ ] **Step 3: Add the placement/remove handlers**

Immediately after the `handleLegStrikeDrag` `useCallback` (ends ~line 331), add:

```tsx
  const handleAddLegAtStrike = useCallback(
    (strike: number, type: 'call' | 'put', direction: 'buy' | 'sell', quantity: number) => {
      if (!chain || !builderExpiry) return;
      const repriced = repriceLeg(
        chain,
        pricingVenues,
        { type, direction, strike, expiry: builderExpiry, quantity },
        { exactStrike: false },
      );
      if (!repriced) return;
      addLeg(repriced, underlying);
    },
    [chain, pricingVenues, builderExpiry, addLeg, underlying],
  );

  const handleRemoveLeg = useCallback((legId: string) => removeLeg(legId), [removeLeg]);
```

- [ ] **Step 4: Add the V3 toggle button + title**

In the chart title block, change the title expression from:

```tsx
                        {variant === 'v1' ? 'P&L at Expiry' : 'Live Spot vs Break-even Zones'}
```
to:
```tsx
                        {variant === 'v1'
                          ? 'P&L at Expiry'
                          : variant === 'v2'
                            ? 'Live Spot vs Break-even Zones'
                            : 'Lego Ladder'}
```

Then add a third button after the V2 `<button>` (inside `.variantToggle`):

```tsx
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v3'}
                        data-variant="v3"
                        onClick={() => setVariant('v3')}
                      >
                        V3
                      </button>
```

- [ ] **Step 5: Add the V3 render branch**

The chart render is currently `{variant === 'v1' ? (<>…V1…</>) : (<>…V2…</>)}`. Change the **V2 opener** from `) : (` to `) : variant === 'v2' ? (`, and immediately before the final closing `)}` of that expression (after the V2 `</>`), insert the V3 branch so the structure becomes:

```tsx
                  {variant === 'v1' ? (
                    <>
                      {/* …existing V1 block, unchanged… */}
                    </>
                  ) : variant === 'v2' ? (
                    <>
                      {/* …existing V2 block, unchanged… */}
                    </>
                  ) : (
                    <PayoffChartV3
                      points={payoffPoints}
                      breakevens={metrics?.breakevens ?? []}
                      spotPrice={spotPrice}
                      legs={pricedLegs}
                      maxProfit={metrics?.maxProfit ?? null}
                      maxLoss={metrics?.maxLoss ?? null}
                      netDebit={metrics?.netDebit ?? 0}
                      strikes={availableStrikes}
                      onLegStrikeDrag={handleLegStrikeDrag}
                      onAddLegAtStrike={handleAddLegAtStrike}
                      onRemoveLeg={handleRemoveLeg}
                    />
                  )}
```

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
pnpm typecheck
pnpm exec biome lint src/features/architect/ArchitectView.tsx
```
Expected: clean. (The V3 component now uses all three callbacks via props; if the `_`-prefixed placeholders in `PayoffChartV3.tsx` still exist from Task 6, they are replaced by real usage in Tasks 10–12 — leave them prefixed until then.)

- [ ] **Step 7: Manual smoke**

Run `pnpm dev`, open the Builder tab, add a couple legs (e.g. a long straddle via templates), click **V3**. Verify: vertical ladder, blue call / purple put blocks, yellow break-even lines, teal spot line, green/red wash, and the crosshair readout on hover. V1 and V2 still work.

- [ ] **Step 8: Commit**

```bash
git add src/features/architect/ArchitectView.tsx
git commit -m "feat(architect): mount V3 lego ladder as third chart variant"
```

---

# PHASE 2 — Tune (drag strike, live re-flow, remove)

## Task 9: Drag-to-tune strike + live re-flow + magnetic snap

**Files:**
- Modify: `src/features/architect/PayoffChartV3.tsx`
- Test: `src/features/architect/PayoffChartV3.test.tsx`

Dragging a block vertically retunes its strike: snap to the nearest `strikes` value, re-flow the wash live from a transient leg, commit via `onLegStrikeDrag` on release.

- [ ] **Step 1: Add the failing test**

Append to `PayoffChartV3.test.tsx`:

```tsx
import { vi } from 'vitest';

describe('PayoffChartV3 (drag strike)', () => {
  it('fires onLegStrikeDrag with the snapped strike on drag release', () => {
    const onDrag = vi.fn();
    const points = [
      { underlyingPrice: 70, pnl: -3 },
      { underlyingPrice: 130, pnl: 27 },
    ];
    const { container } = render(
      <PayoffChartV3
        points={points}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'leg-1', strike: 100 })]}
        maxProfit={null}
        maxLoss={-3}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onLegStrikeDrag={onDrag}
      />,
    );
    const group = container.querySelector('[data-leg-id="leg-1"]')!;
    // Drag downward in pixel space → lower price → expect a snapped strike below 100.
    fireEvent.pointerDown(group, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(container.querySelector('svg')!, { clientX: 300, clientY: 360 });
    fireEvent.pointerUp(container.querySelector('svg')!, { clientX: 300, clientY: 360 });
    expect(onDrag).toHaveBeenCalledTimes(1);
    const [legId, newStrike] = onDrag.mock.calls[0]!;
    expect(legId).toBe('leg-1');
    expect([90, 95]).toContain(newStrike);
  });
});
```

> Note: the exact `clientY` → price mapping depends on the default 600×400 size and PAD; the assertion only checks that the strike snapped to a *lower* available value, which is robust to small layout changes. If neither 90 nor 95 is produced, widen the move distance, not the assertion's intent.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx -t "drag strike"`
Expected: FAIL — `onLegStrikeDrag` never called.

- [ ] **Step 3: Implement drag**

In `PayoffChartV3.tsx`:

(a) Rename the prop usage: change `onLegStrikeDrag: _onLegStrikeDrag` in the destructure to `onLegStrikeDrag`.

(b) Add a nearest-strike helper near `clampY` (module scope):

```tsx
function nearestStrike(price: number, strikes: number[]): number | null {
  if (strikes.length === 0) return null;
  return strikes.reduce((best, k) => (Math.abs(k - price) < Math.abs(best - price) ? k : best));
}
```

(c) Add drag state near `hoverY`:

```tsx
  const [drag, setDrag] = useState<{ legId: string; strike: number } | null>(null);
```

(d) In `handlePointerMove`, before the hover logic, handle an active drag:

```tsx
    if (drag) {
      const price = scale.priceAt(Math.max(plotTop, Math.min(plotBottom, y)));
      const snapped = nearestStrike(price, strikes);
      if (snapped != null && snapped !== drag.strike) setDrag({ ...drag, strike: snapped });
      return;
    }
```

(e) Add pointer up/cancel handlers and wire them on the `<svg>` (`onPointerUp={endDrag} onPointerCancel={endDrag}`):

```tsx
  const endDrag = () => {
    if (drag && onLegStrikeDrag) {
      const original = legs.find((l) => l.id === drag.legId);
      if (original && original.strike !== drag.strike) onLegStrikeDrag(drag.legId, drag.strike);
    }
    setDrag(null);
  };
```

(f) Compute transient legs for live re-flow and feed them to zones/blocks. Replace the `blocks`/`zones` memos' inputs with a `viewLegs` that applies the in-flight drag strike:

```tsx
  const viewLegs = useMemo(
    () => (drag ? legs.map((l) => (l.id === drag.legId ? { ...l, strike: drag.strike } : l)) : legs),
    [legs, drag],
  );
```
then change `legs.map(legToBlock)` → `viewLegs.map(legToBlock)`, and `buildLadderZones(legs, …)` → `buildLadderZones(viewLegs, breakevens, spotPrice)`. (Break-evens still come from the committed `breakevens` prop; the wash re-flow from `viewLegs` is the live feedback. Final precise break-evens refresh after release re-prices upstream.)

(g) Start a drag from a block: add `onDragStart={() => setDrag({ legId: b.legId, strike: b.strike })}` to the `<Block>` usage and forward it as `onPointerDown` inside `Block`:

In the blocks map add the prop:
```tsx
            onDragStart={() => setDrag({ legId: b.legId, strike: b.strike })}
```
In `BlockProps` add `onDragStart: () => void;` and on the `<g>` add `onPointerDown={onDragStart}` plus `data-dragging` is optional. Pass `active={hoverLegId === b.legId || drag?.legId === b.legId}`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx`
Expected: PASS (all tests). If the snap assertion is flaky on size, increase the move `clientY` to `390`.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/features/architect/PayoffChartV3.tsx src/features/architect/PayoffChartV3.test.tsx
git commit -m "feat(architect): V3 drag-to-tune strike with magnetic snap + live re-flow"
```

---

## Task 10: Drop-in / remove animations + remove action

**Files:**
- Modify: `src/features/architect/PayoffChartV3.tsx`
- Test: `src/features/architect/PayoffChartV3.test.tsx`

Add a small `×` remove affordance on the hovered block that fires `onRemoveLeg`, plus the enter animation class on newly added blocks.

- [ ] **Step 1: Add the failing test**

Append to `PayoffChartV3.test.tsx`:

```tsx
describe('PayoffChartV3 (remove)', () => {
  it('fires onRemoveLeg when the block remove control is clicked', () => {
    const onRemove = vi.fn();
    const points = [
      { underlyingPrice: 70, pnl: -3 },
      { underlyingPrice: 130, pnl: 27 },
    ];
    const { container } = render(
      <PayoffChartV3
        points={points}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'leg-1', strike: 100 })]}
        maxProfit={null}
        maxLoss={-3}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onRemoveLeg={onRemove}
      />,
    );
    const removeBtn = container.querySelector('[data-remove-leg="leg-1"]')!;
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('leg-1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx -t remove`
Expected: FAIL — no `data-remove-leg` element.

- [ ] **Step 3: Implement**

(a) Change the destructure `onRemoveLeg: _onRemoveLeg` → `onRemoveLeg`.

(b) Pass it and an `enter` flag to `Block`. Track which legs are new with a ref so only freshly added blocks animate:

```tsx
  const seenIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    seenIds.current = new Set(legs.map((l) => l.id));
  });
```

(c) In the blocks map add:
```tsx
            isNew={!seenIds.current.has(b.legId)}
            onRemove={onRemoveLeg ? () => onRemoveLeg(b.legId) : undefined}
```

(d) Extend `BlockProps`:
```tsx
  isNew: boolean;
  onRemove?: () => void;
```
add `${isNew ? s.blockEnter : ''}` to the group className, and render a remove control (only meaningful when hovered/active) at the block's top-right corner inside `Block`:

```tsx
      {onRemove && active && (
        <g data-remove-leg={block.legId} style={{ cursor: 'pointer' }} onClick={onRemove}>
          <circle cx={x + BLOCK_W - 4} cy={yTop + 2} r={7} fill="var(--bg-elevated)" stroke="var(--lego-loss)" />
          <text x={x + BLOCK_W - 4} y={yTop + 5} fill="var(--lego-loss)" fontSize="9" textAnchor="middle">×</text>
        </g>
      )}
```

> The test clicks the control directly, so the `active` gate (which depends on hover) must not hide it in jsdom. Render the control whenever `onRemove` is set; use CSS `opacity` driven by `data-active` for the visual reveal instead of conditional mounting. Concretely: always render the `<g data-remove-leg>` when `onRemove` exists, and add to the stylesheet:
>
> ```css
> .block [data-remove-leg] { opacity: 0; transition: opacity var(--transition-fast); }
> .block[data-active='true'] [data-remove-leg] { opacity: 1; }
> ```
>
> Update step (d)'s JSX to drop the `&& active` guard accordingly.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/features/architect/PayoffChartV3.tsx src/features/architect/PayoffChartV3.test.tsx src/features/architect/PayoffChartV3.module.css
git commit -m "feat(architect): V3 block remove control + drop-in animation"
```

---

# PHASE 3 — Build (click-rung placement)

## Task 11: Click-rung picker → add leg

**Files:**
- Modify: `src/features/architect/PayoffChartV3.tsx`
- Test: `src/features/architect/PayoffChartV3.test.tsx`

Clicking the ladder background opens a small picker at that price; choosing call/put · buy/sell calls `onAddLegAtStrike` with the nearest strike and quantity 1.

- [ ] **Step 1: Add the failing test**

Append to `PayoffChartV3.test.tsx`:

```tsx
describe('PayoffChartV3 (placement)', () => {
  it('opens a picker on rung click and fires onAddLegAtStrike', () => {
    const onAdd = vi.fn();
    const { container } = render(
      <PayoffChartV3
        points={[]}
        breakevens={[]}
        spotPrice={100}
        legs={[]}
        maxProfit={null}
        maxLoss={null}
        netDebit={0}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
      />,
    );
    const svg = container.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 300, clientY: 200 });
    const buyCall = container.querySelector('[data-add="buy-call"]')!;
    expect(buyCall).not.toBeNull();
    fireEvent.click(buyCall);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [strike, type, direction, qty] = onAdd.mock.calls[0]!;
    expect([90, 95, 100, 105, 110]).toContain(strike);
    expect(type).toBe('call');
    expect(direction).toBe('buy');
    expect(qty).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx -t placement`
Expected: FAIL — no picker.

- [ ] **Step 3: Implement**

(a) Change destructure `onAddLegAtStrike: _onAddLegAtStrike` → `onAddLegAtStrike`.

(b) Add picker state near `drag`:

```tsx
  const [picker, setPicker] = useState<{ y: number; strike: number } | null>(null);
```

(c) Add a background click handler on the `<svg>` (`onClick={handleLadderClick}`) — only when not dragging and the click is not on a block (blocks call `stopPropagation` on pointer down):

```tsx
  const handleLadderClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onAddLegAtStrike || drag) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    if (y < plotTop || y > plotBottom) return;
    const snapped = nearestStrike(scale.priceAt(y), strikes);
    if (snapped == null) return;
    setPicker({ y, strike: snapped });
  };
```

(d) In `Block`'s `onPointerDown`, also stop propagation so dragging a block doesn't open the picker:

```tsx
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart();
        }}
```
(adjust `onDragStart` wiring accordingly — keep its signature `() => void`.)

(e) Render the picker overlay after the crosshair/card overlays:

```tsx
      {picker && onAddLegAtStrike && (
        <div className={s.picker} style={{ left: centerX - 70, top: picker.y }}>
          {(['buy', 'sell'] as const).flatMap((direction) =>
            (['call', 'put'] as const).map((type) => (
              <button
                key={`${direction}-${type}`}
                type="button"
                data-add={`${direction}-${type}`}
                className={s.pickerBtn}
                onClick={() => {
                  onAddLegAtStrike(picker.strike, type, direction, 1);
                  setPicker(null);
                }}
              >
                {direction === 'buy' ? '+' : '−'}
                {type === 'call' ? 'C' : 'P'} {picker.strike}
              </button>
            )),
          )}
        </div>
      )}
```

(f) Close the picker on pointer-leave (extend `handlePointerLeave`): add `setPicker(null);`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/architect/PayoffChartV3.test.tsx`
Expected: PASS (all V3 component tests).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm typecheck
pnpm exec biome lint src/features/architect/PayoffChartV3.tsx
git add src/features/architect/PayoffChartV3.tsx src/features/architect/PayoffChartV3.test.tsx
git commit -m "feat(architect): V3 click-rung placement picker (constructor-lite)"
```

---

## Task 12: Full verification + manual acceptance

**Files:** none (verification only).

- [ ] **Step 1: Full web test suite**

Run: `pnpm test:run`
Expected: all pass, including the existing architect/payoff suites (no regressions).

- [ ] **Step 2: Typecheck the whole package**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean (no array-index-key or unused-var violations in the new files; the `_`-prefixed placeholders from Task 6 are all gone now that callbacks are used).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: `tsc --noEmit` + `vite build` succeed.

- [ ] **Step 5: Manual acceptance (the spec's §11 done-criteria)**

Run `pnpm dev`, Builder tab, click **V3**:
- Empty state shows "click a rung to add a leg".
- Click a rung → picker → choose `+C` → a blue long-call block appears (drop-in animation), top edge on its break-even, green wash above / red below.
- Build a **long straddle** (add `+C 100` and `+P 100`) → the two blocks tile into the tall red rectangle between the break-evens; green above and below. Hover each block → lift + glow + detail card.
- Drag the call block down a rung → wash re-flows live; release → strike commits and re-prices.
- Hover empty ladder → crosshair readout `@<price> → <net P/L>`.
- Hover a block → `×` reveals → click → leg removed.
- Switch to a **sub-$1 underlying** (e.g. LIT/WFLI ~\$0.50) → blocks stay visible (min height), break-even labels show correct sub-$1 precision (not `0`).
- Switch back to **V1** and **V2** → both unchanged and working.

- [ ] **Step 6: Final commit (if any manual fixes were needed)**

```bash
git add -A
git commit -m "test(architect): V3 lego ladder full-suite green + manual acceptance"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §4.1 scale → Task 1; §4.2 blocks → Task 2/6; §4.3 wash+lines → Task 3/6; §4.4 lanes → Task 4/6; §4.5 sub-$1 format → Tasks 2/4 (`formatPriceTick`, `MIN_BLOCK_PX`) + Task 12 manual; §5.1 crosshair/card → Task 7; §5.2 drag+snap+reflow → Task 9; §5.3 placement → Task 11; §5.4 remove → Task 10; §5.5 reduced-motion → Task 5 CSS; §6 six cores → Tasks 6–11; §7 architecture (ladder-geometry + component + ArchitectView) → Tasks 1–11; §8 protect-existing → only additive ArchitectView edits, no payoff/V1/V2/store/WS changes; §9 testing → geometry unit tests (Tasks 1–4) + SVG smoke (Tasks 6–11); §10 edge cases (empty/degenerate/sub-$1/null greeks) → covered in tests + `clampY`/`|| 1`/`fmtUsd` null handling; §11 phasing → Phases 1–3.
- **Placeholder scan:** no TBD/TODO; every code step has complete code; commands have expected output.
- **Type consistency:** `LadderBlock`/`LadderZone`/`PriceScale` defined in Task 1–4 and consumed unchanged in Task 6+; `onAddLegAtStrike(strike, type, direction, quantity)` identical in component props, ArchitectView handler, and the placement test; `netPnlReadout(legs, price, netDebit)` consistent across Task 4 and Task 7.
