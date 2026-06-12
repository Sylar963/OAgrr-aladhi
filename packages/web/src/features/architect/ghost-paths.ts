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

export const FRACTAL_SHAPE_POINTS = 48;
const FRACTAL_MIN_ANALYSIS_BARS = 6;
const FRACTAL_MAX_ANALYSIS_BARS = 48;

export type FractalArchetype = 'up' | 'down' | 'range' | 'breakout';

/** Linear-resample a series to `outLen` points (endpoints preserved). */
function resampleSeries(src: number[], outLen: number): number[] {
  if (outLen <= 0) return [];
  const n = src.length;
  if (n === 0) return new Array(outLen).fill(0);
  if (n === 1 || outLen === 1) return new Array(outLen).fill(src[0]!);
  const out = new Array<number>(outLen);
  for (let k = 0; k < outLen; k++) {
    const pos = (k * (n - 1)) / (outLen - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, n - 1);
    out[k] = src[lo]! + (pos - lo) * (src[hi]! - src[lo]!);
  }
  return out;
}

/**
 * A window's closes detrended against their own straight line, as a fraction of
 * the first close. Zero at both ends, so re-trending onto any target preserves
 * the endpoints while keeping the real intra-window wiggle.
 */
function windowResidual(closes: number[]): number[] {
  const n = closes.length;
  const first = closes[0]!;
  const last = closes[n - 1]!;
  return closes.map((c, i) => (c - (first + ((last - first) * i) / (n - 1))) / first);
}

/**
 * Mine the real candle history for a window matching `archetype` and return its
 * detrended residual (length FRACTAL_SHAPE_POINTS): strongest up/down move,
 * tightest range, or biggest swing (breakout). Rich history picks an
 * archetype-matched window; thin history falls back to the most recent one.
 * Price is self-similar, so a short mined fractal stretches onto a long horizon.
 */
export function pickFractalShape(
  history: SpotCandle[],
  archetype: FractalArchetype,
  bars: number,
): number[] {
  const closes = history.map((c) => c.close).filter((v) => v > 0);
  if (closes.length < 2) return new Array(FRACTAL_SHAPE_POINTS).fill(0);

  const w = Math.min(
    Math.max(FRACTAL_MIN_ANALYSIS_BARS, Math.min(bars, FRACTAL_MAX_ANALYSIS_BARS)),
    closes.length,
  );

  let bestStart = closes.length - w; // most recent window (thin-history fallback)
  let bestScore = -Infinity;
  for (let s = 0; s + w <= closes.length; s++) {
    const win = closes.slice(s, s + w);
    const net = (win[w - 1]! - win[0]!) / win[0]!;
    let score: number;
    if (archetype === 'up') score = net;
    else if (archetype === 'down') score = -net;
    else {
      const exc = Math.max(...windowResidual(win).map(Math.abs));
      score = archetype === 'breakout' ? exc : -(Math.abs(net) + exc);
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = s;
    }
  }

  return resampleSeries(windowResidual(closes.slice(bestStart, bestStart + w)), FRACTAL_SHAPE_POINTS);
}

/**
 * Re-trend a fractal residual `shape` onto the straight line spot→target: the
 * projected path keeps the real price wiggle but starts at spot and ends exactly
 * at target. An empty/flat shape degenerates to the plain straight glide.
 */
export function buildFractalPathCandles(
  spot: number,
  target: number,
  anchorBarTimeMs: number,
  expiryMs: number,
  resolutionSec: number,
  shape: number[],
): SpotCandle[] {
  const stepMs = resolutionSec * 1000;
  const span = expiryMs - anchorBarTimeMs;
  if (span <= 0 || stepMs <= 0 || spot <= 0) return [];

  const barCount = Math.min(MAX_PROJECTION_BARS, Math.ceil(span / stepMs));
  const resid = resampleSeries(shape, barCount + 1);

  const candles: SpotCandle[] = [];
  let prevPrice = spot;
  for (let i = 1; i <= barCount; i++) {
    const close = spot + (target - spot) * (i / barCount) + (resid[i] ?? 0) * spot;
    const open = prevPrice;
    const wick = Math.max(spot * WICK_PCT, Math.abs(close - open) * WICK_BODY_FRAC);
    candles.push({
      timestamp: anchorBarTimeMs + i * stepMs,
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
  /** Detrended fractal residual that shaped the candles — persisted for faithful snapshot replay. */
  shape: number[];
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
 * flip fall out of one rule (see design doc §3). Each path's candle shape is mined
 * from real `history`: up→strongest up move, down→strongest down move, θ→a tight
 * range when θ profits (short-vol) or a breakout when θ loses (long-vol). A
 * breakout re-trended onto the flat θ target reads as a realistic round-trip.
 */
export function computeGhostPaths(
  legs: Leg[],
  spotPrice: number,
  horizonExpiryMs: number,
  anchorBarTimeMs: number,
  resolutionSec: number,
  history: SpotCandle[],
): GhostPath[] {
  if (legs.length === 0 || spotPrice <= 0) return [];
  if (!Number.isFinite(horizonExpiryMs) || horizonExpiryMs <= anchorBarTimeMs) return [];

  const tYears = Math.max(0, (horizonExpiryMs - anchorBarTimeMs) / MS_PER_YEAR);
  const sigmaMove = spotPrice * representativeIv(legs) * Math.sqrt(tYears);
  const bandHalf = Math.max(sigmaMove * SIGMA_MULTIPLE, spotPrice * MIN_BAND_PCT);
  const bars = Math.min(
    MAX_PROJECTION_BARS,
    Math.ceil((horizonExpiryMs - anchorBarTimeMs) / (resolutionSec * 1000)),
  );

  const targets: { kind: GhostPathKind; target: number }[] = [
    { kind: 'up', target: spotPrice + bandHalf },
    { kind: 'down', target: Math.max(spotPrice * 0.01, spotPrice - bandHalf) },
    { kind: 'theta', target: spotPrice },
  ];

  return targets.map(({ kind, target }) => {
    const pnl = pnlAtPrice(legs, target);
    const isProfit = pnl >= 0;
    const archetype: FractalArchetype =
      kind === 'up' ? 'up' : kind === 'down' ? 'down' : isProfit ? 'range' : 'breakout';
    const shape = pickFractalShape(history, archetype, bars);
    return {
      kind,
      isProfit,
      targetPrice: target,
      pnlAtExpiry: pnl,
      shape,
      candles: buildFractalPathCandles(
        spotPrice,
        target,
        anchorBarTimeMs,
        horizonExpiryMs,
        resolutionSec,
        shape,
      ),
    };
  });
}
