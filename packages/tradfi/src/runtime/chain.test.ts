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
});
