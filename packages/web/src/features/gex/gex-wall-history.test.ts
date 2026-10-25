import { describe, expect, it } from 'vitest';

import type { GexWallHistoryPoint } from '@oggregator/protocol';

import { alignWallHistory, gexKeltner, type AlignedWalls } from './gex-wall-history';

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

function walls(
  time: number,
  callWall: number | null,
  putWall: number | null,
  gammaFlip: number | null = null,
): AlignedWalls {
  return { time, callWall, putWall, gammaFlip };
}

function closes(...values: number[]) {
  return values.map((close, k) => ({ time: k * HOUR, close }));
}

describe('gexKeltner', () => {
  it('offsets the EMA basis by the EMA of each wall distance', () => {
    const out = gexKeltner(closes(100, 103), [walls(0, 110, 95), walls(HOUR, 120, 95)], 3);
    expect(out[0]).toEqual({ time: 0, basis: 100, upper: 110, lower: 95, gammaFlip: null });
    expect(out[1]!.basis).toBeCloseTo(101.5);
    expect(out[1]!.upper).toBeCloseTo(101.5 + 13.5);
    expect(out[1]!.lower).toBeCloseTo(101.5 - 6.5);
  });

  it('warms the basis on candles before the first snapshot without emitting them', () => {
    const out = gexKeltner(closes(90, 110), [walls(HOUR, 120, 100)], 3);
    expect(out.map((p) => p.time)).toEqual([HOUR]);
    expect(out[0]!.basis).toBe(100);
    expect(out[0]!.upper).toBe(110);
  });

  it('holds wall distances through short gaps and drops them after `length` idle candles', () => {
    const out = gexKeltner(closes(100, 100, 100, 100, 100), [walls(0, 110, 90)], 3);
    expect(out.map((p) => p.time)).toEqual([0, HOUR, 2 * HOUR]);
    expect(out.map((p) => p.upper)).toEqual([110, 110, 110]);
  });

  it('reseeds a side after it was dropped', () => {
    const series = closes(100, 100, 100, 100, 100);
    const out = gexKeltner(series, [walls(0, 110, 90), walls(4 * HOUR, 130, 90)], 2);
    expect(out.map((p) => p.time)).toEqual([0, HOUR, 4 * HOUR]);
    expect(out[2]!.upper).toBe(130);
  });

  it('keeps one side when the other wall is missing', () => {
    const out = gexKeltner(closes(100), [walls(0, null, 90)], 3);
    expect(out[0]).toMatchObject({ upper: null, lower: 90 });
  });

  it('emits the smoothed flip only where the snapshot has one', () => {
    const out = gexKeltner(
      closes(100, 100, 100),
      [walls(0, 110, 90, 96), walls(HOUR, 110, 90, null), walls(2 * HOUR, 110, 90, 100)],
      3,
    );
    expect(out.map((p) => p.gammaFlip)).toEqual([96, null, 98]);
  });
});
