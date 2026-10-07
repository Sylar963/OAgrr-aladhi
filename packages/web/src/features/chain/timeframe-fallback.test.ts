import { describe, it, expect } from 'vitest';
import type { InstrumentCandlesResponse } from '@oggregator/protocol';
import { fallbackTimeframes, isCandleStateUnavailable } from './timeframe-fallback.js';

const tf = (s: string) => {
  const [interval, range] = s.split('/');
  return { interval, range };
};

describe('fallbackTimeframes', () => {
  it('tries coarser bars, then wider windows, then finer bars', () => {
    expect(fallbackTimeframes({ interval: '1h', range: '7d' })).toEqual(
      ['4h/7d', '1d/7d', '1h/30d', '4h/30d', '1d/30d', '1h/max', '4h/max', '1d/max', '15m/7d', '5m/7d', '1m/7d'].map(tf),
    );
  });

  it('never yields the anchor itself', () => {
    const out = fallbackTimeframes({ interval: '1d', range: 'max' });
    expect(out).toEqual(['4h/max', '1h/max', '15m/max', '5m/max', '1m/max'].map(tf));
  });
});

describe('isCandleStateUnavailable', () => {
  const resp = (n: number) => ({ candles: Array(n).fill(null) }) as unknown as InstrumentCandlesResponse;

  it('treats errors and empty successes as unavailable', () => {
    expect(isCandleStateUnavailable({ status: 'error' })).toBe(true);
    expect(isCandleStateUnavailable({ status: 'success', data: resp(0) })).toBe(true);
  });

  it('keeps pending, unknown and non-empty timeframes available', () => {
    expect(isCandleStateUnavailable(undefined)).toBe(false);
    expect(isCandleStateUnavailable({ status: 'pending' })).toBe(false);
    expect(isCandleStateUnavailable({ status: 'success', data: resp(3) })).toBe(false);
  });
});
