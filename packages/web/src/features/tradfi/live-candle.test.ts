import { describe, expect, it } from 'vitest';
import { liveBarToCandle, tsToSec } from './live-candle';

describe('live-candle', () => {
  it('tsToSec converts millisecond timestamps to seconds', () => {
    expect(tsToSec(1781553300000)).toBe(1781553300);
    expect(tsToSec(1781553300)).toBe(1781553300);
  });
  it('liveBarToCandle maps a live bar to a lightweight-charts point', () => {
    expect(liveBarToCandle({ ts: 1781553300000, o: 1, h: 2, l: 0, c: 1.5 })).toEqual({
      time: 1781553300,
      open: 1,
      high: 2,
      low: 0,
      close: 1.5,
    });
  });
});
