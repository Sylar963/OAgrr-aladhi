import { describe, expect, it } from 'vitest';
import { TradfiStore, emptyQuote } from './store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPL  260417C00200000', streamerSymbol: '.AAPL260417C200',
  canonical: 'AAPL/USD:USD-260417-200-C', multiplier: 100, rootSymbol: 'AAPL',
  settlementType: 'physical', expirationType: 'Regular',
};

describe('TradfiStore', () => {
  it('stores instruments and lists underlyings/expiries', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    expect(s.listUnderlyings()).toEqual(['AAPL']);
    expect(s.listExpiries('AAPL')).toEqual(['2026-04-17']);
    expect(s.instrumentsFor('AAPL', '2026-04-17')).toHaveLength(1);
  });

  it('merges quote patches and reads them back', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    s.mergeQuote('.AAPL260417C200', { bid: 5.1, ask: 5.3, ts: 1 });
    s.mergeQuote('.AAPL260417C200', { iv: 0.4, delta: 0.6, ts: 2 });
    const q = s.getQuote('.AAPL260417C200')!;
    expect(q.bid).toBe(5.1);
    expect(q.iv).toBe(0.4);
    expect(q.delta).toBe(0.6);
    expect(q.ts).toBe(2);
  });

  it('tracks underlying spot', () => {
    const s = new TradfiStore();
    s.setSpot('AAPL', 198.5);
    expect(s.getSpot('AAPL')).toBe(198.5);
  });

  it('emptyQuote has all-null fields', () => {
    expect(emptyQuote().bid).toBeNull();
    expect(emptyQuote().iv).toBeNull();
  });
});
