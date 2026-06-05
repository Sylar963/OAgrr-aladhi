import { describe, expect, it } from 'vitest';
import { ChainProjection } from './projection.js';
import type { BookLookup } from '../../core/dealer-book.js';
import type { NormalizedOptionContract, VenueOptionChain } from '../../core/types.js';
import { EMPTY_GREEKS } from '../../core/types.js';

function callContract(): NormalizedOptionContract {
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
      openInterest: 100,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: 1,
      source: 'ws',
    },
  };
}

function callOnlyChain(): VenueOptionChain {
  const c = callContract();
  return {
    venue: 'deribit',
    underlying: 'BTC',
    expiry: '2026-06-30',
    asOf: 1,
    contracts: { [c.symbol]: c },
  };
}

describe('ChainProjection bookLookup', () => {
  it('applies an injected bookLookup to the snapshot GEX', () => {
    const chains = [callOnlyChain()];

    const naive = new ChainProjection('BTC', '2026-06-30').loadSnapshot(chains).gex;
    // single long call with OI 100 → naive GEX is positive (non-zero)
    expect(naive[0]?.gexUsdMillions).not.toBe(0);

    const lookup: BookLookup = () => ({
      venue: 'deribit',
      symbol: 'BTC-30JUN26-70000-C',
      underlying: 'BTC',
      expiry: '2026-06-30',
      strike: 70000,
      optionType: 'call',
      dealerContracts: 0,
      lastOi: 100,
      lastSnapshotTs: 1,
    });
    const real = new ChainProjection('BTC', '2026-06-30', lookup).loadSnapshot(chains).gex;
    // dealerContracts 0 → flat GEX, proving the lookup was applied
    expect(real[0]?.gexUsdMillions).toBe(0);
  });
});
