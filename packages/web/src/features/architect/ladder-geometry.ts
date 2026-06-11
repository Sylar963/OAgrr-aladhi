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
 * A long+short of the same type fused into one connected "spread block" — the
 * defined-risk corridor between two strikes (solid long edge, capped short edge).
 */
export interface LadderSpread {
  type: 'call' | 'put';
  longLegId: string;
  shortLegId: string;
  longStrike: number;
  shortStrike: number;
  /** Corridor bounds: min/max of the two strikes. */
  lowStrike: number;
  highStrike: number;
  quantity: number;
  label: string;
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
        longLegId: lo.id,
        shortLegId: sh.id,
        longStrike: lo.strike,
        shortStrike: sh.strike,
        lowStrike,
        highStrike,
        quantity: lo.quantity,
        label: `${qty}${typeChar} ${lowStrike}/${highStrike}`,
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
