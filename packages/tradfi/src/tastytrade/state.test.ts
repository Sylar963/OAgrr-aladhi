import { describe, expect, it } from 'vitest';
import { applyEvent } from './state.js';
import { TradfiStore } from '../runtime/store.js';
import type { TradfiInstrument } from './instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPLC', streamerSymbol: '.AAPL200C', canonical: 'AAPL/USD:USD-260417-200-C',
  multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
};

describe('applyEvent', () => {
  it('merges a Quote into a contract and computes mark', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    applyEvent(s, { eventType: 'Quote', eventSymbol: '.AAPL200C', bidPrice: 5, askPrice: 5.4, bidSize: 1, askSize: 2 }, 10);
    const q = s.getQuote('.AAPL200C')!;
    expect(q.bid).toBe(5);
    expect(q.ask).toBe(5.4);
    expect(q.mark).toBeCloseTo(5.2);
  });

  it('merges Greeks (volatility -> iv)', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    applyEvent(s, { eventType: 'Greeks', eventSymbol: '.AAPL200C', volatility: 0.4, delta: 0.55, gamma: 0.02, theta: -0.03, rho: 0.01, vega: 0.12 }, 11);
    const q = s.getQuote('.AAPL200C')!;
    expect(q.iv).toBe(0.4);
    expect(q.delta).toBe(0.55);
  });

  it('sets spot when the event is for an underlying symbol', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    applyEvent(s, { eventType: 'Trade', eventSymbol: 'AAPL', price: 198.5, dayVolume: 1000 }, 12);
    expect(s.getSpot('AAPL')).toBe(198.5);
  });
});
