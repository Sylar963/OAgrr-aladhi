import { describe, expect, it } from 'vitest';
import {
  aggregateBars,
  applyTick,
  mergeFormingBar,
  rollupBars,
  scaleBar,
  weightedMedian,
  type VenueBar,
} from './aggregate.js';

const bar = (open: number, high: number, low: number, close: number, volume = 1): VenueBar => ({
  timestamp: 0,
  open,
  high,
  low,
  close,
  volume,
});

describe('weightedMedian', () => {
  it('takes the middle value', () => {
    const entries = [1, 2, 3].map((value) => ({ value, weight: 1 }));
    expect(weightedMedian(entries)).toBe(2);
  });

  it('averages the neighbours when the weight splits evenly', () => {
    const entries = [1, 3].map((value) => ({ value, weight: 1 }));
    expect(weightedMedian(entries)).toBe(2);
  });

  it('lets a double-weighted entry pull the result', () => {
    expect(
      weightedMedian([
        { value: 1, weight: 1 },
        { value: 2, weight: 2 },
        { value: 3, weight: 1 },
        { value: 4, weight: 1 },
      ]),
    ).toBe(2);
  });
});

describe('aggregateBars', () => {
  it('sums volume and counts venues', () => {
    const candle = aggregateBars(1000, [
      { bar: bar(100, 110, 90, 105, 2), weight: 1 },
      { bar: bar(101, 111, 91, 106, 3), weight: 1 },
      { bar: bar(102, 112, 92, 107, 5), weight: 1 },
    ]);
    expect(candle).toEqual({
      timestamp: 1000,
      open: 101,
      high: 111,
      low: 91,
      close: 106,
      volume: 10,
      venues: 3,
    });
  });

  it('ignores a single venue printing a bad wick', () => {
    const candle = aggregateBars(0, [
      { bar: bar(100, 101, 99, 100), weight: 1 },
      { bar: bar(100, 101, 99, 100), weight: 1 },
      { bar: bar(100, 9000, 1, 100), weight: 1 },
    ]);
    expect(candle?.high).toBe(101);
    expect(candle?.low).toBe(99);
  });

  it('keeps a valid candle however the venues disagree', () => {
    const candle = aggregateBars(0, [
      { bar: bar(100, 120, 95, 96), weight: 2 },
      { bar: bar(110, 111, 104, 105), weight: 1 },
      { bar: bar(90, 130, 89, 129), weight: 1 },
      { bar: bar(105, 106, 80, 81), weight: 1 },
    ])!;
    expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
    expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
  });

  it('returns null with no venues', () => {
    expect(aggregateBars(0, [])).toBeNull();
  });
});

describe('rollupBars', () => {
  it('takes the first open, last close, extremes and summed volume', () => {
    expect(rollupBars(5, [bar(10, 12, 9, 11, 1), bar(11, 15, 10, 14, 2)])).toEqual({
      timestamp: 5,
      open: 10,
      high: 15,
      low: 9,
      close: 14,
      volume: 3,
    });
  });
});

describe('scaleBar', () => {
  it('converts prices and leaves base volume alone', () => {
    expect(scaleBar(bar(100, 200, 50, 150, 7), 0.5)).toEqual({
      timestamp: 0,
      open: 50,
      high: 100,
      low: 25,
      close: 75,
      volume: 7,
    });
  });
});

describe('applyTick', () => {
  it('starts a bar from the first tick, then extends it', () => {
    const first = applyTick(undefined, 60_000, 100, 1);
    expect(first).toEqual({ timestamp: 60_000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
    expect(applyTick(first, 60_000, 90, 2)).toEqual({
      timestamp: 60_000,
      open: 100,
      high: 100,
      low: 90,
      close: 90,
      volume: 3,
    });
  });
});

describe('mergeFormingBar', () => {
  it('takes the true open and range from REST but keeps the live close', () => {
    expect(mergeFormingBar(bar(105, 106, 104, 105.5, 1), bar(100, 107, 99, 103, 9))).toEqual({
      timestamp: 0,
      open: 100,
      high: 107,
      low: 99,
      close: 105.5,
      volume: 9,
    });
  });
});
