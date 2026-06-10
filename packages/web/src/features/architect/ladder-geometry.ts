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
