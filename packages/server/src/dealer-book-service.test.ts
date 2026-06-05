import type { NormalizedOptionContract, VenueOptionChain } from '@oggregator/core';
import { EMPTY_GREEKS } from '@oggregator/core';
import { NoopDealerBookStore, NoopOiSnapshotStore } from '@oggregator/db';
import { describe, expect, it } from 'vitest';
import { DealerBookService } from './dealer-book-service.js';

function callContract(oi: number): NormalizedOptionContract {
  return {
    venue: 'deribit',
    symbol: 'BTC-30JUN26-70000-C',
    exchangeSymbol: 'BTC-30JUN26-70000-C',
    base: 'BTC',
    settle: 'BTC',
    expiry: '2026-06-30',
    expiryTs: null,
    strike: 70000,
    right: 'call',
    inverse: true,
    contractSize: 1,
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
    greeks: { ...EMPTY_GREEKS, gamma: 0.0001 },
    quote: {
      bid: { raw: null, rawCurrency: 'BTC', usd: null },
      ask: { raw: null, rawCurrency: 'BTC', usd: null },
      mark: { raw: null, rawCurrency: 'BTC', usd: null },
      last: null,
      bidSize: null,
      askSize: null,
      underlyingPriceUsd: 70000,
      indexPriceUsd: 70000,
      volume24h: null,
      openInterest: oi,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: 1,
      source: 'ws',
    },
  };
}

function chainWith(oi: number): VenueOptionChain {
  const c = callContract(oi);
  return {
    venue: 'deribit',
    underlying: 'BTC',
    expiry: '2026-06-30',
    asOf: 1,
    contracts: { [c.symbol]: c },
  };
}

function makeService(opts: { oiByTick: number[]; netFlow: number }) {
  let tick = 0;
  return new DealerBookService({
    underlyings: ['BTC'],
    oiSnapshotStore: new NoopOiSnapshotStore(),
    dealerBookStore: new NoopDealerBookStore(),
    listExpiries: async () => ['2026-06-30'],
    listVenues: () => ['deribit'],
    fetchChain: async () => chainWith(opts.oiByTick[Math.min(tick, opts.oiByTick.length - 1)]!),
    fetchIntervalFlow: async () => ({ netFlow: opts.netFlow, hasFlow: opts.netFlow !== 0 }),
    now: () => {
      tick += 1;
      return tick * 900_000;
    },
    log: { info: () => {}, warn: () => {} },
  });
}

describe('DealerBookService', () => {
  it('bootstraps the naive prior on the first tick', async () => {
    const svc = makeService({ oiByTick: [100], netFlow: 0 });
    await svc.runTick();
    const pos = svc.lookup('deribit', 'BTC-30JUN26-70000-C');
    expect(pos?.dealerContracts).toBe(100);
    expect(pos?.lastOi).toBe(100);
  });

  it('refines the book by attributing ΔOI to aggressive buyers', async () => {
    const svc = makeService({ oiByTick: [100, 130], netFlow: 20 });
    await svc.runTick(); // bootstrap +100
    await svc.runTick(); // ΔOI +30, buyers → -30 → 70
    const pos = svc.lookup('deribit', 'BTC-30JUN26-70000-C');
    expect(pos?.dealerContracts).toBe(70);
  });

  it('lookup returns undefined for unknown contracts', async () => {
    const svc = makeService({ oiByTick: [100], netFlow: 0 });
    await svc.runTick();
    expect(svc.lookup('deribit', 'NOPE')).toBeUndefined();
  });
});
