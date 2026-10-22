import type { PortfolioPnlCurve } from '@oggregator/protocol';

type CurvePoint = PortfolioPnlCurve['points'][number];

export function nowPnlAt(points: readonly CurvePoint[], price: number): number | null {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (price < a.underlyingPriceUsd || price > b.underlyingPriceUsd) continue;
    const span = b.underlyingPriceUsd - a.underlyingPriceUsd;
    if (span <= 0) return a.nowPnlUsd;
    return a.nowPnlUsd + ((price - a.underlyingPriceUsd) / span) * (b.nowPnlUsd - a.nowPnlUsd);
  }
  return null;
}

// Account margin falls to a requirement once the book loses the buffer above it from where it
// stands at spot: the remaining margin for IM, the liquidation buffer for maintenance margin.
// The requirement itself is held fixed, so the level is an approximation.
export function marginCallPnl(
  points: readonly CurvePoint[],
  spot: number,
  bufferUsd: number,
): number | null {
  const atSpot = nowPnlAt(points, spot);
  return atSpot == null ? null : atSpot - bufferUsd;
}

// Thalex liquidates below maintenance margin, which it sets at 70% of initial margin.
export const THALEX_MAINTENANCE_MARGIN_RATIO = 0.7;

export function liquidationBufferUsd(marginUsd: number, initialMarginUsd: number): number {
  return marginUsd - THALEX_MAINTENANCE_MARGIN_RATIO * initialMarginUsd;
}

export function marginCallPrices(
  points: readonly CurvePoint[],
  spot: number,
  level: number,
): { below: number | null; above: number | null } {
  let below: number | null = null;
  let above: number | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const da = a.nowPnlUsd - level;
    const db = b.nowPnlUsd - level;
    if (da === db || da * db > 0) continue;
    const price =
      a.underlyingPriceUsd + (da / (da - db)) * (b.underlyingPriceUsd - a.underlyingPriceUsd);
    if (price < spot) below = price;
    else if (above == null) above = price;
  }
  return { below, above };
}
