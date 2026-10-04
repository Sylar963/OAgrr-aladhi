import type { GammaWalls } from './gex-wall-utils';

/** One server-sampled wall snapshot (`GET /gex-wall-history`). */
export interface GexWallPoint {
  ts: number;
  spot: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
}

export interface GexWallHistoryResponse {
  underlying: string;
  resolutionSec: number;
  points: GexWallPoint[];
}

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
  points: readonly GexWallPoint[],
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
