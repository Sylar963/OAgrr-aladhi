import type {
  BreakEvenIvRow,
  PortfolioPnlCurve,
  PortfolioTotals,
  PositionLeg,
  ShockGridCell,
} from '@oggregator/protocol';

export type BookMode = 'flat' | 'long_vol' | 'short_vol' | 'vega_neutral';

export interface IvEdge {
  edgeVolPts: number;
  entryIv: number;
  liveIv: number;
  exposure: 'long' | 'short' | 'mixed';
}

const FLAT_EPSILON = 1e-9;

export function classifyBook(totals: PortfolioTotals | null, positionCount: number): BookMode {
  if (positionCount === 0 || totals == null) return 'flat';
  if (totals.netVegaUsd > FLAT_EPSILON) return 'long_vol';
  if (totals.netVegaUsd < -FLAT_EPSILON) return 'short_vol';
  return 'vega_neutral';
}

export function calculateIvEdge(
  positions: PositionLeg[],
  breakEven: BreakEvenIvRow[],
): IvEdge | null {
  const byLegId = new Map(breakEven.map((row) => [row.legId, row]));
  let weightedEdge = 0;
  let weightedEntry = 0;
  let weightedLive = 0;
  let totalWeight = 0;
  let hasLong = false;
  let hasShort = false;

  for (const leg of positions) {
    const row = byLegId.get(leg.legId);
    const entryIv = leg.entryIv ?? row?.entryIv;
    const liveIv = row?.currentIv;
    if (entryIv == null || liveIv == null) continue;

    const weight = Math.abs(leg.size);
    const direction = leg.size > 0 ? 1 : -1;
    weightedEdge += (liveIv - entryIv) * direction * weight;
    weightedEntry += entryIv * weight;
    weightedLive += liveIv * weight;
    totalWeight += weight;
    hasLong ||= leg.size > 0;
    hasShort ||= leg.size < 0;
  }

  if (totalWeight === 0) return null;

  return {
    edgeVolPts: (weightedEdge / totalWeight) * 100,
    entryIv: weightedEntry / totalWeight,
    liveIv: weightedLive / totalWeight,
    exposure: hasLong && hasShort ? 'mixed' : hasLong ? 'long' : 'short',
  };
}

export function getParallelVolShock(grid: ShockGridCell[][], shiftVolPts: number): number | null {
  let match: ShockGridCell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const cell of grid.flat()) {
    const distance = Math.abs(cell.atmShiftVolPts - shiftVolPts) + Math.abs(cell.skewShiftPerLogK) * 10;
    if (distance < bestDistance) {
      bestDistance = distance;
      match = cell;
    }
  }

  return match?.totalPnlUsd ?? null;
}

export function getSpotShock(curve: PortfolioPnlCurve, movePct: number): number | null {
  if (curve.status !== 'ok' || curve.currentSpotUsd == null || curve.points.length === 0) return null;

  const nearestPoint = (target: number) => {
    let nearest = curve.points[0];
    if (nearest == null) return null;
    let distance = Math.abs(nearest.underlyingPriceUsd - target);

    for (const point of curve.points) {
      const nextDistance = Math.abs(point.underlyingPriceUsd - target);
      if (nextDistance < distance) {
        nearest = point;
        distance = nextDistance;
      }
    }
    return nearest;
  };

  const current = nearestPoint(curve.currentSpotUsd);
  const shocked = nearestPoint(curve.currentSpotUsd * (1 + movePct));
  if (current == null || shocked == null) return null;
  return shocked.nowPnlUsd - current.nowPnlUsd;
}
