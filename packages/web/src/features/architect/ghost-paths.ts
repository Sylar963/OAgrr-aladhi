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
/** Stationary bar-noise stdev as a multiple of the per-bar realized sigma. */
export const TEXTURE_BODY_K = 1.2;
/** Bar-to-bar persistence of the noise (AR(1)); keeps bodies from flip-flopping every bar. */
export const TEXTURE_PHI = 0.5;
export const TEXTURE_WICK_K = 0.6;
/** Noise fades out over the last slice of the horizon so each path still lands on its target. */
export const TEXTURE_TAPER_FRAC = 0.04;
const RV_LOOKBACK_BARS = 240;
const RV_MIN_BARS = 10;
const MIN_TEXTURE_VOL = 0.05;
const MAX_TEXTURE_VOL = 3;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

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

/** Annualized close-to-close realized vol (fraction) of recent history, or null when too thin. */
export function realizedVol(history: readonly SpotCandle[], resolutionSec: number): number | null {
  const closes = history
    .slice(-(RV_LOOKBACK_BARS + 1))
    .map((c) => c.close)
    .filter((v) => v > 0);
  if (closes.length < RV_MIN_BARS || resolutionSec <= 0) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i]! / closes[i - 1]!));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const vol = Math.sqrt(variance * (MS_PER_YEAR / (resolutionSec * 1000)));
  if (!Number.isFinite(vol) || vol <= 0) return null;
  return Math.min(MAX_TEXTURE_VOL, Math.max(MIN_TEXTURE_VOL, vol));
}

/**
 * Bar times for a projection anchored at `anchorMs`, laid onto the chart's
 * current time scale. lightweight-charts spaces bars by index, not by time, so
 * any path time that isn't already a real candle time inserts an empty slot and
 * warps the axis (a 4H snapshot on a 1H chart renders sparse; a 1H snapshot on
 * a 4H chart stretches the real candles apart). Real candle times are reused
 * inside the history window; outside it the path steps on the resolution grid.
 */
export function projectionTimesOnGrid(
  anchorMs: number,
  expiryMs: number,
  resolutionSec: number,
  gridTimesMs: readonly number[],
): number[] {
  const stepMs = resolutionSec * 1000;
  if (expiryMs <= anchorMs || stepMs <= 0) return [];

  const times: number[] = [];
  const done = () =>
    times.length >= MAX_PROJECTION_BARS || (times.at(-1) ?? anchorMs) >= expiryMs;
  const firstReal = gridTimesMs[0] ?? Infinity;
  const lastReal = gridTimesMs.at(-1) ?? -Infinity;

  let t = Math.floor(anchorMs / stepMs) * stepMs + stepMs;
  for (; !done() && t < firstReal; t += stepMs) times.push(t);
  for (const g of gridTimesMs) {
    if (done()) break;
    if (g > anchorMs) times.push(g);
  }
  for (t = lastReal >= anchorMs ? lastReal + stepMs : t; !done(); t += stepMs) times.push(t);
  return times;
}

function sampleShape(shape: readonly number[], frac: number): number {
  const n = shape.length;
  if (n === 0) return 0;
  if (n === 1) return shape[0]!;
  const pos = frac * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return shape[lo]! + (pos - lo) * (shape[hi]! - shape[lo]!);
}

export interface PathTexture {
  /** Annualized vol (fraction) sizing bar bodies and wicks. */
  vol: number;
  /** Decorrelates paths that share bar times (up vs down, live vs snapshot). */
  seed: number;
}

function mix32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic standard normal keyed by (seed, bar time, channel): re-rendering
 * or replaying a path yields the same candles, with no stored noise.
 */
function gaussAt(seed: number, timeMs: number, channel: number): number {
  const key = mix32(seed, Math.floor(timeMs / 1000) | 0);
  const u1 = (mix32(key, channel * 2) + 0.5) / 4294967296;
  const u2 = (mix32(key, channel * 2 + 1) + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const KIND_SALT: Record<GhostPathKind, number> = { up: 1, down: 2, theta: 3 };

export function pathTexture(kind: GhostPathKind, vol: number, anchorMs: number): PathTexture {
  return { vol, seed: mix32(KIND_SALT[kind], Math.floor(anchorMs / 1000) | 0) };
}

/**
 * Ghost candles at arbitrary bar `times`: a straight spot→target glide, plus the
 * mined fractal residual for the macro shape, plus optional AR(1) bar noise
 * sized by realized vol for candle-level texture (random bodies and wicks).
 * The noise tapers to zero at expiry, so every path still lands exactly on its
 * target. These are scenario illustrations, NOT forecasts. Without a texture
 * the WICK_PCT floor keeps a flat (theta) path readable as candles.
 */
export function buildFractalPathOnTimes(
  spot: number,
  target: number,
  anchorMs: number,
  expiryMs: number,
  times: readonly number[],
  shape: readonly number[],
  texture?: PathTexture,
): SpotCandle[] {
  const span = expiryMs - anchorMs;
  if (span <= 0 || spot <= 0) return [];

  const innovationK = TEXTURE_BODY_K * Math.sqrt(1 - TEXTURE_PHI ** 2);
  const candles: SpotCandle[] = [];
  let prevPrice = spot;
  let prevT = anchorMs;
  let noise = 0;
  for (const t of times) {
    const frac = Math.min(1, Math.max(0, (t - anchorMs) / span));
    let close = spot + (target - spot) * frac + sampleShape(shape, frac) * spot;
    const open = prevPrice;
    let wickUp: number;
    let wickDown: number;
    if (texture) {
      const barSigma = texture.vol * Math.sqrt(Math.max(0, t - prevT) / MS_PER_YEAR);
      noise = TEXTURE_PHI * noise + barSigma * innovationK * gaussAt(texture.seed, t, 0);
      const taper = Math.min(1, Math.max(0, (1 - frac) / TEXTURE_TAPER_FRAC));
      close += noise * taper * spot;
      wickUp = spot * Math.max(WICK_PCT, barSigma * TEXTURE_WICK_K * Math.abs(gaussAt(texture.seed, t, 1)));
      wickDown = spot * Math.max(WICK_PCT, barSigma * TEXTURE_WICK_K * Math.abs(gaussAt(texture.seed, t, 2)));
    } else {
      wickUp = wickDown = Math.max(spot * WICK_PCT, Math.abs(close - open) * WICK_BODY_FRAC);
    }
    candles.push({
      timestamp: t,
      open,
      high: Math.max(open, close) + wickUp,
      low: Math.min(open, close) - wickDown,
      close,
    });
    prevPrice = close;
    prevT = t;
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
  /** Annualized vol that sized the candle texture — persisted alongside `shape`. */
  textureVol: number;
  candles: SpotCandle[];
}

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
 * Candle texture uses the history's realized vol, falling back to the legs' IV.
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

  const iv = representativeIv(legs);
  const tYears = Math.max(0, (horizonExpiryMs - anchorBarTimeMs) / MS_PER_YEAR);
  const sigmaMove = spotPrice * iv * Math.sqrt(tYears);
  const bandHalf = Math.max(sigmaMove * SIGMA_MULTIPLE, spotPrice * MIN_BAND_PCT);
  const bars = Math.min(
    MAX_PROJECTION_BARS,
    Math.ceil((horizonExpiryMs - anchorBarTimeMs) / (resolutionSec * 1000)),
  );
  // The anchor is the last real candle, so stepping from it stays on the chart's grid.
  const times = projectionTimesOnGrid(anchorBarTimeMs, horizonExpiryMs, resolutionSec, [
    anchorBarTimeMs,
  ]);
  const textureVol = realizedVol(history, resolutionSec) ?? iv;

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
      textureVol,
      candles: buildFractalPathOnTimes(
        spotPrice,
        target,
        anchorBarTimeMs,
        horizonExpiryMs,
        times,
        shape,
        pathTexture(kind, textureVol, anchorBarTimeMs),
      ),
    };
  });
}
