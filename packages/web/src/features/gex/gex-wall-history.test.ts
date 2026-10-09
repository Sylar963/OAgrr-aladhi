import { describe, expect, it } from 'vitest';

import type { GexWallHistoryPoint } from '@oggregator/protocol';

import { alignWallHistory, smoothWallHistory, type AlignedWalls } from './gex-wall-history';

const HOUR = 3600;

function point(tsSec: number, callWall: number, putWall: number): GexWallHistoryPoint {
  return { ts: tsSec * 1000, spot: null, callWall, putWall, gammaFlip: null };
}

describe('alignWallHistory', () => {
  it('holds the latest snapshot taken before each candle closes', () => {
    const candles = [0, HOUR, 2 * HOUR];
    const points = [point(600, 100, 90), point(HOUR + 1800, 105, 92), point(2 * HOUR + 900, 110, 95)];
    const aligned = alignWallHistory(candles, points, HOUR);
    expect(aligned.map((a) => a.callWall)).toEqual([100, 105, 110]);
    expect(aligned.map((a) => a.time)).toEqual(candles);
  });

  it('skips candles before the first snapshot', () => {
    const aligned = alignWallHistory([0, HOUR, 2 * HOUR], [point(HOUR + 60, 100, 90)], HOUR);
    expect(aligned.map((a) => a.time)).toEqual([HOUR, 2 * HOUR]);
  });

  it('breaks the band across a recording gap', () => {
    const candles = Array.from({ length: 6 }, (_, k) => k * HOUR);
    const aligned = alignWallHistory(candles, [point(0, 100, 90), point(5 * HOUR, 120, 99)], HOUR);
    expect(aligned.map((a) => a.time)).toEqual([0, HOUR, 5 * HOUR]);
  });

  it('accepts unsorted input', () => {
    const aligned = alignWallHistory([0, 900], [point(950, 2, 1), point(10, 1, 0)], 900);
    expect(aligned.map((a) => a.callWall)).toEqual([1, 2]);
  });
});

function aligned(time: number, callWall: number | null, gammaFlip: number | null = null): AlignedWalls {
  return { time, callWall, putWall: 50, gammaFlip };
}

describe('smoothWallHistory', () => {
  it('averages each level over the trailing window', () => {
    const input = [aligned(0, 100), aligned(HOUR, 110), aligned(2 * HOUR, 120), aligned(3 * HOUR, 130)];
    const out = smoothWallHistory(input, 3, HOUR);
    expect(out.map((a) => a.callWall)).toEqual([100, 105, 110, 120]);
    expect(out.map((a) => a.putWall)).toEqual([50, 50, 50, 50]);
  });

  it('restarts the window after a recording gap', () => {
    const input = [aligned(0, 100), aligned(HOUR, 110), aligned(5 * HOUR, 200), aligned(6 * HOUR, 210)];
    const out = smoothWallHistory(input, 3, HOUR);
    expect(out.map((a) => a.callWall)).toEqual([100, 105, 200, 205]);
  });

  it('skips nulls in the mean and keeps null where the raw level is null', () => {
    const input = [aligned(0, 100, 90), aligned(HOUR, 110, null), aligned(2 * HOUR, 120, 96)];
    const out = smoothWallHistory(input, 3, HOUR);
    expect(out.map((a) => a.gammaFlip)).toEqual([90, null, 93]);
  });
});
