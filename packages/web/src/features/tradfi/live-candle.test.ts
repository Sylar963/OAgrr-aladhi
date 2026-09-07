import { describe, expect, it } from 'vitest';
import { liveBarToCandle, mergeLiveBars, tsToSec } from './live-candle';

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

  it('merges replay bars into history and replaces a forming candle', () => {
    const history = [
      { timestamp: 1000, open: 10, high: 11, low: 9, close: 10 },
      { timestamp: 2000, open: 10, high: 12, low: 10, close: 11 },
    ];
    const liveBars = [
      { ts: 2000, o: 10, h: 13, l: 10, c: 12, vol: 2 },
      { ts: 3000, o: 12, h: 14, l: 11, c: 13, vol: 3 },
    ];

    expect(mergeLiveBars(history, liveBars)).toEqual([
      { timestamp: 1000, open: 10, high: 11, low: 9, close: 10 },
      { timestamp: 2000, open: 10, high: 13, low: 10, close: 12 },
      { timestamp: 3000, open: 12, high: 14, low: 11, close: 13 },
    ]);
  });
});
