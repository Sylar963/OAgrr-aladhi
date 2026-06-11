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
