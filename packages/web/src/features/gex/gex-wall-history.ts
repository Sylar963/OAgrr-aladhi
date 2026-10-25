import type { GexWallHistoryPoint } from '@oggregator/protocol';

import type { GammaWalls } from './gex-wall-utils';

/** Wall levels held at a candle's open time (seconds). */
export interface AlignedWalls extends GammaWalls {
  time: number;
}

// Snapshots are taken every 15 min; anything older than two missed samples (or
// two candles on coarse timeframes) is a recording gap and must break the line.
const SAMPLE_SEC = 900;

/**
 * Step-hold wall snapshots onto candle times: each candle takes the latest
 * snapshot taken before the candle closed. Candles before the first snapshot
 * or inside a recording gap get no levels, so the band only covers time we
 * actually observed.
 */
export function alignWallHistory(
  candleTimesSec: readonly number[],
  points: readonly GexWallHistoryPoint[],
  resolutionSec: number,
): AlignedWalls[] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const maxStaleSec = 2 * Math.max(resolutionSec, SAMPLE_SEC);
  const out: AlignedWalls[] = [];
  let i = -1;
  for (const time of candleTimesSec) {
    const closeSec = time + resolutionSec;
    while (i + 1 < sorted.length && sorted[i + 1]!.ts / 1000 < closeSec) i++;
    const p = i >= 0 ? sorted[i]! : null;
    if (!p || closeSec - p.ts / 1000 > maxStaleSec) continue;
    out.push({ time, callWall: p.callWall, putWall: p.putWall, gammaFlip: p.gammaFlip });
  }
  return out;
}

export interface CandleClose {
  time: number;
  close: number;
}

/** One candle of the GEX Keltner channel; null levels break the drawn line. */
export interface GexKeltnerPoint {
  time: number;
  basis: number | null;
  upper: number | null;
  lower: number | null;
  gammaFlip: number | null;
}

interface Ema {
  value: number | null;
  idle: number;
}

function stepEma(ema: Ema, sample: number | null, alpha: number, maxIdle: number): void {
  if (sample == null) {
    ema.idle++;
    if (ema.idle >= maxIdle) ema.value = null;
    return;
  }
  ema.value = ema.value == null ? sample : ema.value + alpha * (sample - ema.value);
  ema.idle = 0;
}

/**
 * Keltner channel with the ATR swapped for dealer wall distance:
 * basis = EMA(close), upper = basis + EMA(callWall − close),
 * lower = basis − EMA(close − putWall), all over `length` candles.
 *
 * Wall EMAs seed on their first snapshot and hold through candles without
 * one; a side unobserved for `length` candles resets, so a long recording gap
 * is never bridged with stale distances. The flip gets the same EMA but is
 * only emitted where the candle's snapshot carries a flip.
 */
export function gexKeltner(
  candles: readonly CandleClose[],
  walls: readonly AlignedWalls[],
  length: number,
): GexKeltnerPoint[] {
  const alpha = 2 / (length + 1);
  const byTime = new Map(walls.map((w) => [w.time, w]));
  const above: Ema = { value: null, idle: 0 };
  const below: Ema = { value: null, idle: 0 };
  const flip: Ema = { value: null, idle: 0 };
  const out: GexKeltnerPoint[] = [];
  let basis: number | null = null;
  for (const { time, close } of candles) {
    basis = basis == null ? close : basis + alpha * (close - basis);
    const w = byTime.get(time);
    stepEma(above, w?.callWall == null ? null : w.callWall - close, alpha, length);
    stepEma(below, w?.putWall == null ? null : close - w.putWall, alpha, length);
    stepEma(flip, w?.gammaFlip ?? null, alpha, length);
    if (above.value == null && below.value == null) continue;
    out.push({
      time,
      basis,
      upper: above.value == null ? null : basis + above.value,
      lower: below.value == null ? null : basis - below.value,
      gammaFlip: w?.gammaFlip == null ? null : flip.value,
    });
  }
  return out;
}
