import { describe, expect, it } from 'vitest';
import { TradfiStore } from './store.js';
import { buildChain } from './chain.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

function inst(right: 'call' | 'put', strike: number): TradfiInstrument {
  return {
    underlying: 'AAPL', expiry: '2026-04-17', strike, right,
    occSymbol: `AAPL...${strike}${right}`, streamerSymbol: `.AAPL${strike}${right[0]}`,
    canonical: `AAPL/USD:USD-260417-${strike}-${right === 'call' ? 'C' : 'P'}`,
    multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
  };
}

describe('buildChain', () => {
  it('returns an enriched chain with the requested underlying/expiry', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { bid: 5, ask: 5.2, mark: 5.1, iv: 0.4, delta: 0.55, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { bid: 6, ask: 6.2, mark: 6.1, iv: 0.42, delta: -0.45, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    expect(enriched.underlying).toBe('AAPL');
    expect(enriched.expiry).toBe('2026-04-17');
    expect(enriched.strikes.length).toBe(1);
  });

  it('rolls per-strike OI into USD-notional stats (totalOiUsd, put/call ratio)', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { mark: 5.1, openInterest: 10, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { mark: 6.1, openInterest: 4, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    // OI notional = contracts × multiplier(100) × spot(198); was 0 when openInterestUsd was left null.
    expect(enriched.stats.totalOiUsd).toBe((10 + 4) * 100 * 198);
    expect(enriched.stats.putCallOiRatio).toBeCloseTo(4 / 10);
  });

  it('derives a put-call-parity forward so basis is non-zero', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    // ATM strike 200 (closest to spot). Call richer than put → synthetic forward > spot.
    store.mergeQuote(c.streamerSymbol, { mark: 7, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { mark: 4, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    // F = K + (callMark − putMark) = 200 + (7 − 4) = 203.
    expect(enriched.stats.forwardPriceUsd).toBeCloseTo(203);
    expect(enriched.stats.basisPct).toBeCloseTo(((203 - 198) / 198) * 100);
    expect(enriched.stats.basisPct).not.toBe(0);
  });

  it('falls back to spot (basis 0) when ATM marks are missing', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { openInterest: 5, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { openInterest: 5, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    expect(enriched.stats.basisPct).toBe(0);
  });
});
