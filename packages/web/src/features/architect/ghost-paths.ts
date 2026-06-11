import type { Leg } from './payoff';
import { pnlAtPrice } from './payoff';
import type { SpotCandle } from './queries';

// Tunables — see design doc §9.
export const SIGMA_MULTIPLE = 1;
export const MIN_BAND_PCT = 0.015;
export const DEFAULT_IV = 0.6;
export const WICK_PCT = 0.0005;
export const WICK_BODY_FRAC = 0.15;
export const MAX_PROJECTION_BARS = 1000;

/**
 * Synthetic ghost-candle walk gliding linearly from `spot` (at anchorBarTimeMs)
 * to `target` (at expiryMs), one bar per resolution bucket. These are scenario
 * illustrations, NOT forecasts — the glide is deliberately straight. The
 * WICK_PCT floor keeps a flat (theta) path readable as candles.
 */
export function buildPathCandles(
  spot: number,
  target: number,
  anchorBarTimeMs: number,
  expiryMs: number,
  resolutionSec: number,
): SpotCandle[] {
  const stepMs = resolutionSec * 1000;
  const span = expiryMs - anchorBarTimeMs;
  if (span <= 0 || stepMs <= 0 || spot <= 0) return [];

  const barCount = Math.min(MAX_PROJECTION_BARS, Math.ceil(span / stepMs));
  const candles: SpotCandle[] = [];
  let prevPrice = spot;
  for (let i = 1; i <= barCount; i++) {
    const t = anchorBarTimeMs + i * stepMs;
    const frac = Math.min(1, (t - anchorBarTimeMs) / span);
    const close = spot + (target - spot) * frac;
    const open = prevPrice;
    const wick = Math.max(spot * WICK_PCT, Math.abs(close - open) * WICK_BODY_FRAC);
    candles.push({
      timestamp: t,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
    });
    prevPrice = close;
  }
  return candles;
}

export type GhostPathKind = 'up' | 'down' | 'theta';

export interface GhostPath {
  kind: GhostPathKind;
  isProfit: boolean;
  targetPrice: number;
  pnlAtExpiry: number;
  candles: SpotCandle[];
}

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Mean implied vol (fraction) across legs that report it; DEFAULT_IV when none do. */
function representativeIv(legs: Leg[]): number {
  const ivs = legs.map((l) => l.iv).filter((iv): iv is number => iv != null && iv > 0);
  if (ivs.length === 0) return DEFAULT_IV;
  return ivs.reduce((sum, iv) => sum + iv, 0) / ivs.length;
}

/**
 * Three projected price paths for the open structure, from `anchorBarTimeMs` to
 * the nearest-expiry horizon: Up (+1σ), Down (−1σ), Flat (θ). Each is colored by
 * its own at-expiry P&L, so the win/lose direction and the buy-vol/sell-vol theta
 * flip fall out of one rule (see design doc §3).
 */
export function computeGhostPaths(
  legs: Leg[],
  spotPrice: number,
  horizonExpiryMs: number,
  anchorBarTimeMs: number,
  resolutionSec: number,
): GhostPath[] {
  if (legs.length === 0 || spotPrice <= 0) return [];
  if (!Number.isFinite(horizonExpiryMs) || horizonExpiryMs <= anchorBarTimeMs) return [];

  const tYears = Math.max(0, (horizonExpiryMs - anchorBarTimeMs) / MS_PER_YEAR);
  const sigmaMove = spotPrice * representativeIv(legs) * Math.sqrt(tYears);
  const bandHalf = Math.max(sigmaMove * SIGMA_MULTIPLE, spotPrice * MIN_BAND_PCT);

  const targets: { kind: GhostPathKind; target: number }[] = [
    { kind: 'up', target: spotPrice + bandHalf },
    { kind: 'down', target: Math.max(spotPrice * 0.01, spotPrice - bandHalf) },
    { kind: 'theta', target: spotPrice },
  ];

  return targets.map(({ kind, target }) => {
    const pnl = pnlAtPrice(legs, target);
    return {
      kind,
      isProfit: pnl >= 0,
      targetPrice: target,
      pnlAtExpiry: pnl,
      candles: buildPathCandles(spotPrice, target, anchorBarTimeMs, horizonExpiryMs, resolutionSec),
    };
  });
}
