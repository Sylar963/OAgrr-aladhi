import { describe, expect, it } from 'vitest';

import { hasUsableSpotCandles, isSpotCandleCurrency } from './queries';

describe('hasUsableSpotCandles', () => {
  it('returns true when the response has candle history', () => {
    expect(
      hasUsableSpotCandles({
        currency: 'BTC',
        resolution: 3600,
        count: 1,
        candles: [{ timestamp: 1, open: 1, high: 2, low: 1, close: 2 }],
      }),
    ).toBe(true);
  });

  it('returns false for null, undefined, and empty candle arrays', () => {
    expect(hasUsableSpotCandles(null)).toBe(false);
    expect(hasUsableSpotCandles(undefined)).toBe(false);
    expect(
      hasUsableSpotCandles({
        currency: 'BTC',
        resolution: 3600,
        count: 0,
        candles: [],
      }),
    ).toBe(false);
  });
});

describe('isSpotCandleCurrency', () => {
  it('recognizes BTC, ETH, and HYPE; rejects others', () => {
    expect(isSpotCandleCurrency('BTC')).toBe(true);
    expect(isSpotCandleCurrency('ETH')).toBe(true);
    expect(isSpotCandleCurrency('HYPE')).toBe(true);
    expect(isSpotCandleCurrency('SOL')).toBe(false);
  });
});
