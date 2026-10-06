import { black76Price } from '@lib/analytics/blackScholes';

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

export interface LadderDomain {
  priceMin: number;
  priceMax: number;
  /** Available strikes inside the domain, sorted — drawn as the ladder's rungs. */
  rungs: number[];
}

/**
 * Tight, strike-anchored price domain for the V3 ladder. The payoff-curve range
 * (derivePriceDomain) is deliberately ±30%+ of spot to keep break-evens inside the
 * P&L curve — far too wide for a lego ladder, where it crushes every block to a
 * sliver. This zooms to the strategy itself: spot, every block edge and break-even,
 * widened by a context margin so blocks read as blocks. `rungs` are the available
 * strikes inside that window (capped to the `maxRungs` nearest spot for dense chains).
 */
export function deriveLadderDomain(
  blocks: LadderBlock[],
  breakevens: number[],
  spotPrice: number,
  strikes: number[],
  maxRungs = 40,
): LadderDomain {
  const action: number[] = [spotPrice];
  for (const b of blocks) action.push(b.spanLowPrice, b.spanHighPrice);
  for (const be of breakevens) if (Number.isFinite(be)) action.push(be);
  let lo = Math.min(...action);
  let hi = Math.max(...action);
  const margin = Math.max((hi - lo) * 0.25, spotPrice * 0.06) || Math.max(spotPrice * 0.1, 1);
  lo -= margin;
  hi += margin;
  let rungs = strikes.filter((k) => k >= lo && k <= hi).sort((a, b) => a - b);
  // Sparse/far grids: if no strike landed in the action window (e.g. empty state
  // with all listed strikes >6% from spot), fall back to the full list — the cap
  // below keeps the ones nearest spot, and lo/hi below extend to fit them.
  if (rungs.length === 0) rungs = [...strikes].sort((a, b) => a - b);
  if (rungs.length > maxRungs) {
    rungs = rungs
      .slice()
      .sort((a, b) => Math.abs(a - spotPrice) - Math.abs(b - spotPrice))
      .slice(0, maxRungs)
      .sort((a, b) => a - b);
  }
  if (rungs.length > 0) {
    lo = Math.min(lo, rungs[0]!);
    hi = Math.max(hi, rungs[rungs.length - 1]!);
  }
  const pad = (hi - lo) * 0.04 || 1;
  return { priceMin: Math.max(0, lo - pad), priceMax: hi + pad, rungs };
}

export interface LadderBlock {
  legId: string;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  quantity: number;
  strike: number;
  /** Leg expiry — the block's column on the tenor (horizontal) axis. */
  expiry: string;
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
    expiry: leg.expiry,
    legBreakeven,
    spanLowPrice,
    spanHighPrice,
    label,
  };
}

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

/** Minimal shape packLanes needs — a keyed price interval. */
export interface LaneItem {
  legId: string;
  spanLowPrice: number;
  spanHighPrice: number;
}

/**
 * Greedy interval packing by price-span overlap. Blocks whose spans don't
 * overlap reuse a lane (touching edges, e.g. a straddle's two legs, count as
 * non-overlapping so they stay centered and tile). Overlapping blocks get
 * separate lanes for horizontal offset.
 */
export function packLanes(blocks: LaneItem[]): Map<string, number> {
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

/**
 * Tenor (expiry) columns for the ladder's horizontal axis. Always includes the
 * anchor (the builder's live expiry) and every leg's expiry; pads with the
 * chronologically adjacent listed expiries until `maxCols` columns. When the
 * legs themselves span more than `maxCols` tenors, every tenor in that range is
 * kept — a leg must never lose its column. Leg expiries no longer listed by the
 * venue (stale) are appended at the end so their blocks stay visible.
 */
export function deriveTenorColumns(
  allExpiries: string[],
  legExpiries: string[],
  anchorExpiry: string,
  maxCols = 5,
): string[] {
  const required = new Set<string>();
  if (anchorExpiry) required.add(anchorExpiry);
  for (const e of legExpiries) if (e) required.add(e);

  const known = allExpiries.filter((e) => required.has(e));
  const unknown = [...required].filter((e) => !allExpiries.includes(e));
  if (allExpiries.length === 0) return [...required];

  let loIdx = known.length > 0 ? allExpiries.indexOf(known[0]!) : 0;
  let hiIdx = known.length > 0 ? allExpiries.indexOf(known[known.length - 1]!) : -1;
  if (hiIdx < loIdx) {
    loIdx = 0;
    hiIdx = Math.min(maxCols, allExpiries.length) - 1;
  }
  // A wide leg-tenor span would otherwise pull in every listed expiry between
  // the extremes (N columns → N chain polls and sliver-thin columns). Keep just
  // the tenors that are actually required when the span overflows maxCols.
  if (hiIdx - loIdx + 1 > maxCols) return [...known, ...unknown];
  while (hiIdx - loIdx + 1 < maxCols && (hiIdx < allExpiries.length - 1 || loIdx > 0)) {
    if (hiIdx < allExpiries.length - 1) hiIdx++;
    else loIdx--;
  }
  return [...allExpiries.slice(loIdx, hiIdx + 1), ...unknown];
}

export interface TenorLaneItem extends LaneItem {
  expiry: string;
}

/**
 * Lane packing scoped to each tenor column: blocks only contend for horizontal
 * offset with overlapping blocks in the SAME column. Returns each key's lane
 * plus the column's lane count so the caller can center the fan.
 */
export function packLanesByTenor(
  items: TenorLaneItem[],
): Map<string, { lane: number; lanesInTenor: number }> {
  const byTenor = new Map<string, TenorLaneItem[]>();
  for (const item of items) {
    const group = byTenor.get(item.expiry);
    if (group) group.push(item);
    else byTenor.set(item.expiry, [item]);
  }
  const out = new Map<string, { lane: number; lanesInTenor: number }>();
  for (const group of byTenor.values()) {
    const lanes = packLanes(group);
    const lanesInTenor = lanes.size > 0 ? Math.max(...lanes.values()) + 1 : 1;
    for (const [key, lane] of lanes) out.set(key, { lane, lanesInTenor });
  }
  return out;
}

/**
 * A long+short of the same type fused into one connected "spread block" — the
 * defined-risk corridor between two strikes (solid long edge, capped short edge).
 */
export interface LadderSpread {
  type: 'call' | 'put';
  /** Shared expiry of both legs — the spread's column on the tenor axis. */
  expiry: string;
  longLegId: string;
  shortLegId: string;
  longStrike: number;
  shortStrike: number;
  /** Corridor bounds: min/max of the two strikes. */
  lowStrike: number;
  highStrike: number;
  quantity: number;
  label: string;
  /** Each leg's own block geometry — rendered as a real lego block, not a bar. */
  longBlock: LadderBlock;
  shortBlock: LadderBlock;
}

/** A render unit on the ladder: either a lone leg block or a fused spread. */
export type LadderUnit =
  | { kind: 'single'; block: LadderBlock }
  | { kind: 'spread'; spread: LadderSpread };

/** Stable key for a spread unit (used for lane packing / React keys). */
export function spreadKey(sp: LadderSpread): string {
  return `spread:${sp.longLegId}:${sp.shortLegId}`;
}

/**
 * Group legs into render units. A clean vertical — same type, same expiry, equal
 * quantity, opposite direction, different strikes — fuses into one spread block;
 * everything else (ratios, butterflies, calendars, straddles, naked legs) stays a
 * per-leg block. Pairing only changes rendering — domain, zones and break-evens
 * are still computed from the underlying legs.
 */
export function buildLadderUnits(legs: Leg[]): LadderUnit[] {
  const groups = new Map<string, Leg[]>();
  for (const l of legs) {
    const key = `${l.type}|${l.expiry}|${l.quantity}`;
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }

  const spreads: LadderSpread[] = [];
  const paired = new Set<string>();
  for (const group of groups.values()) {
    const longs = group.filter((l) => l.direction === 'buy').sort((a, b) => a.strike - b.strike);
    const shorts = group.filter((l) => l.direction === 'sell').sort((a, b) => a.strike - b.strike);
    const n = Math.min(longs.length, shorts.length);
    for (let i = 0; i < n; i++) {
      const lo = longs[i]!;
      const sh = shorts[i]!;
      if (lo.strike === sh.strike) continue; // degenerate — leave as singles
      paired.add(lo.id);
      paired.add(sh.id);
      const typeChar = lo.type === 'call' ? 'C' : 'P';
      const lowStrike = Math.min(lo.strike, sh.strike);
      const highStrike = Math.max(lo.strike, sh.strike);
      const qty = lo.quantity > 1 ? `${lo.quantity}× ` : '';
      spreads.push({
        type: lo.type,
        expiry: lo.expiry,
        longLegId: lo.id,
        shortLegId: sh.id,
        longStrike: lo.strike,
        shortStrike: sh.strike,
        lowStrike,
        highStrike,
        quantity: lo.quantity,
        label: `${qty}${typeChar} ${lowStrike}/${highStrike}`,
        longBlock: legToBlock(lo),
        shortBlock: legToBlock(sh),
      });
    }
  }

  // Preserve original leg order for the singles; spreads render first (behind).
  const units: LadderUnit[] = spreads.map((spread) => ({ kind: 'spread', spread }));
  for (const l of legs) {
    if (!paired.has(l.id)) units.push({ kind: 'single', block: legToBlock(l) });
  }
  return units;
}

/**
 * Net position P&L at a price, plus % of cost basis (|netDebit|). At expiry by
 * default; pass `atMs` for the model value at that moment.
 */
export function netPnlReadout(
  legs: Leg[],
  price: number,
  netDebit: number,
  atMs?: number,
): { pnl: number; pct: number | null } {
  const pnl = atMs != null ? pnlAtTime(legs, price, atMs) : pnlAtPrice(legs, price);
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

/**
 * Format a price-axis tick label, sub-$1 safe. k-format is decided from the
 * axis max (V1-faithful) so every tick on an axis uses one format — deciding
 * per tick would mix "950" and "1.1k" on a domain straddling 1000.
 */
export function formatPriceTick(price: number, span: number, axisMax: number): string {
  const useK = shouldUseKFormat(axisMax);
  const dp = pickDecimals(span, useK);
  return useK ? `${(price / 1000).toFixed(dp)}k` : price.toFixed(dp);
}

const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365 * MS_PER_DAY;
const DEFAULT_IV = 0.5;
const MIN_IV = 0.01;

/** Settlement instant of a YYYY-MM-DD expiry (08:00 UTC, matching dteDays). */
export function expiryMs(expiry: string): number {
  return new Date(expiry + 'T08:00:00Z').getTime();
}

export interface TimeScale {
  /** Tenors sorted chronologically. */
  tenors: string[];
  nowMs: number;
  endMs: number;
  /** Calendar time → pixel x, clamped to the plot. */
  xOf: (ms: number) => number;
  timeAt: (xPx: number) => number;
  /** x of a tenor's expiry line, or null when the tenor has no column. */
  xExpiry: (tenor: string) => number | null;
  /** Pixel span of a tenor's segment: (previous expiry or now, this expiry]. */
  segment: (tenor: string) => { x0: number; x1: number } | null;
  /** Tenor whose segment contains pixel x — the first expiry at or after that time. */
  tenorAt: (xPx: number) => string | null;
}

/**
 * Linear calendar-time axis from now to the last tenor's expiry, so theta decay
 * reads honestly: equal widths are equal days, expiries land where they occur.
 */
export function makeTimeScale(
  tenors: string[],
  plotLeft: number,
  plotW: number,
  nowMs: number,
): TimeScale {
  const sorted = [...tenors].sort((a, b) => expiryMs(a) - expiryMs(b));
  const lastMs = sorted.length > 0 ? expiryMs(sorted[sorted.length - 1]!) : nowMs;
  const endMs = Math.max(lastMs, nowMs + MS_PER_DAY);
  const spanMs = endMs - nowMs;
  const xOf = (ms: number) =>
    plotLeft + Math.max(0, Math.min(1, (ms - nowMs) / spanMs)) * plotW;
  const timeAt = (xPx: number) => nowMs + ((xPx - plotLeft) / plotW) * spanMs;
  return {
    tenors: sorted,
    nowMs,
    endMs,
    xOf,
    timeAt,
    xExpiry: (tenor) => (sorted.includes(tenor) ? xOf(expiryMs(tenor)) : null),
    segment: (tenor) => {
      const i = sorted.indexOf(tenor);
      if (i === -1) return null;
      const startMs = i === 0 ? nowMs : expiryMs(sorted[i - 1]!);
      return { x0: xOf(startMs), x1: xOf(expiryMs(tenor)) };
    },
    tenorAt: (xPx) => {
      if (sorted.length === 0) return null;
      const t = timeAt(xPx);
      return sorted.find((e) => expiryMs(e) >= t) ?? sorted[sorted.length - 1]!;
    },
  };
}

/**
 * Model value of one contract at a price and moment. Black-76 on the leg's own
 * IV (sticky strike); after expiry the leg is treated as settled at that price.
 */
export function legValueAt(leg: Leg, price: number, atMs: number): number {
  const tYears = (expiryMs(leg.expiry) - atMs) / MS_PER_YEAR;
  const intrinsic =
    leg.type === 'call' ? Math.max(price - leg.strike, 0) : Math.max(leg.strike - price, 0);
  if (tYears <= 0) return intrinsic;
  const iv = Math.max(MIN_IV, leg.iv ?? DEFAULT_IV);
  const v = black76Price(leg.type, price, leg.strike, tYears, iv);
  return Number.isFinite(v) ? v : intrinsic;
}

/** Net structure P&L if the underlying sits at `price` at time `atMs`. */
export function pnlAtTime(legs: Leg[], price: number, atMs: number): number {
  let total = 0;
  for (const leg of legs) {
    const sign = leg.direction === 'buy' ? 1 : -1;
    total +=
      sign * (legValueAt(leg, price, atMs) - leg.entryPrice) * leg.quantity * (leg.contractMultiplier ?? 1);
  }
  return total;
}

/**
 * Price-row edges for the P&L grid, ascending. Strike rungs are always edges so
 * cells line up with the ladder; each band is split into ~`targetPx` rows.
 */
export function gridRowEdges(
  rungs: number[],
  priceMin: number,
  priceMax: number,
  pxPerPrice: number,
  targetPx: number,
): number[] {
  const anchors = [priceMin, ...rungs.filter((k) => k > priceMin && k < priceMax), priceMax];
  const edges: number[] = [anchors[0]!];
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1]!;
    const hi = anchors[i]!;
    const n = Math.max(1, Math.round(((hi - lo) * pxPerPrice) / targetPx));
    for (let j = 1; j <= n; j++) edges.push(lo + ((hi - lo) * j) / n);
  }
  return edges;
}

/** Whole-day time-column edges from now to endMs, ~`maxCols` columns at most. */
export function gridTimeEdges(nowMs: number, endMs: number, maxCols: number): number[] {
  const horizonDays = Math.max(0, (endMs - nowMs) / MS_PER_DAY);
  const stepDays = Math.max(1, Math.ceil(horizonDays / Math.max(1, maxCols)));
  const edges = [nowMs];
  for (let t = nowMs + stepDays * MS_PER_DAY; t < endMs; t += stepDays * MS_PER_DAY) edges.push(t);
  edges.push(endMs);
  return edges;
}

export interface PnlGridCell {
  t0Ms: number;
  t1Ms: number;
  lowPrice: number;
  highPrice: number;
  pnl: number;
}

/**
 * Price × time P&L grid for the whole structure. Each cell is valued at the end
 * of its time step (so the last column is the at-expiry payoff) and the middle
 * of its price band.
 */
export function buildPnlGrid(
  legs: Leg[],
  timeEdges: number[],
  priceEdges: number[],
): { cells: PnlGridCell[]; maxAbs: number } {
  const cells: PnlGridCell[] = [];
  let maxAbs = 0;
  if (legs.length === 0) return { cells, maxAbs };
  for (let c = 1; c < timeEdges.length; c++) {
    const t0Ms = timeEdges[c - 1]!;
    const t1Ms = timeEdges[c]!;
    for (let r = 1; r < priceEdges.length; r++) {
      const lowPrice = priceEdges[r - 1]!;
      const highPrice = priceEdges[r]!;
      const pnl = pnlAtTime(legs, (lowPrice + highPrice) / 2, t1Ms);
      maxAbs = Math.max(maxAbs, Math.abs(pnl));
      cells.push({ t0Ms, t1Ms, lowPrice, highPrice, pnl });
    }
  }
  return { cells, maxAbs };
}

/** Lognormal ±kσ band around spot at time atMs. */
export function expectedMoveBand(
  spot: number,
  iv: number,
  nowMs: number,
  atMs: number,
  k: number,
): { low: number; high: number } {
  const tYears = Math.max(0, (atMs - nowMs) / MS_PER_YEAR);
  const move = k * Math.max(MIN_IV, iv) * Math.sqrt(tYears);
  return { low: spot * Math.exp(-move), high: spot * Math.exp(move) };
}

/** IV of the leg struck nearest spot — the cone's ATM-vol proxy. */
export function nearestAtmIv(legs: Leg[], spotPrice: number): number | null {
  let best: Leg | null = null;
  for (const l of legs) {
    if (l.iv == null || !(l.iv > 0)) continue;
    if (!best || Math.abs(l.strike - spotPrice) < Math.abs(best.strike - spotPrice)) best = l;
  }
  return best?.iv ?? null;
}
