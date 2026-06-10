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
