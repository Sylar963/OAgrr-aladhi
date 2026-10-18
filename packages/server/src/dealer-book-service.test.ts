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

it('queries interval flow by venue-native exchangeSymbol, not the canonical symbol', async () => {
  const seen: string[] = [];
  let tick = 0;
  const chain = (oi: number): VenueOptionChain => {
    const c = { ...callContract(oi), symbol: 'BTC/USD:BTC-260630-70000-C' };
    return { venue: 'deribit', underlying: 'BTC', expiry: '2026-06-30', asOf: 1, contracts: { [c.symbol]: c } };
  };
  const svc = new DealerBookService({
    underlyings: ['BTC'],
    oiSnapshotStore: new NoopOiSnapshotStore(),
    dealerBookStore: new NoopDealerBookStore(),
    listExpiries: async () => ['2026-06-30'],
    listVenues: () => ['deribit'],
    fetchChain: async () => chain(tick === 0 ? 100 : 130),
    fetchIntervalFlow: async (_venue, exchangeSymbol) => {
      seen.push(exchangeSymbol);
      return { netFlow: 20, hasFlow: true };
    },
    now: () => ++tick * 900_000,
    log: { info: () => {}, warn: () => {} },
  });
  await svc.runTick();
  await svc.runTick();
  expect(seen).toEqual(['BTC-30JUN26-70000-C']);
  expect(svc.lookup('deribit', 'BTC/USD:BTC-260630-70000-C')?.flowContracts).toBe(30);
});

it('hands the oldest warmed snapshot ts to prepareFlow before the first tick', async () => {
  const calls: string[] = [];
  const store = new NoopDealerBookStore();
  store.loadAll = async () => [
    {
      venue: 'deribit',
      underlying: 'BTC',
      instrumentName: 'A',
      expiry: '2026-06-30',
      strike: 70000,
      optionType: 'call',
      dealerContracts: 1,
      flowContracts: 0,
      lastOi: 1,
      lastSnapshotTs: new Date(5_000),
    },
    {
      venue: 'deribit',
      underlying: 'BTC',
      instrumentName: 'B',
      expiry: '2026-06-30',
      strike: 70000,
      optionType: 'put',
      dealerContracts: -1,
      flowContracts: 0,
      lastOi: 1,
      lastSnapshotTs: new Date(3_000),
    },
  ];
  const svc = new DealerBookService({
    underlyings: ['BTC'],
    oiSnapshotStore: new NoopOiSnapshotStore(),
    dealerBookStore: store,
    listExpiries: async () => {
      calls.push('tick');
      return [];
    },
    listVenues: () => [],
    fetchChain: async () => null,
    fetchIntervalFlow: async () => ({ netFlow: 0, hasFlow: false }),
    prepareFlow: async (sinceTs) => {
      calls.push(`prepare:${sinceTs}`);
    },
    intervalMs: 1e9,
    log: { info: () => {}, warn: () => {} },
  });
  await svc.start();
  await svc.dispose();
  expect(calls).toEqual(['prepare:3000', 'tick']);
});
