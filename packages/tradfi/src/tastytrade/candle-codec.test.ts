import { describe, it, expect } from 'vitest';
import {
  parseCandleFrame, isSnapshotComplete, intervalToPeriod, rangeToFromTimeSec, buildCandleSubscribe,
} from './candle-codec.js';

describe('parseCandleFrame', () => {
  it('parses a compact Candle frame, dropping non-finite delimiter bars', () => {
    const frame = { type: 'FEED_DATA', channel: 1, data: ['Candle', [
      'Candle', '.SPXW260623C7555{=5m}', 4, 1781553000000, 55.9, 55.9, 55.9, 55.9, 1,
      'Candle', '.SPXW260623C7555{=5m}', 10, 1781553300000, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN',
    ]] };
    const bars = parseCandleFrame(frame);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ symbol: '.SPXW260623C7555{=5m}', flags: 4, time: 1781553000000, c: 55.9 });
    expect(Number.isFinite(bars[1]!.c)).toBe(false); // delimiter retained for flag inspection
  });
  it('ignores non-Candle frames', () => {
    expect(parseCandleFrame({ type: 'FEED_CONFIG', channel: 1 })).toEqual([]);
  });
});

describe('isSnapshotComplete', () => {
  it('is true for SNAPSHOT_END (0x08) or SNAPSHOT_SNIP (0x10)', () => {
    expect(isSnapshotComplete(0x0a)).toBe(true);
    expect(isSnapshotComplete(0x12)).toBe(true);
    expect(isSnapshotComplete(0x04)).toBe(false);
    expect(isSnapshotComplete(0x00)).toBe(false);
  });
});

describe('mappings', () => {
  it('maps interval to a DXFeed candle period', () => {
    expect(intervalToPeriod('5m')).toBe('5m');
    expect(intervalToPeriod('1d')).toBe('1d');
  });
  it('computes fromTime seconds from a range', () => {
    const now = 1_700_000_000_000;
    expect(rangeToFromTimeSec('1d', now)).toBe(Math.floor((now - 86_400_000) / 1000));
  });
  it('builds a Candle subscribe with fromTime', () => {
    expect(buildCandleSubscribe(1, 'SPY{=5m}', 123)).toEqual({
      type: 'FEED_SUBSCRIPTION', channel: 1, add: [{ type: 'Candle', symbol: 'SPY{=5m}', fromTime: 123 }],
    });
  });
});
