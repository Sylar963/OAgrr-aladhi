import { it, expect } from 'vitest';
import { parseTradfiCandles } from './use-tradfi-candles';

it('parses candle arrays, ignoring extra fields', () => {
  const raw = {
    symbol: '.SPXW...',
    interval: '5m',
    priceCurrency: 'USD',
    candles: [{ ts: 1, o: 1, h: 2, l: 0.5, c: 1.5, vol: 3, synthetic: false }],
    markLine: [],
  };
  const p = parseTradfiCandles(raw);
  expect(p.candles).toHaveLength(1);
  expect(p.markLine).toEqual([]);
});

it('returns markLine entries when present', () => {
  const raw = {
    candles: [{ ts: 100, o: 2, h: 3, l: 1, c: 2.5, vol: 10, synthetic: true }],
    markLine: [{ ts: 100, c: 2.5 }],
  };
  const p = parseTradfiCandles(raw);
  expect(p.candles[0]?.synthetic).toBe(true);
  expect(p.markLine).toHaveLength(1);
});

it('throws when candle array has invalid shape', () => {
  const raw = {
    candles: [{ ts: 'bad', o: 1, h: 2, l: 0.5, c: 1.5, vol: 3, synthetic: false }],
    markLine: [],
  };
  expect(() => parseTradfiCandles(raw)).toThrow('tradfi candles schema mismatch');
});
