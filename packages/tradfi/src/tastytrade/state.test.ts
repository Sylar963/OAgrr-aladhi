import { describe, expect, it } from 'vitest';
import { applyEvent } from './state.js';
import { TradfiStore } from '../runtime/store.js';
import { TradfiFlowBook } from '../runtime/flow-book.js';
import type { TradfiInstrument } from './instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPLC', streamerSymbol: '.AAPL200C', canonical: 'AAPL/USD:USD-260417-200-C',
  multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
};

const spxInst: TradfiInstrument = {
  underlying: 'SPX',
  expiry: '2026-06-18',
  strike: 5000,
  right: 'call',
  occSymbol: 'SPXC5000',
  streamerSymbol: '.SPX260618C5000',
  canonical: 'SPX-20260618-5000-C',
  multiplier: 100,
  rootSymbol: 'SPX',
  settlementType: 'cash',
  expirationType: 'Regular',
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

it('records Lee-Ready-signed flow for option trades when a flow book is passed', () => {
  const store = new TradfiStore();
  store.setInstruments([spxInst]);
  const flow = new TradfiFlowBook();
  const ts = Date.parse('2026-06-16T15:00:00Z');

  // Prevailing quote: bid 1.0 / ask 2.0 (mid 1.5).
  applyEvent(store, { eventType: 'Quote', eventSymbol: '.SPX260618C5000', bidPrice: 1.0, askPrice: 2.0 }, ts);
  // Trade above mid, size 5 → buy-initiated → +5.
  applyEvent(store, { eventType: 'Trade', eventSymbol: '.SPX260618C5000', price: 1.8, size: 5, dayVolume: 5 }, ts, flow);

  expect(flow.netFlowFor('SPX-20260618-5000-C')).toBe(5);
});

it('does not record flow for underlying (spot) trades', () => {
  const store = new TradfiStore();
  const flow = new TradfiFlowBook();
  applyEvent(store, { eventType: 'Trade', eventSymbol: 'SPX', price: 5000, size: 1, dayVolume: 1 }, Date.now(), flow);
  expect(flow.size()).toBe(0);
});
