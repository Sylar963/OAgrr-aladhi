# Builder V2 Chart — Ghost-Candle Projection Paths + Snapshots

- **Date:** 2026-06-11
- **Status:** Draft (awaiting user review)
- **Branch:** `feat/builder-v3-tenor-axis`
- **Surface:** `packages/web` — Architect (Builder) feature, **V2 candle chart only** (`PayoffChartV2.tsx`). V3 ladder untouched.

## 1. Summary

Overlay three **ghost-candle projection paths** on the V2 candle chart that extend from "now" out to the structure's nearest expiry, illustrating the three price scenarios a trader cares about and what each does to the open structure's P&L:

- **Up move** (+1σ) · **Down move** (−1σ) · **Flat (θ)** (spot unchanged)

Each path is **auto-colored by its own at-expiry P&L** — green = that scenario makes money, red = it loses money. The flat path is always θ; **its color is the buy-vol vs sell-vol tell** (long-vol bleeds → red, short-vol earns premium → green). The paths are always three distinct glides — nothing merges.

Additionally, a **Snapshot** capability pins the current projection locally so the user can return later and see how price *actually* moved against the three projected paths (re-overlaid on the live chart, anchored at the snapshot's original time).

This is a **client-only, additive** feature: no server, no WebSocket, no new dependencies. It reuses the existing payoff math (`payoff.ts`) and the existing candle data already on the chart.

## 2. Motivation

The V2 chart currently shows historical price + break-even lines + profit/loss zones. It tells you *where* the structure profits, but not *what move gets you there* or *what time decay costs you if nothing happens*. The three paths make the directional and theta consequences legible at a glance, in price space, on the same chart. Snapshots turn it into a lightweight forward-test: "here's what I projected, here's what happened."

## 3. The model (final)

For legs `L`, current spot `S₀`, nearest-expiry horizon `Tₑ` (ms), and the structure's representative implied vol `σᵢᵥ`:

### 3.1 Expected-move band

- `T_years = max(0, (Tₑ − anchorBarTimeMs) / MS_PER_YEAR)`
- `σᵢᵥ` = mean of `leg.iv` over legs where `iv != null`; fallback `DEFAULT_IV = 0.6` if all null. (IV is already on each `Leg`.)
- `σ_move = S₀ × σᵢᵥ × √T_years`
- `bandHalf = max(σ_move, S₀ × MIN_BAND_PCT)` — `MIN_BAND_PCT = 0.015` is a **visibility floor** so near-expiry paths don't collapse onto θ. It widens the path spread only; it never changes a path's P&L sign.
- `upTarget = S₀ + bandHalf` · `downTarget = max(ε, S₀ − bandHalf)`

### 3.2 The three paths

| Path  | Target price        | P&L (at expiry)                  | Color rule            |
|-------|---------------------|----------------------------------|-----------------------|
| up    | `upTarget`          | `pnlAtPrice(L, upTarget)`         | `pnl ≥ 0` → green, else red |
| down  | `downTarget`        | `pnlAtPrice(L, downTarget)`       | `pnl ≥ 0` → green, else red |
| theta | `S₀` (flat)         | `pnlAtPrice(L, S₀)`               | `pnl ≥ 0` → green, else red |

`pnlAtPrice` is the existing pure at-expiry intrinsic P&L. This single rule reproduces every case discussed:

- **Long call** → up green, down red, θ red (paying decay)
- **Long straddle** → up green, down green, θ red (loses only by not moving)
- **Short strangle** → up red, down red, θ green (earns premium by staying in range)

No per-strategy special-casing; the buy/sell-vol flip falls out of the θ-path sign.

### 3.3 Ghost-candle geometry (illustrative glide, not a forecast)

Each path is rendered as a faint synthetic candlestick walk from `S₀` (at `anchorMs`) to its `targetPrice` (at `Tₑ`):

- Future bar times: `tᵢ = anchorBarTime + i × resolutionSec`, `i = 1..M`, until `tᵢ ≥ Tₑ`. `anchorBarTime` = the last real candle's bucket time (grid-aligned). Safety clamp `M ≤ MAX_PROJECTION_BARS = 1000` (typical M is 100–300).
- Linear price glide: `price(tᵢ) = S₀ + (targetPrice − S₀) × (tᵢ − anchorBarTime) / (Tₑ − anchorBarTime)`
- Candle `i`: `open = price(tᵢ₋₁)` (i=1 → `S₀`), `close = price(tᵢ)`, `high = max(open,close) + wick`, `low = min(open,close) − wick`, with `wick = max(S₀ × WICK_PCT, |close−open| × WICK_BODY_FRAC)` (`WICK_PCT = 0.0005`, `WICK_BODY_FRAC = 0.15`). The `WICK_PCT` floor gives the flat θ candles a visible sliver.

The glide is deliberately straight — these are **scenario illustrations, not predictions**. This is stated in code comments and the legend so the candles don't imply forecast precision.

## 4. Architecture & components

### 4.1 New pure module — `packages/web/src/features/architect/ghost-paths.ts`

```ts
export type GhostPathKind = 'up' | 'down' | 'theta';

export interface GhostPath {
  kind: GhostPathKind;
  isProfit: boolean;        // green vs red
  targetPrice: number;      // terminal price at expiry (theta: S₀)
  pnlAtExpiry: number;      // P&L if price ends at targetPrice
  candles: SpotCandle[];    // synthetic future OHLC, ascending by timestamp (ms)
}

export function computeGhostPaths(
  legs: Leg[],
  spotPrice: number,
  horizonExpiryMs: number,
  anchorBarTimeMs: number,
  resolutionSec: number,
): GhostPath[];              // [] when legs empty / inputs invalid

// Geometry helper, reused for snapshot replay:
export function buildPathCandles(
  spot: number, target: number,
  anchorBarTimeMs: number, expiryMs: number, resolutionSec: number,
): SpotCandle[];
```

Pure, no React, no stores, no network → fully unit-testable. Depends only on `payoff.ts` (`pnlAtPrice`, `Leg`) and `SpotCandle`.

### 4.2 Snapshot store — `packages/web/src/features/architect/snapshots-store.ts`

`localStorage`-backed (key `oggregator.architect.ghostSnapshots`), zod-parsed on read so corrupt/old entries are dropped rather than thrown.

```ts
interface GhostSnapshot {
  id: string;                 // crypto.randomUUID()
  createdAt: number;          // = anchorBarTimeMs (the projection's "now")
  underlying: string;         // 'BTC' | 'ETH' | 'HYPE'
  structureLabel: string;     // detectStrategy(legs)
  spotAtSnapshot: number;
  expiryMs: number;
  resolutionSec: number;
  paths: { kind: GhostPathKind; isProfit: boolean; targetPrice: number; pnlAtExpiry: number }[];
}
```

API: `listSnapshots(underlying?)`, `addSnapshot(s)`, `removeSnapshot(id)`, `clearSnapshots()`. Cap at `MAX_SNAPSHOTS = 50` (drop oldest). Candle arrays are **not** stored — replay rebuilds them via `buildPathCandles(spotAtSnapshot, targetPrice, createdAt, expiryMs, resolutionSec)`, keeping storage to a few KB.

### 4.3 Rendering — `PayoffChartV2.tsx` (lightweight-charts 5.1.0)

- New props: `ghostPaths: GhostPath[]`, `showProjections: boolean`, `snapshotMode?: { agoLabel: string } | null` (for legend text).
- Maintain a ref array of up to **three ghost `Candlestick` series**. A `useEffect` keyed on `[ghostPaths, showProjections]` removes and recreates them from `ghostPaths[].candles`.
- Per-series styling sets `upColor = downColor = borderUpColor = borderDownColor = wickUpColor = wickDownColor` to the path color with alpha — so each series is a single flat color regardless of bar direction:
  - green `rgba(0,233,151,a)`, red `rgba(203,56,85,a)`; body `a≈0.30`, border `a≈0.55`; θ uses lower body alpha (`≈0.18`). `priceLineVisible:false`, `lastValueVisible:false`.
- **Time units:** ghost candle `time` is emitted in UNIX **seconds** to match the main series (`Math.floor(timestamp / 1000)`); mixing seconds and ms silently breaks the shared time scale.
- **Axis extension into the future:** the ghost series carry OHLC at future timestamps, and lightweight-charts unions all series' times, so the time scale extends to `Tₑ` automatically. **Fallback** (per the known cone gotcha where `timeToCoordinate` returns null for times no series covers): if extension misbehaves, add whitespace bars (`{ time }`) to the main series from the last real bar to `Tₑ`. The first implementation step validates which is needed (see §8).
- **Viewport:** reuse the existing "fresh window" guard. When projections toggle on (or window is fresh), call `timeScale().fitContent()` so the future region is in view; otherwise preserve the user's zoom/pan (unchanged behavior).
- **Legend overlay:** a small absolutely-positioned React element (top-left of the chart frame) with three rows — color swatch + `↑ +$X` / `↓ −$Y` / `θ ±$Z` (formatted via existing `fmtUsd`), plus a "snapshot · {agoLabel}" tag when a snapshot is active. No new horizontal price lines (avoids cluttering the existing BE/spot lines).

### 4.4 Wiring — `ArchitectView.tsx`

- **Live paths:** `useMemo(() => computeGhostPaths(pricedLegs, spotPrice, nearestExpiryMs, anchorBarTimeMs, candleSpec.resolutionSec), [...])`. `anchorBarTimeMs` = last real candle's timestamp (grid-aligned, deterministic). `nearestExpiryMs` = nearest leg's expiry parsed at 08:00 UTC (same convention as `dteDays`).
- **State:** `showProjections` (`useState(true)`), `selectedSnapshotId` (`useState<string|null>(null)`).
- **Active projection:** if a snapshot is selected, rebuild its `GhostPath[]` (via `buildPathCandles` per stored path) anchored at its `createdAt`; otherwise use the live paths. Pass the active set to `PayoffChartV2`.
- **Controls** (near the existing `{rangeLabel} window · …` status line): a **Projections** toggle, a **Snapshot** button (captures current live paths → `addSnapshot`), and a **snapshots dropdown** (list with time-ago + structure + spot-then; select to overlay, × to return to live, trash to delete). New CSS classes in `Architect.module.css` (additive).

## 5. Data flow

```
pricedLegs / spot / nearest expiry / resolution / last-bar time
        │
        ▼
computeGhostPaths()  ──►  GhostPath[] (live)        ┐
                                                    ├─► active set ─► PayoffChartV2 ─► 3 ghost candlestick series + legend
selected snapshot ─► buildPathCandles() ─► GhostPath[] (replay) ┘

Snapshot button ─► addSnapshot(localStorage)  ◄─►  snapshots dropdown
```

## 6. Edge cases & error handling

- **No legs / unpriced** → `computeGhostPaths` returns `[]`; chart renders normally with no paths.
- **Unsupported underlying (SOL)** → V2 already shows its empty state; no candles, no paths.
- **Unbounded P&L** (long call/straddle) → bounded by the ±1σ band, never off-scale.
- **Near-expiry** (`T_years → 0`) → `MIN_BAND_PCT` floor keeps three visible paths.
- **Missing IV on all legs** → `DEFAULT_IV` fallback; paths still render.
- **Snapshot older than the visible lookback window** → its anchor predates the first real candle; render the paths from the window start and tag the legend "snapshot predates visible history." (With the new 3× lookback — up to ~540 days — most snapshots fall inside the window.)
- **Snapshot resolution ≠ current window resolution** → snapshot rebuilds candles at its own stored `resolutionSec`; absolute timestamps still place them correctly (minor cosmetic cadence mismatch is acceptable).
- **localStorage unavailable / quota** → store degrades to in-memory for the session; capture still works until reload, surfaced as a non-blocking toast/log.

## 7. Testing strategy

- **`ghost-paths.test.ts`** (pure):
  - long call → up green, down red, θ red; targets at `S₀ ± bandHalf`.
  - long straddle → up green, down green, θ red.
  - short strangle → up red, down red, θ green.
  - short call → up red, down green, θ green (sanity).
  - θ color flips with vol side (long-vega red, short-vega green).
  - band cap: long-call up target ≈ `S₀(1+σᵢᵥ√T)`, not unbounded.
  - candles: ascending timestamps, first `open == S₀`, last `close ≈ target`, θ candles flat (`open ≈ close`) with non-zero wick.
  - empty legs → `[]`; all-null IV → fallback path still produced; near-expiry → floor applied.
- **`snapshots-store.test.ts`** (mock `localStorage`): add/list/remove/clear; zod rejects corrupt rows; `MAX_SNAPSHOTS` eviction (oldest dropped); `buildPathCandles` round-trips a stored path back to the same geometry.
- **Render:** keep light — lightweight-charts is constrained under jsdom (see web Vitest gotchas). Logic lives in the pure modules; a minimal mount test asserts the component renders with `ghostPaths` set and doesn't throw when toggled. No canvas assertions.

## 8. Scope, non-goals, risks

**In scope:** V2 chart paths + local snapshot/overlay; additive UI controls.

**Non-goals:** V3 ladder changes; server/WS/persistence beyond `localStorage`; PNG export (explicitly deferred — user chose data overlay); probabilistic/forecast modeling; multi-expiry exact handling (projects to the **nearest** expiry).

**Primary risk / first implementation step:** confirm lightweight-charts 5.1.0 extends the time axis from future-only ghost-series points (multi-`CandlestickSeries`), and that ghost candles place correctly. If not, fall back to explicit whitespace bars on the main series (the documented EM-cone mechanism). This spike gates the rest of the rendering work.

## 9. Constants (tunable, centralized in `ghost-paths.ts`)

`SIGMA_MULTIPLE = 1` · `MIN_BAND_PCT = 0.015` · `DEFAULT_IV = 0.6` · `WICK_PCT = 0.0005` · `WICK_BODY_FRAC = 0.15` · `MAX_PROJECTION_BARS = 1000` · `MAX_SNAPSHOTS = 50`.
