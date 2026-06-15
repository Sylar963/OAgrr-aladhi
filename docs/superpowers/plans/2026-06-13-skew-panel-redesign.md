# Skew Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `BTC/ETH SKEW` panel's two flat time-series charts with a context-first hero (per-metric "rich/cheap vs history" density strip) plus a 5-point constant-maturity smile (now vs a faded historical reference), and remove the Normalized/Z-Score/Raw MODE toggle.

**Architecture:** Backend gains two additive fields (`rr10d`, `bfly10d`) on each iv-history snapshot point so the smile can show 10Δ wings; everything else is reconstructed on the client from existing `atmIv/rr25d/bfly25d`. The panel's two children (`SkewDensityStrip`, `SkewSmileChart`) become pure React SVG components (no lightweight-charts), driven by pure helpers in `skew-history-utils.ts`. Existing `atmIv/rr25d/bfly25d` contract, percentile/z-score math, and persistence stay backward-compatible.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react (jsdom), Fastify, Postgres (pg), pnpm monorepo (`@oggregator/core`, `@oggregator/db`, `@oggregator/web`).

---

## Conventions for every commit step

This repo has an intermittent behavior that **auto-stages unrelated working-tree edits** into commits. To stay surgical, **always commit with an explicit pathspec** (`git commit -- <files>`) and run `git status` first. Never use `git add -A` / `git commit -a`.

## IV units reminder

`IvHistoryPoint` stores IV as **fractions** (`atmIv: 0.404` = 40.4%; `rr25d: -0.06` = −6 vol points). Display multiplies by 100. The smile axis and density strips work in **vol points (×100)**.

## File structure

**Backend (additive 10Δ):**
- `packages/core/src/core/enrichment.ts` — `IvHistoryPoint` += `rr10d`, `bfly10d` (type only).
- `packages/core/src/services/iv-history.ts` — compute `rr10d`/`bfly10d` in `snapshotOnce`; thread through `appendPoint`, persistence map, DVOL seed, `latest` fallback; `PersistedIvHistoryPoint` += fields.
- `packages/core/src/services/iv-history.test.ts` — extend `makeRow` + assertions.
- `packages/db/src/iv-history-store.ts` — `PersistedIvHistoryPoint`, INSERT, ON CONFLICT, SELECT, `IvHistoryRow`, `mapRow` += fields.
- `packages/db/migrations/0018_iv_history_add_10d_wings.sql` — `ALTER TABLE` add two nullable columns.

**Frontend:**
- `packages/web/src/shared-types/enriched.ts` — `IvHistoryPoint` += `rr10d`, `bfly10d`.
- `packages/web/src/features/surface/skew-history-utils.ts` — add `reconstructSmile`, `pickReferencePoint`, `buildDistribution` (+ `quantile`, `gaussianKde`); remove dead `referenceLines`/`SkewReferenceLine`.
- `packages/web/src/features/surface/skew-history-utils.test.ts` — add tests for new helpers; drop `referenceLines` test.
- `packages/web/src/features/surface/SkewDensityStrip.tsx` (+`.module.css`) — NEW, presentational.
- `packages/web/src/features/surface/SkewSmileChart.tsx` (+`.module.css`) — NEW, presentational.
- `packages/web/src/features/surface/SkewHistory.tsx` — rewrite render (compose children, drop MODE + lightweight-charts).
- `packages/web/src/features/surface/SkewHistory.module.css` — rework.
- `packages/web/src/features/surface/SkewHistory.test.tsx` — rewrite (drop lightweight-charts mock).

---

## Phase 1 — Backend: 10Δ wings (additive, backward-compatible)

### Task 1: Add `rr10d`/`bfly10d` to the core history point type

**Files:**
- Modify: `packages/core/src/core/enrichment.ts:125-130`

- [ ] **Step 1: Extend the interface**

In `packages/core/src/core/enrichment.ts`, change `IvHistoryPoint`:

```ts
export interface IvHistoryPoint {
  ts: number;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  rr10d: number | null;
  bfly10d: number | null;
}
```

Leave `IvHistoryExtrema` unchanged — the redesign does not need 10Δ historical extrema.

- [ ] **Step 2: Typecheck (expected to FAIL — call sites not updated yet)**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: FAIL — errors in `services/iv-history.ts` about missing `rr10d`/`bfly10d` (object literals at the snapshot append, the `latest` fallback, the DVOL seed). This confirms the type is wired; Task 2 fixes the call sites.

- [ ] **Step 3: Commit**

```bash
git status
git commit -m "feat(core): add 10d wings to IvHistoryPoint type" -- packages/core/src/core/enrichment.ts
```

---

### Task 2: Compute and persist `rr10d`/`bfly10d` in the snapshot

**Files:**
- Modify: `packages/core/src/services/iv-history.ts` (snapshot 187-210, `latest` fallback 321-324, persisted map 240-249, DVOL seed 269-286, `PersistedIvHistoryPoint` 84-92)
- Test: `packages/core/src/services/iv-history.test.ts` (`makeRow` 10-24, new test)

- [ ] **Step 1: Extend the test helper and add a failing test**

In `packages/core/src/services/iv-history.test.ts`, replace `makeRow` so it can emit 10Δ wings (default keeps existing behavior — `null` wings):

```ts
function makeRow(
  expiry: string,
  dte: number,
  atm: number,
  skew: number,
  fly: number,
  skew10: number | null = null,
  fly10: number | null = null,
): IvSurfaceRow {
  // skew = c25 − p25, fly = (c25+p25)/2 − atm → c25 = atm+fly+skew/2; p25 = atm+fly−skew/2.
  const c25 = atm + fly + skew / 2;
  const p25 = atm + fly - skew / 2;
  const c10 = skew10 != null && fly10 != null ? atm + fly10 + skew10 / 2 : null;
  const p10 = skew10 != null && fly10 != null ? atm + fly10 - skew10 / 2 : null;
  return {
    expiry,
    dte,
    delta10p: p10,
    delta25p: p25,
    atm,
    delta25c: c25,
    delta10c: c10,
  };
}
```

Then add this test inside `describe('IvHistoryService', ...)`:

```ts
it('computes 10d RR and butterfly when wings are present', async () => {
  // 25d: skew +0.04, fly +0.01. 10d: skew +0.08, fly +0.03.
  const surfaces = [makeRow('e', 30, 0.5, 0.04, 0.01, 0.08, 0.03)];
  const svc = new IvHistoryService(
    { getSurfaceGrid: () => Promise.resolve(surfaces), dvol: mockDvol() },
    { underlyings: ['BTC'] },
  );
  await svc.snapshotOnce(Date.now());
  const p = svc.getBuffer('BTC', '30d')[0]!;
  expect(p.rr25d).toBeCloseTo(0.04, 6);
  expect(p.rr10d).toBeCloseTo(0.08, 6);
  expect(p.bfly10d).toBeCloseTo(0.03, 6);
  svc.dispose();
});

it('leaves 10d null when wings are absent', async () => {
  const surfaces = [makeRow('e', 30, 0.5, 0.04, 0.01)]; // no 10d args
  const svc = new IvHistoryService(
    { getSurfaceGrid: () => Promise.resolve(surfaces), dvol: mockDvol() },
    { underlyings: ['BTC'] },
  );
  await svc.snapshotOnce(Date.now());
  const p = svc.getBuffer('BTC', '30d')[0]!;
  expect(p.rr10d).toBeNull();
  expect(p.bfly10d).toBeNull();
  svc.dispose();
});
```

- [ ] **Step 2: Run the new tests (expected FAIL/compile error)**

Run: `pnpm --filter @oggregator/core test:run -- iv-history`
Expected: FAIL — `p.rr10d`/`p.bfly10d` undefined / type errors (snapshot doesn't set them yet).

- [ ] **Step 3: Compute 10Δ in `snapshotOnce`**

In `packages/core/src/services/iv-history.ts`, inside the `for (const tenor of TENORS)` loop, after the `fly` computation (line ~199) and before `this.appendPoint(...)`, add:

```ts
const c10 = interpTenor(surfaces, days, 'delta10c');
const p10 = interpTenor(surfaces, days, 'delta10p');
const rr10 = c10 != null && p10 != null ? c10 - p10 : null;
const fly10 =
  c10 != null && p10 != null && interpAtm != null
    ? (c10 + p10) / 2 - interpAtm
    : null;
```

Change the `appendPoint` call to:

```ts
this.appendPoint(underlying, tenor, {
  ts: now,
  atmIv: atm,
  rr25d: rr,
  bfly25d: fly,
  rr10d: rr10,
  bfly10d: fly10,
});
```

Change the `persisted.push({...})` object (line ~201-209) to include the new fields:

```ts
persisted.push({
  underlying,
  tenorDays: days,
  ts: new Date(now),
  atmIv: atm,
  rr25d: rr,
  bfly25d: fly,
  rr10d: rr10,
  bfly10d: fly10,
  source: 'live_surface',
});
```

- [ ] **Step 4: Fix the `latest` fallback literal**

In `buildTenorResult`, the no-data fallback (line ~321-324) must satisfy the new type:

```ts
const latest =
  series.length > 0
    ? series[series.length - 1]!
    : { ts: 0, atmIv: null, rr25d: null, bfly25d: null, rr10d: null, bfly10d: null };
```

- [ ] **Step 5: Thread through persistence load + DVOL seed**

In `loadPersistedHistory` (the `appendPoint` at ~243-248), add the new fields:

```ts
this.appendPoint(point.underlying, tenor, {
  ts: point.ts.getTime(),
  atmIv: point.atmIv,
  rr25d: point.rr25d,
  bfly25d: point.bfly25d,
  rr10d: point.rr10d,
  bfly10d: point.bfly10d,
});
```

In `seedFromDvol`, the in-memory seed literal (~269-274):

```ts
const seed: IvHistoryPoint[] = candles.map((c) => ({
  ts: c.timestamp,
  atmIv: c.close / 100,
  rr25d: null,
  bfly25d: null,
  rr10d: null,
  bfly10d: null,
}));
```

And the persisted seed literal (~277-285) — add `rr10d: null, bfly10d: null` alongside `rr25d: null, bfly25d: null`.

- [ ] **Step 6: Extend `PersistedIvHistoryPoint` (core copy)**

In the same file (~84-92):

```ts
export interface PersistedIvHistoryPoint {
  underlying: string;
  tenorDays: IvTenorDays;
  ts: Date;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  rr10d: number | null;
  bfly10d: number | null;
  source: IvHistoryPointSource;
}
```

- [ ] **Step 7: Run tests (expected PASS)**

Run: `pnpm --filter @oggregator/core test:run -- iv-history`
Expected: PASS — all existing tests plus the two new ones. (The existing "persists live surface snapshots" test still passes; it uses `objectContaining`, so extra fields don't break it.)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @oggregator/core typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git status
git commit -m "feat(core): compute 10d rr/butterfly in iv-history snapshot" \
  -- packages/core/src/services/iv-history.ts packages/core/src/services/iv-history.test.ts
```

---

### Task 3: Persist `rr10d`/`bfly10d` in the Postgres store + migration

**Files:**
- Create: `packages/db/migrations/0018_iv_history_add_10d_wings.sql`
- Modify: `packages/db/src/iv-history-store.ts` (type 8-16, INSERT 78-115, SELECT 118-138, `IvHistoryRow` 158-166, `mapRow` 168-178)

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/0018_iv_history_add_10d_wings.sql`:

```sql
ALTER TABLE iv_history_points
  ADD COLUMN IF NOT EXISTS rr10d DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bfly10d DOUBLE PRECISION;
```

- [ ] **Step 2: Extend `PersistedIvHistoryPoint` (db copy)**

In `packages/db/src/iv-history-store.ts` (8-16), add `rr10d`/`bfly10d` (same shape as core copy):

```ts
export interface PersistedIvHistoryPoint {
  underlying: string;
  tenorDays: 7 | 30 | 60 | 90;
  ts: Date;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  rr10d: number | null;
  bfly10d: number | null;
  source: IvHistoryPointSource;
}
```

- [ ] **Step 3: Update the INSERT (9 columns now)**

Replace the `writeMany` body's batch loop (78-115). The offset becomes `* 9`, the `values.push` adds `rr10d`/`bfly10d`, the placeholder string gains `$8`/`$9` (shifting `source` to `$9`), the column list and `ON CONFLICT` set add the two columns:

```ts
const placeholders = batch.map((point, batchIndex) => {
  const offset = batchIndex * 9;
  values.push(
    point.underlying.toUpperCase(),
    point.tenorDays,
    point.ts,
    point.atmIv,
    point.rr25d,
    point.bfly25d,
    point.rr10d,
    point.bfly10d,
    point.source,
  );
  return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
});

await this.pool.query(
  `INSERT INTO iv_history_points (
    underlying,
    tenor_days,
    ts,
    atm_iv,
    rr25d,
    bfly25d,
    rr10d,
    bfly10d,
    source
  ) VALUES ${placeholders.join(', ')}
  ON CONFLICT (underlying, tenor_days, ts) DO UPDATE SET
    atm_iv = EXCLUDED.atm_iv,
    rr25d = EXCLUDED.rr25d,
    bfly25d = EXCLUDED.bfly25d,
    rr10d = EXCLUDED.rr10d,
    bfly10d = EXCLUDED.bfly10d,
    source = EXCLUDED.source`,
  values,
);
```

- [ ] **Step 4: Update the SELECT, row type, and mapper**

In `loadSince` (118-138) add `rr10d, bfly10d` to the column list:

```ts
const result = await this.pool.query<IvHistoryRow>(
  `SELECT
    underlying,
    tenor_days,
    ts,
    atm_iv,
    rr25d,
    bfly25d,
    rr10d,
    bfly10d,
    source
  FROM iv_history_points
  WHERE underlying = ANY($1::text[])
    AND ts >= $2
  ORDER BY underlying ASC, tenor_days ASC, ts ASC`,
  [query.underlyings.map((u) => u.toUpperCase()), query.since],
);
```

Extend `IvHistoryRow` (158-166):

```ts
interface IvHistoryRow {
  underlying: string;
  tenor_days: number;
  ts: Date;
  atm_iv: number | string | null;
  rr25d: number | string | null;
  bfly25d: number | string | null;
  rr10d: number | string | null;
  bfly10d: number | string | null;
  source: IvHistoryPointSource;
}
```

Extend `mapRow` (168-178) to set `rr10d: toNumber(row.rr10d)` and `bfly10d: toNumber(row.bfly10d)`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @oggregator/db typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status
git commit -m "feat(db): persist 10d wings in iv_history_points (migration 0018)" \
  -- packages/db/migrations/0018_iv_history_add_10d_wings.sql packages/db/src/iv-history-store.ts
```

---

### Task 4: Rebuild core dist (server runs from `dist/`)

**Files:** none (build artifact)

- [ ] **Step 1: Rebuild core**

Run: `pnpm --filter @oggregator/core build`
Expected: succeeds; `dist/` now exports the new fields. (Per core CLAUDE.md the server imports `@oggregator/core` from `dist/`, so this is required before the server sees the change.)

- [ ] **Step 2: No commit** — `dist/` is build output (gitignored or rebuilt in CI). Skip.

---

## Phase 2 — Frontend types + pure helpers

### Task 5: Mirror the type on the web side

**Files:**
- Modify: `packages/web/src/shared-types/enriched.ts:110-115`

- [ ] **Step 1: Extend `IvHistoryPoint`**

```ts
export interface IvHistoryPoint {
  ts: number;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  rr10d: number | null;
  bfly10d: number | null;
}
```

- [ ] **Step 2: Typecheck (expected FAIL)**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: FAIL — `skew-history-utils.test.ts`'s `point()` factory and `SkewHistory.test.tsx` mock objects are missing the new fields. Fixed in later tasks; this confirms wiring.

- [ ] **Step 3: Commit**

```bash
git status
git commit -m "feat(web): mirror 10d wings on IvHistoryPoint" -- packages/web/src/shared-types/enriched.ts
```

---

### Task 6: `reconstructSmile` helper

**Files:**
- Modify: `packages/web/src/features/surface/skew-history-utils.ts`
- Test: `packages/web/src/features/surface/skew-history-utils.test.ts`

- [ ] **Step 1: Add a failing test**

Add to `skew-history-utils.test.ts` (import `reconstructSmile` and the existing `point` factory — update `point` first, see Task 10 Step 1; for now add the import):

```ts
import { reconstructSmile } from './skew-history-utils';

describe('reconstructSmile', () => {
  it('reconstructs 5 points when 10d wings are present', () => {
    const pts = reconstructSmile({
      ts: 1, atmIv: 0.4, rr25d: -0.06, bfly25d: 0.015, rr10d: -0.1, bfly10d: 0.04,
    });
    expect(pts.map((p) => p.label)).toEqual(['10Δp', '25Δp', 'ATM', '25Δc', '10Δc']);
    const atm = pts.find((p) => p.label === 'ATM')!;
    const c25 = pts.find((p) => p.label === '25Δc')!;
    const p25 = pts.find((p) => p.label === '25Δp')!;
    expect(atm.iv).toBeCloseTo(40, 6);
    // c25 = (atm + fly + rr/2) * 100 = (0.4 + 0.015 − 0.03) * 100 = 38.5
    expect(c25.iv).toBeCloseTo(38.5, 6);
    // p25 = (atm + fly − rr/2) * 100 = (0.4 + 0.015 + 0.03) * 100 = 44.5
    expect(p25.iv).toBeCloseTo(44.5, 6);
  });

  it('reconstructs 3 points when 10d wings are missing', () => {
    const pts = reconstructSmile({
      ts: 1, atmIv: 0.4, rr25d: -0.06, bfly25d: 0.015, rr10d: null, bfly10d: null,
    });
    expect(pts.map((p) => p.label)).toEqual(['25Δp', 'ATM', '25Δc']);
  });

  it('returns empty when atm is missing', () => {
    expect(reconstructSmile({
      ts: 1, atmIv: null, rr25d: -0.06, bfly25d: 0.015, rr10d: null, bfly10d: null,
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run (expected FAIL — not exported)**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils`
Expected: FAIL — `reconstructSmile is not a function`.

- [ ] **Step 3: Implement**

Add to `skew-history-utils.ts`:

```ts
export interface SmilePoint {
  /** Delta-axis position in [0,1]: put |δ| on the left, 1−callδ on the right. */
  x: number;
  /** IV in vol points (fraction × 100). */
  iv: number;
  label: string;
}

const DELTA_X = { put10: 0.1, put25: 0.25, atm: 0.5, call25: 0.75, call10: 0.9 };

export function reconstructSmile(point: IvHistoryPoint): SmilePoint[] {
  const { atmIv, rr25d, bfly25d, rr10d, bfly10d } = point;
  if (atmIv == null || !Number.isFinite(atmIv)) return [];
  const pts: SmilePoint[] = [];
  const has10 =
    rr10d != null && Number.isFinite(rr10d) && bfly10d != null && Number.isFinite(bfly10d);
  if (has10) {
    pts.push({ x: DELTA_X.put10, iv: (atmIv + bfly10d! - rr10d! / 2) * 100, label: '10Δp' });
  }
  if (rr25d != null && Number.isFinite(rr25d) && bfly25d != null && Number.isFinite(bfly25d)) {
    pts.push({ x: DELTA_X.put25, iv: (atmIv + bfly25d - rr25d / 2) * 100, label: '25Δp' });
  }
  pts.push({ x: DELTA_X.atm, iv: atmIv * 100, label: 'ATM' });
  if (rr25d != null && Number.isFinite(rr25d) && bfly25d != null && Number.isFinite(bfly25d)) {
    pts.push({ x: DELTA_X.call25, iv: (atmIv + bfly25d + rr25d / 2) * 100, label: '25Δc' });
  }
  if (has10) {
    pts.push({ x: DELTA_X.call10, iv: (atmIv + bfly10d! + rr10d! / 2) * 100, label: '10Δc' });
  }
  return pts.sort((a, b) => a.x - b.x);
}
```

- [ ] **Step 4: Run (expected PASS)**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils`
Expected: PASS for the `reconstructSmile` block (other suites may still fail on the stale `point` factory — fixed in Task 10).

- [ ] **Step 5: Commit**

```bash
git status
git commit -m "feat(web): reconstruct constant-maturity smile from rr/fly" \
  -- packages/web/src/features/surface/skew-history-utils.ts packages/web/src/features/surface/skew-history-utils.test.ts
```

---

### Task 7: `pickReferencePoint` helper

**Files:**
- Modify: `packages/web/src/features/surface/skew-history-utils.ts`
- Test: `packages/web/src/features/surface/skew-history-utils.test.ts`

- [ ] **Step 1: Add a failing test**

```ts
import { pickReferencePoint } from './skew-history-utils';

describe('pickReferencePoint', () => {
  const series = [
    { ts: 0, atmIv: 0.4, rr25d: -0.05, bfly25d: 0.01, rr10d: null, bfly10d: null },
    { ts: 7 * 86_400_000, atmIv: 0.41, rr25d: -0.04, bfly25d: 0.01, rr10d: null, bfly10d: null },
    { ts: 14 * 86_400_000, atmIv: 0.42, rr25d: -0.03, bfly25d: 0.01, rr10d: null, bfly10d: null },
  ];

  it('picks the point closest to nowTs − refDays', () => {
    const ref = pickReferencePoint(series, 14 * 86_400_000, 7);
    expect(ref?.ts).toBe(7 * 86_400_000); // 7d before the latest
  });

  it('returns null when no point is within half the horizon', () => {
    expect(pickReferencePoint(series, 14 * 86_400_000, 60)).toBeNull();
  });
});
```

- [ ] **Step 2: Run (expected FAIL)**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils`
Expected: FAIL — `pickReferencePoint is not a function`.

- [ ] **Step 3: Implement**

```ts
const MS_PER_DAY = 86_400_000;

export function pickReferencePoint(
  series: IvHistoryPoint[],
  nowTs: number,
  refDays: number,
): IvHistoryPoint | null {
  if (series.length === 0) return null;
  const target = nowTs - refDays * MS_PER_DAY;
  const tolerance = (refDays * MS_PER_DAY) / 2;
  let best: IvHistoryPoint | null = null;
  let bestDist = Infinity;
  for (const point of series) {
    if (point.atmIv == null) continue;
    const dist = Math.abs(point.ts - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return best != null && bestDist <= tolerance ? best : null;
}
```

- [ ] **Step 4: Run (expected PASS) + Commit**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils` → PASS for this block.

```bash
git status
git commit -m "feat(web): pick historical smile reference point by horizon" \
  -- packages/web/src/features/surface/skew-history-utils.ts packages/web/src/features/surface/skew-history-utils.test.ts
```

---

### Task 8: `buildDistribution` helper (the hero's data)

**Files:**
- Modify: `packages/web/src/features/surface/skew-history-utils.ts`
- Test: `packages/web/src/features/surface/skew-history-utils.test.ts`

- [ ] **Step 1: Add a failing test**

```ts
import { buildDistribution } from './skew-history-utils';

describe('buildDistribution', () => {
  const series = [
    { ts: 1, atmIv: 0.4, rr25d: -0.08, bfly25d: 0.01, rr10d: null, bfly10d: null },
    { ts: 2, atmIv: 0.4, rr25d: -0.06, bfly25d: 0.01, rr10d: null, bfly10d: null },
    { ts: 3, atmIv: 0.4, rr25d: -0.04, bfly25d: 0.01, rr10d: null, bfly10d: null },
  ];

  it('returns nowValue, percentile, sigma, and a density curve', () => {
    const d = buildDistribution(series, 'rr25d')!;
    expect(d.nowValue).toBeCloseTo(-4, 6);    // latest rr25d × 100
    expect(d.min).toBeCloseTo(-8, 6);
    expect(d.max).toBeCloseTo(-4, 6);
    expect(d.percentile).toBeCloseTo(100, 6); // latest is the max
    expect(d.sigma).toBeGreaterThan(0);
    expect(d.bins.length).toBeGreaterThan(8);
    expect(d.bins.every((b) => b.density >= 0)).toBe(true);
    expect(d.rangeLo).toBeLessThanOrEqual(d.nowValue);
    expect(d.rangeHi).toBeGreaterThanOrEqual(d.nowValue);
  });

  it('returns null with fewer than 2 valid points', () => {
    expect(buildDistribution([series[0]!], 'rr25d')).toBeNull();
  });
});
```

- [ ] **Step 2: Run (expected FAIL)**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils`
Expected: FAIL — `buildDistribution is not a function`.

- [ ] **Step 3: Implement (with `quantile` + `gaussianKde` internals)**

```ts
export interface SkewDistribution {
  bins: { x: number; density: number }[]; // density sampled across [rangeLo, rangeHi]
  nowValue: number;                        // latest metric in vol points
  percentile: number | null;               // fraction ≤ now, ×100
  sigma: number | null;                     // z-score of latest
  zone: SkewZone | null;
  mean: number;
  stddev: number;
  rangeLo: number;
  rangeHi: number;
  min: number;
  max: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function gaussianKde(values: number[], lo: number, hi: number, samples = 32): { x: number; density: number }[] {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance) || 1;
  // Silverman's rule of thumb; floor avoids a zero bandwidth on tight windows.
  const bw = Math.max(1.06 * sd * n ** -0.2, (hi - lo) / 64 || 1e-6);
  const span = hi - lo || 1;
  const out: { x: number; density: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const x = lo + (span * i) / (samples - 1);
    let density = 0;
    for (const v of values) {
      const u = (x - v) / bw;
      density += Math.exp(-0.5 * u * u);
    }
    out.push({ x, density: density / (n * bw * Math.sqrt(2 * Math.PI)) });
  }
  return out;
}

export function buildDistribution(
  series: IvHistoryPoint[],
  key: SkewMetricKey,
): SkewDistribution | null {
  const values = series
    .map((p) => p[key])
    .filter((v): v is number => v != null && Number.isFinite(v))
    .map((v) => v * 100);
  if (values.length < 2) return null;

  const nowValue = values[values.length - 1]!;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const sigma = stddev > 0 ? (nowValue - mean) / stddev : null;
  const leq = values.filter((v) => v <= nowValue).length;
  const percentile = (leq / values.length) * 100;

  // Robust display range: 2nd–98th percentile, always widened to include `now`.
  let rangeLo = Math.min(quantile(sorted, 0.02), nowValue);
  let rangeHi = Math.max(quantile(sorted, 0.98), nowValue);
  if (rangeHi - rangeLo < 1e-6) {
    rangeLo -= 1;
    rangeHi += 1;
  }

  return {
    bins: gaussianKde(values, rangeLo, rangeHi),
    nowValue,
    percentile,
    sigma,
    zone: zoneFor(sigma, 'zscore'),
    mean,
    stddev,
    rangeLo,
    rangeHi,
    min,
    max,
  };
}
```

- [ ] **Step 4: Run (expected PASS) + Commit**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils` → PASS for this block.

```bash
git status
git commit -m "feat(web): build skew distribution (kde, percentile, sigma, robust range)" \
  -- packages/web/src/features/surface/skew-history-utils.ts packages/web/src/features/surface/skew-history-utils.test.ts
```

---

## Phase 3 — Presentational components

### Task 9: `SkewDensityStrip` component

**Files:**
- Create: `packages/web/src/features/surface/SkewDensityStrip.tsx`
- Create: `packages/web/src/features/surface/SkewDensityStrip.module.css`
- Test: `packages/web/src/features/surface/SkewDensityStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SkewDensityStrip from './SkewDensityStrip';
import type { SkewDistribution } from './skew-history-utils';

const dist: SkewDistribution = {
  bins: [
    { x: -9, density: 0.1 }, { x: -6, density: 0.5 }, { x: -3, density: 0.1 },
  ],
  nowValue: -6, percentile: 56, sigma: 0.12, zone: 'normal',
  mean: -6, stddev: 1.5, rangeLo: -9, rangeHi: -3, min: -9, max: -3,
};

describe('SkewDensityStrip', () => {
  it('renders the verdict line with zone, percentile, vol points', () => {
    render(
      <SkewDensityStrip
        label="25Δ RR" color="#50d2c1" distribution={dist}
        atmText="−14.9% ATM" spark={[{ time: 1, value: -6 }, { time: 2, value: -6 }]}
      />,
    );
    expect(screen.getByText('25Δ RR')).toBeTruthy();
    expect(screen.getByText('NORMAL')).toBeTruthy();
    expect(screen.getByText(/56th/)).toBeTruthy();
    expect(screen.getByText(/-6.0vp|−6.0vp/)).toBeTruthy();
  });

  it('renders insufficient state when distribution is null', () => {
    render(<SkewDensityStrip label="25Δ RR" color="#50d2c1" distribution={null} atmText="" spark={[]} />);
    expect(screen.getByText(/insufficient/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run (expected FAIL)**

Run: `pnpm --filter @oggregator/web test:run -- SkewDensityStrip`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `SkewDensityStrip.tsx`:

```tsx
import type { SkewDistribution, SkewLinePoint } from './skew-history-utils';
import styles from './SkewDensityStrip.module.css';

interface Props {
  label: string;
  color: string;
  distribution: SkewDistribution | null;
  atmText: string;
  spark: SkewLinePoint[];
}

const W = 320;
const H = 50;

function fmtVp(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}vp`;
}

function fmtSigma(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}σ`;
}

function sparkPath(spark: SkewLinePoint[]): string {
  if (spark.length < 2) return '';
  const xs = spark.map((p) => p.time);
  const ys = spark.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  return spark
    .map((p, i) => {
      const px = ((p.time - xMin) / xSpan) * 64;
      const py = 16 - ((p.value - yMin) / ySpan) * 14;
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
}

export default function SkewDensityStrip({ label, color, distribution, atmText, spark }: Props) {
  if (!distribution) {
    return (
      <div className={styles.block}>
        <div className={styles.header}>
          <span className={styles.name} style={{ color }}>{label}</span>
          <span className={styles.muted}>insufficient history</span>
        </div>
      </div>
    );
  }

  const { bins, nowValue, percentile, sigma, zone, mean, stddev, rangeLo, rangeHi } = distribution;
  const span = rangeHi - rangeLo || 1;
  const toX = (v: number) => 10 + ((v - rangeLo) / span) * (W - 20);
  const maxDensity = Math.max(...bins.map((b) => b.density), 1e-9);
  const baseY = H - 6;
  const toY = (d: number) => baseY - (d / maxDensity) * (baseY - 6);

  const curve = bins.map((b, i) => `${i === 0 ? 'M' : 'L'}${toX(b.x).toFixed(1)},${toY(b.density).toFixed(1)}`).join(' ');
  const fill = `${curve} L${toX(bins[bins.length - 1]!.x).toFixed(1)},${baseY} L${toX(bins[0]!.x).toFixed(1)},${baseY} Z`;
  const nowX = toX(nowValue);
  const sigmaLoX = toX(mean - stddev);
  const sigmaHiX = toX(mean + stddev);
  const clipId = `clip-${label.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <div className={styles.block}>
      <div className={styles.header}>
        <span className={styles.name} style={{ color }}>{label}</span>
        <span className={styles.sigma} style={{ color }}>{fmtSigma(sigma)}</span>
        <span className={styles.chip} data-zone={zone ?? 'normal'} style={{ color }}>
          {(zone ?? 'normal').toUpperCase()}
        </span>
        <span className={styles.sub}>
          {percentile != null ? `${Math.round(percentile)}th` : '–'} · {fmtVp(nowValue)} · {atmText}
        </span>
        <svg className={styles.spark} width="64" height="18" viewBox="0 0 64 18" aria-hidden="true">
          <path d={sparkPath(spark)} fill="none" stroke={color} strokeWidth="1.2" opacity="0.65" />
        </svg>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`${label} distribution`}>
        <defs>
          <clipPath id={clipId}><rect x="0" y="0" width={nowX} height={H} /></clipPath>
        </defs>
        <path d={fill} fill={color} fillOpacity="0.05" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
        <path d={fill} fill={color} fillOpacity="0.18" clipPath={`url(#${clipId})`} />
        <line x1={sigmaLoX} y1="6" x2={sigmaLoX} y2={baseY} stroke="#3a4248" strokeWidth="1" strokeDasharray="2 3" />
        <line x1={sigmaHiX} y1="6" x2={sigmaHiX} y2={baseY} stroke="#3a4248" strokeWidth="1" strokeDasharray="2 3" />
        <line x1={nowX} y1="2" x2={nowX} y2={baseY + 2} stroke="#fff" strokeWidth="1.5" />
        <circle cx={nowX} cy="7" r="3" fill="#fff" />
        <line x1="10" y1={baseY} x2={W - 10} y2={baseY} stroke="#1a1f24" />
      </svg>
      <div className={styles.ends}>
        <span>cheap {fmtVp(rangeLo)}</span>
        <span>rich {fmtVp(rangeHi)}</span>
      </div>
    </div>
  );
}
```

Create `SkewDensityStrip.module.css`:

```css
.block { margin-bottom: 12px; }
.header { display: flex; align-items: center; gap: 9px; font-family: 'IBM Plex Mono', monospace; margin-bottom: 4px; }
.name { font-size: 12px; font-weight: 600; }
.sigma { font-size: 18px; font-weight: 600; }
.chip { font-size: 8px; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.04em; border: 1px solid currentColor; opacity: 0.85; }
.sub { font-size: 10px; color: #6b7280; }
.spark { margin-left: auto; }
.muted { font-size: 11px; color: #4b5560; margin-left: auto; }
.ends { display: flex; justify-content: space-between; font-size: 9px; color: #4b5560; margin-top: 1px; font-family: 'IBM Plex Mono', monospace; }
```

- [ ] **Step 4: Run (expected PASS)**

Run: `pnpm --filter @oggregator/web test:run -- SkewDensityStrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status
git commit -m "feat(web): SkewDensityStrip — rich/cheap-vs-history hero" \
  -- packages/web/src/features/surface/SkewDensityStrip.tsx \
     packages/web/src/features/surface/SkewDensityStrip.module.css \
     packages/web/src/features/surface/SkewDensityStrip.test.tsx
```

---

### Task 10: `SkewSmileChart` component

**Files:**
- Create: `packages/web/src/features/surface/SkewSmileChart.tsx`
- Create: `packages/web/src/features/surface/SkewSmileChart.module.css`
- Test: `packages/web/src/features/surface/SkewSmileChart.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SkewSmileChart from './SkewSmileChart';
import type { SmilePoint } from './skew-history-utils';

const now: SmilePoint[] = [
  { x: 0.1, iv: 49, label: '10Δp' }, { x: 0.25, iv: 44.5, label: '25Δp' },
  { x: 0.5, iv: 40, label: 'ATM' }, { x: 0.75, iv: 38.5, label: '25Δc' },
  { x: 0.9, iv: 42, label: '10Δc' },
];

describe('SkewSmileChart', () => {
  it('renders delta labels and the reference label', () => {
    render(<SkewSmileChart now={now} reference={null} referenceLabel="7d ago" />);
    expect(screen.getByText('ATM')).toBeTruthy();
    expect(screen.getByText('10Δp')).toBeTruthy();
    expect(screen.getByText('10Δc')).toBeTruthy();
  });

  it('renders an empty state with no points', () => {
    render(<SkewSmileChart now={[]} reference={null} referenceLabel="7d ago" />);
    expect(screen.getByText(/insufficient/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run (expected FAIL)**

Run: `pnpm --filter @oggregator/web test:run -- SkewSmileChart`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `SkewSmileChart.tsx`:

```tsx
import type { SmilePoint } from './skew-history-utils';
import styles from './SkewSmileChart.module.css';

interface Props {
  now: SmilePoint[];
  reference: SmilePoint[] | null;
  referenceLabel: string;
}

const W = 480;
const H = 150;
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

export default function SkewSmileChart({ now, reference, referenceLabel }: Props) {
  if (now.length === 0) {
    return <div className={styles.empty}>insufficient data</div>;
  }

  const all = [...now, ...(reference ?? [])];
  const ivs = all.map((p) => p.iv);
  const ivMin = Math.min(...ivs);
  const ivMax = Math.max(...ivs);
  const ivSpan = ivMax - ivMin || 1;
  const padIv = ivSpan * 0.15;
  const lo = ivMin - padIv;
  const hi = ivMax + padIv;

  const toX = (x: number) => PAD_L + x * (W - PAD_L - PAD_R);
  const toY = (iv: number) => PAD_T + (1 - (iv - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const line = (pts: SmilePoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x).toFixed(1)},${toY(p.iv).toFixed(1)}`).join(' ');

  const gridIvs = [hi, (hi + lo) / 2, lo];

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="volatility smile">
        {gridIvs.map((iv) => (
          <g key={iv.toFixed(2)}>
            <line x1={PAD_L} y1={toY(iv)} x2={W - PAD_R} y2={toY(iv)} stroke="#15191d" />
            <text x="2" y={toY(iv) + 3} fill="#3f484f" fontSize="9" fontFamily="monospace">{iv.toFixed(0)}%</text>
          </g>
        ))}
        {reference && reference.length > 0 && (
          <path d={line(reference)} fill="none" stroke="#50d2c1" strokeWidth="1.3" strokeDasharray="4 3" opacity="0.4" />
        )}
        <path d={line(now)} fill="none" stroke="#50d2c1" strokeWidth="2" />
        {now.map((p) => (
          <circle key={p.label} cx={toX(p.x)} cy={toY(p.iv)} r="3" fill="#50d2c1" />
        ))}
        {now.map((p) => (
          <text key={`l-${p.label}`} x={toX(p.x)} y={H - 10} fill="#6b7280" fontSize="9" fontFamily="monospace" textAnchor="middle">{p.label}</text>
        ))}
      </svg>
      <div className={styles.caption}>solid = now · faded = {referenceLabel} · tilt = RR · lift = Fly</div>
    </div>
  );
}
```

Create `SkewSmileChart.module.css`:

```css
.wrap { border-top: 1px solid #15191d; margin-top: 6px; padding-top: 8px; }
.caption { font-size: 10px; color: #5b656d; font-family: 'IBM Plex Mono', monospace; text-align: center; margin-top: 2px; }
.empty { font-size: 11px; color: #4b5560; text-align: center; padding: 28px 0; font-family: 'IBM Plex Mono', monospace; }
```

- [ ] **Step 4: Run (expected PASS) + Commit**

Run: `pnpm --filter @oggregator/web test:run -- SkewSmileChart` → PASS.

```bash
git status
git commit -m "feat(web): SkewSmileChart — 5-point smile, now vs reference" \
  -- packages/web/src/features/surface/SkewSmileChart.tsx \
     packages/web/src/features/surface/SkewSmileChart.module.css \
     packages/web/src/features/surface/SkewSmileChart.test.tsx
```

---

## Phase 4 — Container rewrite + cleanup

### Task 11: Rewrite `SkewHistory.tsx` (compose children, drop MODE + lightweight-charts)

**Files:**
- Modify (rewrite): `packages/web/src/features/surface/SkewHistory.tsx`
- Modify (rework): `packages/web/src/features/surface/SkewHistory.module.css`

- [ ] **Step 1: Replace `SkewHistory.tsx` entirely**

```tsx
import { useState } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { getTokenLogo } from '@lib/token-meta';
import type { IvTenor } from '@shared/enriched';
import { getHistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import SkewDensityStrip from './SkewDensityStrip';
import SkewSmileChart from './SkewSmileChart';
import {
  buildDistribution,
  buildSkewLineData,
  formatSkewDisplayValue,
  latestSkewDisplayValue,
  pickReferencePoint,
  reconstructSmile,
} from './skew-history-utils';
import styles from './SkewHistory.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const RR_COLOR = '#50d2c1';
const FLY_COLOR = '#f59e0b';
const VS_OPTIONS: { key: string; label: string; days: number | null }[] = [
  { key: '7d', label: '7d ago', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: 'open', label: 'open', days: null },
];

const RR_TIP_BODY = (
  <>
    <div>call25 IV − put25 IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>Negative: puts richer than calls → downside fear (usual in BTC/ETH).</li>
      <li>Positive: calls richer → upside FOMO. Near zero = balanced.</li>
    </ul>
  </>
);
const FLY_TIP_BODY = (
  <>
    <div>(call25 IV + put25 IV) / 2 − ATM IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>High: wings expensive (fat-tail / event premium).</li>
      <li>Low/negative: wings cheap vs body.</li>
    </ul>
  </>
);

function atmPctText(value: number | null): string {
  return value == null || !Number.isFinite(value) ? 'ATM n/a' : `${value.toFixed(1)}% ATM`;
}

function takeaway(rrPct: number | null, flyPct: number | null): string {
  const place = (p: number | null) =>
    p == null ? 'n/a' : p >= 85 ? 'rich' : p <= 15 ? 'cheap' : 'mid-range';
  return `Skew ${place(rrPct)} vs history — RR ${rrPct == null ? '–' : `${Math.round(rrPct)}th`}, Fly ${flyPct == null ? '–' : `${Math.round(flyPct)}th`}.`;
}

interface Props {
  underlying: string;
}

export default function SkewHistory({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const [vsKey, setVsKey] = useState<string>('7d');

  const { data } = useIvHistory(underlying, window);
  const result = data?.tenors[tenor];
  const series = result?.series ?? [];
  const current = result?.current;

  const rrDist = buildDistribution(series, 'rr25d');
  const flyDist = buildDistribution(series, 'bfly25d');

  const nowSmile = current ? reconstructSmile(current) : [];
  const vs = VS_OPTIONS.find((o) => o.key === vsKey) ?? VS_OPTIONS[0]!;
  const refPoint =
    current == null
      ? null
      : vs.days == null
        ? (series[0] ?? null)
        : pickReferencePoint(series, current.ts, vs.days);
  const refSmile = refPoint ? reconstructSmile(refPoint) : null;

  const rrAtm = atmPctText(latestSkewDisplayValue(series, 'rr25d', 'normalized'));
  const flyAtm = atmPctText(latestSkewDisplayValue(series, 'bfly25d', 'normalized'));
  const rrSpark = buildSkewLineData(series, 'rr25d', 'raw');
  const flySpark = buildSkewLineData(series, 'bfly25d', 'raw');

  const coverage = getHistoryCoverage(series, window, ['rr25d', 'bfly25d']);
  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
          {underlying} SKEW
        </span>
        <div className={styles.toggles}>
          <span className={styles.toggleLabel}>TENOR</span>
          <div className={styles.toggleGroup}>
            {TENORS.map((t) => (
              <button key={t} type="button" className={styles.toggleBtn}
                data-active={tenor === t ? 'true' : undefined} onClick={() => setTenor(t)}>{t}</button>
            ))}
          </div>
          <span className={styles.toggleLabel}>WINDOW</span>
          <div className={styles.toggleGroup}>
            {(['30d', '90d'] as IvHistoryWindow[]).map((w) => (
              <button key={w} type="button" className={styles.toggleBtn}
                data-active={window === w ? 'true' : undefined} onClick={() => setWindow(w)}>{w}</button>
            ))}
          </div>
          <span className={styles.toggleLabel}>VS</span>
          <div className={styles.toggleGroup}>
            {VS_OPTIONS.map((o) => (
              <button key={o.key} type="button" className={styles.toggleBtn}
                data-active={vsKey === o.key ? 'true' : undefined} onClick={() => setVsKey(o.key)}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: RR_COLOR }} />
          25Δ RR (call − put)
          <InfoTip label="25Δ RR" title="25Δ Risk-Reversal" align="start">{RR_TIP_BODY}</InfoTip>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: FLY_COLOR }} />
          25Δ Fly (wing − ATM)
          <InfoTip label="25Δ Fly" title="25Δ Butterfly" align="start">{FLY_TIP_BODY}</InfoTip>
        </span>
      </div>

      <SkewDensityStrip label="25Δ RR" color={RR_COLOR} distribution={rrDist} atmText={rrAtm} spark={rrSpark} />
      <SkewDensityStrip label="25Δ Fly" color={FLY_COLOR} distribution={flyDist} atmText={flyAtm} spark={flySpark} />

      <SkewSmileChart now={nowSmile} reference={refSmile} referenceLabel={vs.label} />

      <div className={styles.foot}>
        <span className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>{coverage.label}</span>
        <span className={styles.takeaway}>
          {takeaway(result?.rrPercentile ?? null, result?.flyPercentile ?? null)}
        </span>
      </div>
    </div>
  );
}
```

Note: `formatSkewDisplayValue` is imported because `latestSkewDisplayValue`/`buildSkewLineData` live in the same module; if biome flags `formatSkewDisplayValue` as unused, remove it from the import. (It is not used in this file — **remove it from the import list** to avoid an unused-import lint error.)

- [ ] **Step 2: Rework `SkewHistory.module.css`**

Keep `.wrap`, `.header`, `.title`, `.tokenLogo`, `.toggles`, `.toggleLabel`, `.toggleGroup`, `.toggleBtn`, `.legend`, `.legendItem`, `.legendSwatch` as they are. Replace the chart-area / mini-chart / takeaway / modeGuide rules with:

```css
.foot {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid #15191d;
  font-family: 'IBM Plex Mono', monospace;
}
.coverage { font-size: 9px; color: #4b5560; }
.coverage[data-short='true'] { color: #f59e0b; }
.takeaway { font-size: 11px; color: #aeb6bc; }
```

Delete the now-unused `.chartArea`, `.chartStack`, `.chartWrap`, `.chartCanvas`, `.miniChart`, `.metricHeader`, `.metricMeta`, `.metricRow`, `.metricName`, `.metricBadge`, `.metricInsight`, `.metricValue`, `.empty`, `.modeGuide*` rules.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS (the old `SkewHistory.test.tsx` may fail at test-run, fixed next task; typecheck of source should pass).

- [ ] **Step 4: Commit**

```bash
git status
git commit -m "feat(web): rewrite SkewHistory — density strips + smile, drop MODE" \
  -- packages/web/src/features/surface/SkewHistory.tsx packages/web/src/features/surface/SkewHistory.module.css
```

---

### Task 12: Rewrite `SkewHistory.test.tsx`

**Files:**
- Modify (rewrite): `packages/web/src/features/surface/SkewHistory.test.tsx`

- [ ] **Step 1: Replace the test (no lightweight-charts mock; assert new UI)**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkewHistory from './SkewHistory';

vi.mock('@lib/token-meta', () => ({ getTokenLogo: () => null }));

const series30 = Array.from({ length: 6 }, (_, i) => ({
  ts: (i + 1) * 86_400_000,
  atmIv: 0.4,
  rr25d: -0.08 + i * 0.008,
  bfly25d: 0.01 + i * 0.001,
  rr10d: -0.12 + i * 0.01,
  bfly10d: 0.03 + i * 0.001,
}));

vi.mock('./queries', () => ({
  useIvHistory: () => ({
    data: {
      underlying: 'BTC',
      windowDays: 30,
      tenors: {
        '7d': { series: [], current: null, min: {}, max: {} },
        '30d': {
          series: series30,
          current: series30[series30.length - 1],
          rrPercentile: 56,
          flyPercentile: 60,
          min: {}, max: {},
        },
        '60d': { series: [], current: null, min: {}, max: {} },
        '90d': { series: [], current: null, min: {}, max: {} },
      },
    },
  }),
}));

describe('SkewHistory', () => {
  it('renders density strips, smile, and controls; no MODE toggle', () => {
    render(<SkewHistory underlying="BTC" />);
    expect(screen.getByText('BTC SKEW')).toBeTruthy();
    // TENOR / WINDOW / VS controls exist
    expect(screen.getByRole('button', { name: '7d ago' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '90d' })).toBeTruthy();
    // MODE toggle is gone
    expect(screen.queryByRole('button', { name: 'Normalized' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Z-Score' })).toBeNull();
    // both metric strips render
    expect(screen.getByText('25Δ RR')).toBeTruthy();
    expect(screen.getByText('25Δ Fly')).toBeTruthy();
    // percentile from API shows in the takeaway
    expect(screen.getByText(/56th/)).toBeTruthy();
    // smile labels present (5-point — wings reconstructed from rr10d/bfly10d)
    expect(screen.getByText('10Δp')).toBeTruthy();
    expect(screen.getByText('ATM')).toBeTruthy();
  });

  it('switches the VS reference label on the smile caption', () => {
    render(<SkewHistory underlying="BTC" />);
    expect(screen.getByText(/faded = 7d ago/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByText(/faded = open/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run (expected PASS)**

Run: `pnpm --filter @oggregator/web test:run -- SkewHistory`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git status
git commit -m "test(web): rewrite SkewHistory test for redesigned panel" \
  -- packages/web/src/features/surface/SkewHistory.test.tsx
```

---

### Task 13: Remove dead `referenceLines` util + its test

**Files:**
- Modify: `packages/web/src/features/surface/skew-history-utils.ts` (remove `referenceLines`, `SkewReferenceLine`)
- Modify: `packages/web/src/features/surface/skew-history-utils.test.ts` (remove the `referenceLines` assertion)

- [ ] **Step 1: Confirm no other importers**

Run: `rg -n "referenceLines|SkewReferenceLine" packages/web/src`
Expected: only `skew-history-utils.ts` (definition) and `skew-history-utils.test.ts`. If anything else imports them, STOP and reassess.

- [ ] **Step 2: Delete `referenceLines` + `SkewReferenceLine`**

Remove the `SkewReferenceLine` interface and the `referenceLines` function from `skew-history-utils.ts`. In `skew-history-utils.test.ts`, delete the import of `referenceLines` and the `it('reference lines vary by mode', ...)` test.

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @oggregator/web test:run -- skew-history-utils`
Expected: PASS.
Run: `pnpm --filter @oggregator/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git status
git commit -m "chore(web): drop dead referenceLines util (lightweight-charts era)" \
  -- packages/web/src/features/surface/skew-history-utils.ts packages/web/src/features/surface/skew-history-utils.test.ts
```

---

## Phase 5 — Full verification + deploy

### Task 14: Full suite + lint + build

**Files:** none

- [ ] **Step 1: Core tests + typecheck**

Run: `pnpm --filter @oggregator/core test:run && pnpm --filter @oggregator/core typecheck`
Expected: PASS.

- [ ] **Step 2: Web tests + typecheck + lint**

Run: `pnpm --filter @oggregator/web test:run && pnpm --filter @oggregator/web typecheck`
Expected: PASS. Then run the repo lint (biome) per project config; fix any `noArrayIndexKey`/unused-import findings in the new files (the components use stable keys: metric label, delta label, iv grid value).

- [ ] **Step 3: Web build**

Run: `pnpm --filter @oggregator/web build`
Expected: PASS (`tsc --noEmit && vite build`).

- [ ] **Step 4: Manual smoke (dev)**

Run: `pnpm --filter @oggregator/web dev` and open the Volatility tab → SKEW panel for BTC and ETH. Verify: density strips show a marker mid-range for BTC RR; smile draws now (solid) + faded reference; TENOR/WINDOW/VS switch; no console errors; the panel reads in roughly the height of the old one. (10Δ wings on the *now* curve appear only once the server is running the new snapshot build; before that the now-curve renders 3-point — expected.)

- [ ] **Step 5: No commit** — verification only.

---

### Task 15: Deploy checklist (operator)

**Files:** none — this is a runbook, not code.

- [ ] **Step 1: Apply migration 0018** against the production Postgres (`pnpm db:migrate` or the project's migration runner) BEFORE deploying the new server build, so the `INSERT` with `rr10d`/`bfly10d` columns succeeds.
- [ ] **Step 2: Manual Scaleway redeploy** of the `api.oggregator.xyz` Fastify service (per repo deploy process: rebuild `@oggregator/core` dist + restart the systemd unit) so the snapshot loop starts writing 10Δ wings.
- [ ] **Step 3: Web** ships via Vercel on push/merge of the branch.
- [ ] **Step 4: Verify** `/api/iv-history?underlying=BTC&window=30d` returns `rr10d`/`bfly10d` on `current` (non-null once a snapshot has run) and that historical series entries carry `null` wings until the window accumulates.

---

## Self-Review

**1. Spec coverage:**
- Stacked layout, MODE removed, TENOR/WINDOW/VS controls → Task 11. ✓
- Hero density strip (verdict line σ/zone/pct/vp/%ATM + sparkline, % -below fill, ±1σ, robust range, cheap/rich ends) → Tasks 8 (data) + 9 (component). ✓
- 5-point smile, now vs faded reference, 3-point fallback → Tasks 6 (reconstruct, returns 3 or 5) + 7 (reference pick) + 10 (component). ✓
- Backend additive `rr10d`/`bfly10d`, existing contract untouched → Tasks 1–3. ✓
- Persistence migration (columnar confirmed) → Task 3. ✓
- Bespoke SVG, drop lightweight-charts from panel → Tasks 9, 10, 11, 13. ✓
- Tests for utils + components + container → Tasks 6–13. ✓
- Edge cases: <2 points → `buildDistribution` null + strip "insufficient"; null atm/rr/fly filtered; 10Δ missing → 3-point smile; robust clamp; cold start (rr/fly null) → strips insufficient, smile shows ATM-only. ✓
- Rollout/deploy + Scaleway → Tasks 4, 14, 15. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:** `IvHistoryPoint` (+`rr10d`/`bfly10d`) consistent across core, db (`PersistedIvHistoryPoint`), web. `SmilePoint{x,iv,label}`, `SkewDistribution`, `buildDistribution`, `reconstructSmile`, `pickReferencePoint` names match between definition (Tasks 6–8) and consumers (Tasks 9–11). `SkewDensityStrip` props `{label,color,distribution,atmText,spark}` match test (Task 9) and container (Task 11). `SkewSmileChart` props `{now,reference,referenceLabel}` match test (Task 10) and container (Task 11). ✓

**Deferred (per spec):** 5-point historical wings accrue forward only; `%ATM` kept in verdict (trim later if heavy); 10Δ percentile/z-score not surfaced in v1.
