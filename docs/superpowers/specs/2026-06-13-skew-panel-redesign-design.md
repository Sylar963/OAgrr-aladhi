# Skew Panel Redesign — Design Spec

**Date:** 2026-06-13
**Feature:** `BTC/ETH SKEW` panel (`packages/web/src/features/surface/SkewHistory.tsx`)
**Status:** Design approved (brainstorming), pending plan + implementation

---

## 1. Problem

The current panel renders 25Δ Risk-Reversal (RR) and 25Δ Butterfly (Fly) as two
stacked time-series line charts with a Normalized / Z-Score / Raw mode toggle, a
30d/90d window, and a 7/30/60/90d tenor. In practice it doesn't communicate:

1. **Slow scalar as a time-series is the weakest encoding.** RR/Fly drift slowly;
   over 30d the line looks flat and answers only "which way is it moving?" — the
   least useful of the three trader questions.
2. **The context bands sabotage the line.** In `SkewMiniChart`, normalized mode
   adds `BaselineSeries` bands at ±5/±10; lightweight-charts auto-scales the price
   axis to include them, so a line varying in a ~3-unit range occupies ~12% of the
   panel and reads as flat.
3. **24-state space, no payoff.** mode(3) × window(2) × tenor(4). Switching MODE
   only re-labels the same flat line (normalized/raw are the same shape, different
   divisor); only z-score changes what you see — which is why it's the only
   "usable" mode, and even that is an overlay rather than a position-in-distribution.
4. **RR and Fly are split into two charts** when together they *are* the skew
   curve (RR = tilt, Fly = wing-lift). The most intuitive options view — the smile
   itself — is absent.
5. **Inverted text-to-signal ratio.** legend + coverage + takeaway + modeGuide
   (title+text) + per-metric insight + value + percentile, with phrases repeated
   across blocks. More prose than legible chart.

The data and backend (`interpTenor`, percentile, z-score) are sound. The defect is
purely the **visual encoding**: it leads with *trend* instead of *context* and *shape*.

## 2. Goal & non-goals

**Goal:** Make the panel answer, at a glance: (a) *is skew rich or cheap vs its own
history right now?* (context, hero) and (b) *what does the smile look like and how
is it shifting?* (shape, support).

**Non-goals / constraints:**
- **No data reduction.** This adds data (10Δ wings); it never drops series or coverage.
- **Protect existing functionality.** The `atmIv`/`rr25d`/`bfly25d` pipeline,
  percentile/z-score math, persistence, and `/api/iv-history` contract stay
  byte-compatible. New fields are strictly additive.
- **Ground in existing patterns.** Reuse the delta-axis conventions and labels from
  `smile-utils.ts` (`deltaTickLabel`, OTM put-left/call-right), the chart theme
  colors, and the existing percentile/z-score logic.
- **Surgical scope.** No unrelated refactors. Touch the skew feature + the one
  backend snapshot field add.

## 3. Layout (approved: **stacked**)

A single vertical panel per underlying, replacing the two-chart stack:

```
┌ BTC SKEW · logo ······ TENOR 7d [30d] 60d 90d · WINDOW [30d] 90d ┐
│ 25Δ RR  +0.1σ [NORMAL]  56th · −6.0vp · −14.9%ATM      ╱╲╱ spark  │
│ [══ density strip: distribution + %-below fill + ±1σ + now mark ═]│
│  cheap −9.0                                          rich −3.0     │
│ 25Δ Fly +0.2σ [NORMAL]  55th · +1.5vp · +3.7%ATM      ╱╲╱ spark   │
│ [══ density strip ════════════════════════════════════════════]   │
│  cheap +0.2                                          rich +2.8     │
│ ─────────────────────────────────────────────────────────────    │
│           5-point smile (full width)   VS [7d] 30d open           │
│  IV%┤  ●╲                                          ╱●              │
│     │    ●╲___________●__________●___                              │
│     └ 10Δp  25Δp     ATM     25Δc   10Δc                          │
│  solid = now · faded = reference · tilt = RR · lift = Fly          │
│ coverage 30d/30d · "Skew mid-range — nothing stretched to fade."  │
└───────────────────────────────────────────────────────────────────┘
```

The **MODE toggle is removed.** Its three views collapse into the verdict line
(`σ` = z-score, `percentile` = normalized-vs-history, `vp` = raw, `%ATM` =
normalized). State space drops from 24 → 8 (tenor × window). The smile gains a
small **VS** reference toggle (7d / 30d / window-open).

## 4. Components (designed for isolation)

### 4.1 `SkewDensityStrip` (new, presentational SVG)
**Does:** Renders one metric's "rich/cheap vs history" hero row.
**Props:** `{ label, color, sigma, zone, percentile, rawVp, pctAtm, distribution, nowPos, sigmaTicks, rangeLabels, spark }`.
**Encoding:**
- Verdict line: name · `σ` · zone chip (`NORMAL`/`STRETCHED`/`EXTREME`) · `{pct}th · {vp}vp · {%}%ATM` · sparkline.
- Horizontal density curve = the window distribution of the metric. **Brighter fill
  left of the now-marker = % of history below today** (the percentile, made spatial).
  Dashed verticals at ±1σ. Tinted cheap/rich ends.
- Now-marker at the current value's position, **x-axis linear in value, clamped to a
  robust range** (≈2nd–98th window percentile) so a single outlier can't squash the curve.
**Depends on:** nothing (pure SVG + props). Fully testable in jsdom (real DOM, no canvas mock).

### 4.2 `SkewSmileChart` (new, presentational SVG)
**Does:** Renders the constant-maturity smile, now vs a faded reference.
**Props:** `{ nowPoints, refPoints, refLabel, atmAxis }` where points are
`{ x: deltaPos, iv }` over 10Δp/25Δp/ATM/25Δc/10Δc.
**Encoding:** solid polyline+dots for now, faded dashed for the reference; IV% grid
labels on the left; delta labels on the bottom (reuse `deltaTickLabel` semantics:
put-left, call-right). Tilt visualizes RR, wing-lift visualizes Fly.
**Fallback:** if a curve has no 10Δ data (historical reference before wings
accumulate), it renders as a 3-point (25Δp/ATM/25Δc) curve — graceful, not blank.
**Depends on:** nothing (pure SVG + props).

### 4.3 `SkewHistory` (container, rewritten render)
**Does:** Fetches `useIvHistory(underlying, window)`, owns TENOR/WINDOW/VS state,
derives props for the two children, renders header + strips + smile + one takeaway +
coverage badge. Drops all lightweight-charts usage and the MODE toggle.
**Depends on:** `queries.useIvHistory`, `skew-history-utils`, the two new components.

### 4.4 `skew-history-utils.ts` (extended, pure)
New pure helpers (unit-tested), reusing existing logic where present:
- `reconstructSmile(point)` → `{ put10, put25, atm, call25, call10 }` IV values:
  `call25 = atm + bfly25 + rr25/2`, `put25 = atm + bfly25 − rr25/2`, and likewise
  for 10Δ using `rr10d`/`bfly10d` when present (else 10Δ entries are null → 3-pt).
- `buildDistribution(series, key, window)` → `{ bins, nowValue, percentile, sigma,
  zone, mean, stddev, robustRange:[lo,hi], min, max }`. Reuses the z-score math
  already in `buildSkewLineData` and the zone thresholds in `zoneFor`.
- Keep `formatSkewDisplayValue` family for the verdict line (vp / %ATM / σ).

## 5. Data & backend changes

### 5.1 Backend — add 10Δ wings to the snapshot (additive)
`packages/core/src/services/iv-history.ts` → `snapshotOnce()` already calls
`interpTenor(surfaces, tenorDays, 'delta25c'|'delta25p'|'atm')`. Add `'delta10c'`
and `'delta10p'` (both already supported by `interpTenor`) and compute, per the
existing RR/Fly pattern:
- `rr10d = call10Iv − put10Iv`
- `bfly10d = (call10Iv + put10Iv) / 2 − atmIv`

Store `rr10d`/`bfly10d` on each `IvHistoryPoint` (consistent with the existing
difference-based storage; reconstructable into absolute 10Δ IVs on the client).

### 5.2 Types (manually synced — see web CLAUDE.md)
Extend in **both** `packages/core/src/core/enrichment.ts` and
`packages/web/src/shared-types/enriched.ts`:
- `IvHistoryPoint += { rr10d: number | null; bfly10d: number | null }`
- `IvHistoryExtrema += { rr10d; bfly10d }` (for min/max symmetry; optional).

### 5.3 Persistence
The in-memory ring buffer needs no schema. For `PostgresIvHistoryStore`: if points
persist as discrete columns, add a migration for `rr10d`/`bfly10d` (nullable); if
points persist as JSON, the change is additive. **Confirm the store shape during
planning.** Either way, historical rows backfill as `null` → the smile reference
falls back to 3-point until the window accumulates live 10Δ snapshots.

### 5.4 Data-availability caveat (accepted)
The **now** smile gets wings immediately (live snapshot). The **faded reference**
curve stays 25Δ-only until ~the chosen VS horizon of new 10Δ data has accrued; the
fallback above handles this without a visual gap. No historical 10Δ backfill is
possible (same constraint as the original DVOL seed).

## 6. Rendering decision

Replace lightweight-charts in this panel with **bespoke React SVG** for both the
density strip and the smile. Rationale: both are small fixed-point custom marks
(distribution + markers; 5-point overlay) that lightweight-charts models poorly (the
current code abuses `BaselineSeries`/`time` axes to fake them). SVG is simpler, fully
controllable, and **testable in jsdom against real DOM** (the current test must mock
the charting lib). lightweight-charts remains a dependency for other features.

## 7. Testing

- `skew-history-utils.test.ts` (extend): `reconstructSmile` (25Δ-only and with 10Δ;
  null handling), `buildDistribution` (percentile, σ, zone, robust-range clamp,
  <2-point insufficiency → nulls), formatter outputs.
- `SkewDensityStrip.test.tsx` (new): renders verdict line + strip; zone chip class;
  marker position; "insufficient data" path.
- `SkewSmileChart.test.tsx` (new): 5-point now + 3-point fallback reference; labels.
- `SkewHistory.test.tsx` (rewrite): MODE toggle gone; TENOR/WINDOW/VS switch; renders
  both strips + smile; null/sparse series degrade gracefully. (Drop the lightweight-
  charts mock.)
- Core: extend `iv-history` test coverage for `rr10d`/`bfly10d` population +
  null-safety when 10Δ interpolation returns null.

## 8. Edge cases

- Insufficient history (<2 valid points): strip shows "insufficient", verdict shows
  "–", percentile/σ null (existing `rankAndPercentile` already returns null < 2).
- `atmIv`/`rr`/`fly` null at a point: excluded from distribution and smile (existing
  filtering pattern).
- 10Δ interpolation null (thin wings on some venues/tenors): smile renders 3-point;
  `rr10d`/`bfly10d` stored null.
- Outliers: robust-range clamp on the density x-axis.
- Cold start: `seedFromDvol` provides ATM only (rr/fly null) → strips show
  insufficient, smile shows ATM dot — no crash.
- Sub-window coverage: keep the existing `getHistoryCoverage` badge + `short` flag.
- BTC vs ETH: identical; ETH typically sits higher in its RR range (validates the
  hero's purpose).

## 9. Files touched

**Web:** `SkewHistory.tsx` (rewrite render), `skew-history-utils.ts` (extend),
`SkewHistory.module.css` (rework), new `SkewDensityStrip.tsx`(+css),
`SkewSmileChart.tsx`(+css), `shared-types/enriched.ts`; tests as above.
**Core:** `services/iv-history.ts` (snapshot + extrema), `core/enrichment.ts`
(types + any `IvHistory*` shaping), `services/iv-history` persistence/store; tests.

## 10. Rollout

- Backend field add is additive and backward-compatible; FE renders wings when
  present, else 25Δ.
- Sequence: extend core types → snapshot → rebuild `@oggregator/core` (server runs
  from `dist/`) → sync web shared-types → FE components → tests green.
- Branch: `feat/skew-panel-redesign` (contained single-feature work, main checkout —
  no worktree).
- Deploy: SPA via Vercel; the `api.oggregator.xyz` Fastify service needs a **manual
  Scaleway redeploy** for the new snapshot fields. (Migration first if columnar.)

## 11. Deferred

- 5-point **historical** wings (impossible to backfill; accrues forward only).
- VS default horizon (start at 7d).
- Optional later: %ATM toggle in the verdict line if it reads heavy; 10Δ percentile/
  z-score (data now available, but not surfaced in v1).
