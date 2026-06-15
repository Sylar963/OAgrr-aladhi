import { describe, it, expect } from 'vitest';
import { applyLiveTick, pickLiveMid } from './use-instrument-candles.js';
import type { InstrumentCandle } from '@oggregator/protocol';

const base: InstrumentCandle[] = [
  { ts: 1, o: 10, h: 11, l: 9, c: 10.5, vol: 5, synthetic: false },
  { ts: 2, o: 10.5, h: 12, l: 10, c: 11, vol: 3, synthetic: false },
];

describe('applyLiveTick', () => {
  it('extends last candle close and updates high when mid moves above prior high', () => {
    const out = applyLiveTick(base, 13);
    const last = out[out.length - 1]!;
    expect(last.c).toBe(13);
    expect(last.h).toBe(13);
  });

  it('lowers low when mid drops below prior low', () => {
    const out = applyLiveTick(base, 8);
    const last = out[out.length - 1]!;
    expect(last.l).toBe(8);
    expect(last.c).toBe(8);
  });

  it('returns original array reference when liveMid is null', () => {
    const out = applyLiveTick(base, null);
    expect(out).toBe(base);
  });

  it('returns empty when candle list is empty', () => {
    const out = applyLiveTick([], 10);
    expect(out).toEqual([]);
  });
});

describe('pickLiveMid', () => {
  it('returns raw value when priceCurrency is BTC (inverse venue chart axis)', () => {
    expect(pickLiveMid({ usd: 1481.85, raw: 0.02 }, 'BTC')).toBe(0.02);
  });

  it('returns raw value when priceCurrency is ETH', () => {
    expect(pickLiveMid({ usd: 100, raw: 0.05 }, 'ETH')).toBe(0.05);
  });

  it('returns USD value when priceCurrency is USD', () => {
    expect(pickLiveMid({ usd: 1481.85, raw: 0.02 }, 'USD')).toBe(1481.85);
  });

  it('returns USD value when priceCurrency is a stablecoin (USDT/USDC)', () => {
    expect(pickLiveMid({ usd: 100, raw: 100 }, 'USDT')).toBe(100);
    expect(pickLiveMid({ usd: 100, raw: 100 }, 'USDC')).toBe(100);
  });

  it('returns null when liveMid is null', () => {
    expect(pickLiveMid(null, 'BTC')).toBeNull();
    expect(pickLiveMid(null, 'USD')).toBeNull();
  });

  it('returns null when the selected leg is null', () => {
    expect(pickLiveMid({ usd: null, raw: 0.02 }, 'USD')).toBeNull();
    expect(pickLiveMid({ usd: 1481.85, raw: null }, 'BTC')).toBeNull();
  });

  it('falls back to USD when priceCurrency is unknown', () => {
    expect(pickLiveMid({ usd: 50, raw: 50 }, null)).toBe(50);
    expect(pickLiveMid({ usd: 50, raw: 50 }, 'XYZ')).toBe(50);
  });
});
