import { describe, it, expect } from 'vitest';
import { buildCandlesResponse } from './candles.js';
import { TradfiStore } from './store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

const inst: TradfiInstrument = {
  underlying: 'SPX', expiry: '2026-06-23', strike: 7555, right: 'call',
  occSymbol: 'SPX   260623C07555000', streamerSymbol: '.SPXW260623C7555',
  canonical: 'SPX/USD:USD-260623-7555-C', multiplier: 100, rootSymbol: 'SPXW',
  settlementType: 'cash', expirationType: 'Weekly',
};

describe('buildCandlesResponse', () => {
  it('resolves the streamer symbol and maps raw bars to the candle payload', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]);
    const fakeClient = { getCandles: async () => [
      { symbol: '.SPXW260623C7555', flags: 0, time: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, v: 3 },
    ] };
    const res = await buildCandlesResponse(fakeClient as Parameters<typeof buildCandlesResponse>[0], store, {
      underlying: 'SPX', expiry: '2026-06-23', strike: 7555, right: 'call', interval: '5m', range: '7d', nowMs: 1_700_000_000_000,
    });
    expect(res).not.toBeNull();
    expect(res!.symbol).toBe('.SPXW260623C7555');
    expect(res!.priceCurrency).toBe('USD');
    expect(res!.candles).toEqual([{ ts: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, vol: 3, synthetic: false }]);
  });

  it('returns null when no instrument matches', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]);
    const res = await buildCandlesResponse({ getCandles: async () => [] } as Parameters<typeof buildCandlesResponse>[0], store, {
      underlying: 'SPX', expiry: '2026-06-23', strike: 9999, right: 'call', interval: '5m', range: '7d', nowMs: 1,
    });
    expect(res).toBeNull();
  });
});
