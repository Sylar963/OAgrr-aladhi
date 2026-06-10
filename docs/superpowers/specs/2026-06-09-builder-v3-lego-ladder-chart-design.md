# Builder V3 — "Lego Ladder" payoff chart (design)

- **Status:** Approved design, pre-plan
- **Date:** 2026-06-09
- **Author:** brainstormed with Sylar963
- **Scope:** Frontend only. The "better simulation engine for challenges" is a **separate** spec, deferred.

---

## 1. Summary

A third, fully custom payoff renderer for the Builder (`features/architect`), mounted as a new `variant: 'v3'` alongside V1 (canvas hockey-stick) and V2 (lightweight-charts candles). It is **not** expressible in lightweight-charts: it rotates the payoff into a **vertical price ladder** and represents each option leg as a **lego block** whose edges encode its break-even, with the net profit/loss painted as a green/red background wash. Building is done **on the ladder** — click a strike rung to drop a block, drag a block to retune its strike. The feel is game-like, with the interaction budget concentrated on hovers, implemented entirely in **SVG/DOM + CSS** (no new dependencies, no animation library).

It consumes the exact props ArchitectView already computes for V1/V2 (`payoffPoints`, `metrics`, `spotPrice`, `pricedLegs`, `availableStrikes`) and the pure math in `payoff.ts` — **no changes to the payoff math, the store shape, V1, V2, or any WS/transport code.**

---

## 2. Goals / Non-goals

### Goals
- A distinctive, "lego on a price ladder" payoff view that reads at a glance: what legs, where the break-evens are, am I winning.
- Build/tune a multi-leg trade directly on the ladder (constructor-lite).
- Game-like micro-interactions, hover-first, CSS-driven.
- Fully testable (SVG output + extracted pure geometry helpers) — a deliberate improvement over V1's untestable canvas.
- Zero regression risk to V1/V2, the chain feed, and the strategy store.

### Non-goals (this spec)
- The challenge simulation engine (separate spec).
- Replacing V1 or V2 — V3 is additive, selectable via the existing variant toggle.
- A time/candle axis (that is V2). The V3 axis is **price**, not time.
- Multi-expiry on one ladder — legs are assumed at-expiry like the existing payoff math.
- Real order-execution changes — placement still flows through the existing store → order-mapper path unchanged.
- The two "flavor" animations (ambient win/loss glow, focus-dim spotlight) and full palette drag-and-drop (interaction model "C") — see §12 Future.

---

## 3. Where it lives

| Concern | File | Change |
|---|---|---|
| New renderer | `packages/web/src/features/architect/PayoffChartV3.tsx` | **new** |
| Pure geometry/zone helpers | `packages/web/src/features/architect/ladder-geometry.ts` | **new** |
| Styles + keyframes | `packages/web/src/features/architect/PayoffChartV3.module.css` | **new** |
| Helper unit tests | `packages/web/src/features/architect/ladder-geometry.test.ts` | **new** |
| Component smoke test | `packages/web/src/features/architect/PayoffChartV3.test.tsx` | **new** |
| Mount + toggle + callbacks | `packages/web/src/features/architect/ArchitectView.tsx` | **minimal, additive** |

ArchitectView edits (surgical, mirrors how V2 was added):
1. Widen `variant` state union `'v1' | 'v2'` → `'v1' | 'v2' | 'v3'` (currently line ~190).
2. Add a third toggle button in the variant group (lines ~636–653).
3. Add a `v3` branch to the chart render (the ternary at ~656), rendering `<PayoffChartV3 … />`.
4. Extend the chart title map (~628) with a V3 title, e.g. **"Lego Ladder"**.
5. Add two thin handlers next to the existing `handleLegStrikeDrag`: `handleAddLegAtStrike` and `handleRemoveLeg`, both routing through the existing `useStrategyStore` mutators (`addLeg` / `removeLeg`) and `repriceStrategyLeg`. No new store fields.

---

## 4. Visual design language

### 4.1 Coordinate system (price → y)
- Vertical axis is **underlying price, increasing upward**. No time axis.
- Domain `[priceMin, priceMax]` is taken from the existing `payoffPoints` range (`points[0].underlyingPrice … points[n-1].underlyingPrice`). This is deliberate: `computePayoff`/`computeRangeHalf` already widen the grid to keep **all break-evens inside** the range (the long-ATM-straddle regression guard). Reusing it means V3 inherits that correctness for free.
- `y(price) = padTop + (priceMax − price) / (priceMax − priceMin) * plotH`. Inverted so high price → small y → top.
- `priceAt(y)` is the inverse, used by the crosshair and drag.
- Degeneracy guard: if `priceMax − priceMin <= 0` (single flat point), fall back to a ±`max(spot*0.1, 1)` window (mirror V1's `|| 1` guard philosophy).

### 4.2 Block geometry — the four primitives
Premium is `leg.entryPrice` (USD per contract, already venue-normalized to the **same USD price-space as `strike`** — confirmed by `compute-execution.ts` / core `normPrice`; do **not** rescale by `contractSize` or inverse for geometry).

Per leg, the per-leg break-even and block price-span:

| Leg | per-leg B/E | block price span | far edge (B/E edge) | arrow |
|---|---|---|---|---|
| Long call | `strike + premium` | `[strike, strike+premium]` | top | up (unbounded ▲) |
| Short call | `strike + premium` | `[strike, strike+premium]` | top | down (capped) |
| Long put | `strike − premium` | `[strike−premium, strike]` | bottom | down (unbounded ▼) |
| Short put | `strike − premium` | `[strike−premium, strike]` | bottom | up (capped) |

- `topY = y(max(strike, legBE))`, `bottomY = y(min(strike, legBE))`, `height = bottomY − topY`.
- **Long** = solid fill + a triangle arrow on the far edge pointing **away** from strike (profit runs that way without bound).
- **Short** = hatched fill (SVG `<pattern>`) + a **red cap bar** on the far (break-even) edge + a small arrow pointing **inward** toward the strike (profit is capped at the premium; loss begins past the cap).
- **Hue = leg identity:** call = blue (`--lego-call`, ~`#5a9be0`), put = purple (`--lego-put`, ~`#cf8fe8`). Long uses saturated fill; short uses the hatch pattern in the same hue.
- **Quantity** shown as a `×N` badge on the block (not encoded in width). Opacity may nudge slightly with |qty| but width stays constant for a clean grid.
- **Label:** compact, e.g. `+1 C 100`, `−2 P 95`.
- **Minimum visual height** `MIN_BLOCK_PX` (e.g. 6px): premiums can be sub-$1 (LIT/WFLI ~$0.50) or tiny; clamp block height to stay visible. When clamped, mark the block (e.g. a subtle dotted far edge) so it reads as "not to scale."

### 4.3 Net P&L wash + break-even lines
- The background is split into horizontal bands by the **net** break-evens (`metrics.breakevens`, sorted) plus the ±∞ ends.
- Each band's sign comes from `pnlAtPrice(legs, midPrice) >= 0` → green, else red (this is exactly V2's `buildZones` logic, reused/replicated on the price→y axis). Bands render as full-width rects behind the blocks.
- Optional intensity: band opacity may scale with |pnl| (deferred polish; MVP uses flat green/red opacity tokens).
- Net break-evens drawn as **yellow dashed horizontal lines** with price labels.
- Unbounded ends (`maxProfit`/`maxLoss === null`) extend the band to the plot edge; bounded ends still extend visually but the cap is implied by the block's cap bar.
- The current **spot** (`spotPrice`) is a solid accent horizontal line, labeled.

> Note: per-leg block edges (4.2) and net break-even lines (4.3) are distinct. For a single-leg trade they coincide. For multi-leg they differ — blocks show *each leg's* break-even; the yellow lines + wash show the *net* position. This duality is the point.

### 4.4 Multi-leg layout — lane packing
- Blocks default to a **central band** in x, so a straddle's call+put blocks tile vertically into the net loss rectangle (the hero visual).
- When two blocks' y-ranges overlap, they offset into side-by-side **lanes** (greedy interval packing by y-overlap → lane index → `x = centerX + laneIndex * laneStep`), kept near center so the tiling still reads. Both stay fully visible and hoverable.
- The net wash is computed from **all** legs and is independent of block x-position.
- `packLanes(blocks)` is a pure, unit-tested helper.

### 4.5 Formatting & scaling (sub-$1 / inverse)
- All price/premium/greek labels use `@lib/format` (`fmtUsd` tiers: 0dp ≥100, 2dp ≥1, 4dp ≥0.01, 6dp below; `fmtIv` ×100). IV everywhere is a fraction.
- Price-axis tick precision derived from the price span (reuse V1's `pickDecimals`/`shouldUseKFormat` approach), **not** hardcoded `0.01` (the V2 sub-$1 bug to avoid).
- `entryPrice`/`strike` are already USD — never multiply by `contractSize` or convert inverse for the geometry; that only matters for total notional in the execution layer.
- Acceptance includes a sub-$1 underlying (LIT/WFLI ~$0.50) and a Deribit inverse BTC context (premium is already USD).

---

## 5. Interaction model — constructor-lite

### 5.1 Hover & price-scrub crosshair
- Pointer over empty ladder → a horizontal **crosshair** at the pointer with a readout chip: `@ <price> → net <P/L $> (<±%>)`, where P/L = `pnlAtPrice(legs, priceAt(y))`. This is the primary payoff-reading gesture.
- Pointer over a **block** → that block lifts/glows and a **detail card** slides in: type, strike, premium, qty, greeks (guard nulls — `greeksMissingLegs`), and the leg's P/L at spot. While hovering a block, the crosshair chip yields to the card (no double readout).

### 5.2 Drag-to-tune strike + live re-flow + magnetic snap
- Press on a block and drag vertically → the block follows the pointer (clamped to the plot), **magnetically snapping** to the nearest value in `availableStrikes` with a small overshoot-and-settle.
- During drag the net wash + break-even lines **re-flow live** by recomputing payoff from a transient leg with the dragged strike (local state; no store write until release).
- On release → commit via the existing `onLegStrikeDrag(legId, newStrike)` contract → `repriceStrategyLeg` → `updateLeg` (re-snaps to a real chain strike and re-prices greeks). Identical contract to V1, so the reprice path is unchanged.

### 5.3 Click-rung-to-place + picker
- Click an empty strike rung → a small popover **picker**: call/put · buy/sell, qty (default 1). Confirm → `onAddLegAtStrike(strike, type, direction, qty)` → reprice → `addLeg`.
- A faint **ghost block** previews on rung-hover before placing.

### 5.4 Remove
- Drag a block horizontally off the plot past a threshold (or a small `×` on the hovered block) → `onRemoveLeg(legId)` → store `removeLeg`. Block shrink-and-fade on removal.

### 5.5 Accessibility & motion
- Blocks are focusable; the placement picker is keyboard-operable; Esc closes the picker.
- All animations respect `prefers-reduced-motion` (mirror `StatusTakeover.module.css`) — transitions collapse to instant.
- Legs auto-clear when `underlying` changes (existing ArchitectView effect) — V3 just re-renders from the new (empty) leg list.

---

## 6. Animation / juice spec (six cores)

All CSS, on SVG/DOM nodes, using the design tokens (`--transition-fast: 120ms ease`, `--transition-base: 200ms ease-out`) plus a couple of local keyframes. No JS render loop; no animation lib.

1. **Price-scrub crosshair** — pointer-driven line + readout chip (§5.1).
2. **Block lift + glow** — `:hover`/active → `transform: translateY(-2px) scale(1.03)` + drop-shadow glow + brighter border.
3. **Detail card on hover** — slide+fade-in card (`@keyframes` rise/fade), positioned beside the block.
4. **Live zone re-flow while dragging** — zone rects + break-even lines have `transition` on geometry so they tween as the dragged strike updates.
5. **Magnetic rung snap + settle** — snap to nearest strike with a short overshoot keyframe on settle.
6. **Drop-in / remove** — place → scale-from-0.85 + fade-in; remove → shrink + fade-out.

Deferred to Future (§12): ambient win/loss edge glow + spot-cross flash; focus-dim spotlight.

---

## 7. Component architecture

### `ladder-geometry.ts` (pure, no React, no DOM)
- `makePriceScale(priceMin, priceMax, padTop, plotH)` → `{ y(price), priceAt(yPx) }`.
- `legToBlock(leg)` → `{ legId, type, direction, qty, strike, legBE, spanLowPrice, spanHighPrice, label }`.
- `packLanes(blocks)` → `Map<legId, laneIndex>` (greedy y-overlap packing).
- `buildLadderZones(legs, breakevens, priceMin, priceMax)` → `Array<{ lowPrice, highPrice, profit }>` (sign via `pnlAtPrice` at midpoints; reuses `payoff.ts`).
- `netPnlReadout(legs, price)` → `{ pnl, pct }` (wraps `pnlAtPrice`).
- All exported and unit-tested. No new payoff math — these compose `payoff.ts`.

### `PayoffChartV3.tsx`
- **Props** (superset of V1's, same names where they overlap):
  - `legs: Leg[]`, `points: PayoffPoint[]`, `breakevens: number[]`, `spotPrice: number`,
  - `maxProfit: number | null`, `maxLoss: number | null`, `strikes: number[]`, `underlying: string`,
  - `onLegStrikeDrag(legId, newStrike)`, `onAddLegAtStrike(strike, type, direction, qty)`, `onRemoveLeg(legId)`.
- **State** (all local): hover target, drag state (legId + transient strike), picker state (open rung + selection), container size (ResizeObserver). SVG is declarative so no `dataRef`/canvas-stash pattern is needed.
- Renders a single responsive `<svg>`: zone rects → break-even/spot lines → blocks (packed) → crosshair/card/picker overlays (can be DOM siblings positioned over the SVG for easier CSS).
- Reads nothing from the network/store directly — props only. Emits only via the three callbacks.

### ArchitectView wiring
- `handleAddLegAtStrike(strike, type, direction, qty)`: build a leg spec → `repriceStrategyLeg` → `addLeg`.
- `handleRemoveLeg(legId)`: `removeLeg`.
- Reuse existing `handleLegStrikeDrag`. Pass `underlying` and `availableStrikes` (already computed) through.

---

## 8. Reuse & protect-existing constraints

- **Do not modify** `payoff.ts`, `PayoffChart.tsx` (V1), `PayoffChartV2.tsx` (V2), `zones-primitive.ts`, or the strategy store shape. Consume them only.
- **WS/feed is read-only:** V3 receives chain-derived props from ArchitectView (which already uses `useChainQuery`/`useChainWs`/feedStatus). V3 opens no sockets and touches no transport. (Per the WS-read-only and protect-existing memories.)
- ArchitectView changes are additive (a new variant branch), mirroring exactly how V2 was introduced — no behavior change when `variant !== 'v3'`.
- No new runtime dependencies. SVG + CSS + existing React 19 / Zustand / TanStack only.

---

## 9. Testing strategy

- **`ladder-geometry.test.ts` (the core):** price↔y round-trip; `legToBlock` edges for all four primitives including a sub-$1 premium and a large BTC-scale premium; `packLanes` for non-overlap, full-overlap (straddle), and partial-overlap (condor); `buildLadderZones` signs for long call, long straddle (red band between BEs, green outside), and a bull call spread; unbounded-end handling (`null` max P/L).
- **`PayoffChartV3.test.tsx` (smoke):** SVG renders one block per leg with correct hue/long-short treatment (assert via `container.querySelector` on `<rect>`/`<pattern>`/`text` — SVG renders in jsdom, unlike canvas → a real testability win); crosshair readout text updates on simulated pointer move; picker confirm fires `onAddLegAtStrike`; drag release fires `onLegStrikeDrag`.
- **jsdom constraints** (per repo): `globals:false` (import `{describe,it,expect,vi}`, manual `cleanup()` in `afterEach`); no jest-dom (plain matchers / `textContent`); mock `@hooks/useIsMobile` if used; do not rely on `getContext` or layout measurement — drive geometry through the pure helpers and inject a fixed size.
- Existing suites must stay green; rebuild `@oggregator/protocol` if any protocol types are touched (they should not be).

---

## 10. Edge cases

- **Empty legs:** show the bare ladder (rungs + spot) with a "click a rung to add a leg" hint.
- **Single leg:** per-leg B/E == net B/E; block edge sits on the yellow line.
- **Same-strike opposite legs** (e.g. long+short call same strike): zero-height net contribution there; lane-pack so both blocks remain visible.
- **Leg strike far outside the payoff range:** `computeRangeHalf` already widens to include strikes; if a pathological strike still falls outside, clamp the block to the plot edge with an "off-scale ↑/↓" marker.
- **Null greeks** (`greeksMissingLegs > 0`): detail card shows "–" for missing greeks (use `fmtUsd`/`fmtIv` null handling).
- **Sub-$1 / inverse:** verified via §4.5; block height clamped to `MIN_BLOCK_PX`.
- **Mobile/touch:** desktop-first (like the onboarding tour); touch parity is Future.

---

## 11. MVP phasing

- **Phase 1 — Render + read:** price scale, blocks (4 primitives, hue/long-short), net wash + BE/spot lines, lane packing, price-scrub crosshair, block hover lift/glow + detail card. Read-only over store legs. (Cores 1–3.)
- **Phase 2 — Tune:** drag-to-tune strike, magnetic snap+settle, live re-flow, drop-in/remove animations. (Cores 4–6, plus §5.2/§5.4 wiring through the existing strike-drag/remove paths.)
- **Phase 3 — Build:** click-rung picker → add leg (§5.3), drag-off remove (§5.4). Constructor-lite complete.

Each phase is shippable and leaves V1/V2 untouched.

---

## 12. Out of scope / Future

- Flavor juice: ambient win/loss edge glow + spot-cross flash; focus-dim spotlight.
- Interaction model **C**: full palette drag-and-drop (incl. straddle/spread combo blocks) onto rungs.
- Band-intensity gradient by |pnl|; greeks/scenario overlays on the ladder (V1 has IV/DTE scenario curves — could port later).
- Multi-expiry ladders; mobile/touch parity.
- The challenge **simulation engine** rebuild (separate spec; seams already exist: `bs-solver.ts` Black-76 unused in the sim path, injectable `FillModel`/`QuoteProvider`/`MarginEngine`, and the single `equitySnapshot` scalar with no trailing-drawdown rule).

---

## 13. Open questions

1. **Lane vs central-tile preference for ≥4 legs:** spec defaults to central band + lane-offset on overlap. Acceptable, or prefer one-lane-per-leg ordered by strike (loses tiling)?
2. **Quantity encoding:** badge `×N` (spec default) vs block-width scaling vs opacity. Confirm badge.
3. **Crosshair vs card coexistence:** spec suppresses the crosshair chip while a block is hovered. Confirm that's the desired focus behavior.
4. **V3 as default variant?** Ships as an opt-in toggle (V1 default) initially; promote to default later if it tests well.
