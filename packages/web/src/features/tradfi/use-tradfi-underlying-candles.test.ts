import { describe, expect, it } from 'vitest';
import { parseTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';

describe('parseTradfiUnderlyingCandles', () => {
  it('parses a valid payload', () => {
    const out = parseTradfiUnderlyingCandles({
      candles: [{ ts: 1, o: 1, h: 2, l: 0.5, c: 1.5, vol: 3, synthetic: false }],
      markLine: [],
    });
    expect(out.candles).toHaveLength(1);
  });

  it('throws on a malformed payload', () => {
    expect(() => parseTradfiUnderlyingCandles({ candles: [{ ts: 'x' }] })).toThrow();
  });
});
