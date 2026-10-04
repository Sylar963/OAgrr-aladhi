import { describe, expect, it } from 'vitest';

import { alignWallHistory, type GexWallPoint } from './gex-wall-history';

const HOUR = 3600;

function point(tsSec: number, callWall: number, putWall: number): GexWallPoint {
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
