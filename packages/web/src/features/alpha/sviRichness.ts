import { fitSvi, sviIv, type SviParams } from '@lib/analytics/svi';
import type { SmileCurve } from '@lib/analytics/smile';

export interface RichnessPoint {
  strike: number;
  k: number;
  ivMarket: number;
  ivSvi: number | null;
  residual: number | null;
  zScore: number | null;
}

export interface SviRichness {
  params: SviParams | null;
  points: RichnessPoint[];
  residualStd: number | null;
}

// Fit a single-expiry SVI slice to executable bid/ask midpoints and compute a
// leave-one-out residual + z-score. The z-score is the trading-edge signal:
// positive → market IV unusually rich at this strike (good sell candidate);
// negative → market IV unusually cheap (good buy candidate).
//
// Returns an empty richness object when the smile has too few usable points
// or the SVI optimizer fails so the consumer can fall back to raw IV display.
export function computeSviRichness(smile: SmileCurve | null, T: number | null): SviRichness {
  if (!smile || T == null || T <= 0 || smile.forward <= 0) {
    return { params: null, points: [], residualStd: null };
  }

  const usable = smile.points.flatMap((point) => {
    const bidIv = point.executableBidIv;
    const askIv = point.executableAskIv;
    if (bidIv == null || askIv == null || bidIv <= 0 || askIv <= 0 || askIv < bidIv) return [];
    return [{ point, executableMidIv: (bidIv + askIv) / 2 }];
  });
  if (usable.length < 6) {
    return { params: null, points: [], residualStd: null };
  }

  const fitInput = usable.map(({ point, executableMidIv }) => ({
    k: Math.log(point.strike / smile.forward),
    iv: executableMidIv,
  }));
  const params = fitSvi(fitInput, T);

  const enrichedPoints: RichnessPoint[] = usable.map(({ point, executableMidIv }, i) => {
    const k = fitInput[i]!.k;
    const leaveOneOutParams = fitSvi(fitInput.filter((_, index) => index !== i), T);
    if (!leaveOneOutParams) {
      return { strike: point.strike, k, ivMarket: executableMidIv, ivSvi: null, residual: null, zScore: null };
    }
    const ivSvi = sviIv(leaveOneOutParams, k, T);
    const ivMarket = executableMidIv;
    const residual = ivMarket - ivSvi;
    return { strike: point.strike, k, ivMarket, ivSvi, residual, zScore: null };
  });

  if (!params) {
    return { params: null, points: enrichedPoints, residualStd: null };
  }

  const residuals = enrichedPoints
    .map((p) => p.residual)
    .filter((r): r is number => r != null && Number.isFinite(r));
  if (residuals.length < 2) {
    return { params, points: enrichedPoints, residualStd: null };
  }
  const meanRes = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance =
    residuals.reduce((acc, r) => acc + (r - meanRes) * (r - meanRes), 0) / residuals.length;
  const std = Math.sqrt(variance);

  if (std < 1e-9) {
    return { params, points: enrichedPoints, residualStd: 0 };
  }

  const withZ: RichnessPoint[] = enrichedPoints.map((p) =>
    p.residual == null ? p : { ...p, zScore: (p.residual - meanRes) / std },
  );

  return { params, points: withZ, residualStd: std };
}
