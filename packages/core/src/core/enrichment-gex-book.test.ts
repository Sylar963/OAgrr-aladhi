import { describe, expect, it } from 'vitest';
import { buildComparisonChain } from './aggregator.js';
import type { BookLookup, DealerPosition } from './dealer-book.js';
import { buildEnrichedChain, computeGex, enrichComparisonRow } from './enrichment.js';
import type { NormalizedOptionContract, VenueOptionChain } from './types.js';
import { EMPTY_GREEKS } from './types.js';

function contract(over: Partial<NormalizedOptionContract>): NormalizedOptionContract {
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
    ...over,
  };
}

function chain(): VenueOptionChain {
  const call = contract({ symbol: 'BTC-30JUN26-70000-C', right: 'call' });
  const put = contract({ symbol: 'BTC-30JUN26-70000-P', right: 'put' });
  return {
    venue: 'deribit',
    underlying: 'BTC',
    expiry: '2026-06-30',
    asOf: 1,
    contracts: { [call.symbol]: call, [put.symbol]: put },
  };
}

const rows = () => buildComparisonChain('BTC', '2026-06-30', [chain()]).rows;
const strikes = () => rows().map(enrichComparisonRow);

describe('computeGex book awareness', () => {
  it('without bookLookup is identical to the naive call−put result', () => {
    const naive = computeGex(rows(), strikes(), 70000);
    // call OI 100 +, put OI 100 − → net 0 at this strike
    expect(naive[0]?.gexUsdMillions).toBeCloseTo(0, 12);
  });

  it('book sign overrides the call/put assumption', () => {
    // Dealers SHORT the call (negative) and SHORT the put (negative).
    const book: Record<string, DealerPosition> = {
      'BTC-30JUN26-70000-C': {
        venue: 'deribit',
        symbol: 'BTC-30JUN26-70000-C',
        underlying: 'BTC',
        expiry: '2026-06-30',
        strike: 70000,
        optionType: 'call',
        dealerContracts: -100,
        lastOi: 100,
        lastSnapshotTs: 1,
      },
      'BTC-30JUN26-70000-P': {
        venue: 'deribit',
        symbol: 'BTC-30JUN26-70000-P',
        underlying: 'BTC',
        expiry: '2026-06-30',
        strike: 70000,
        optionType: 'put',
        dealerContracts: -100,
        lastOi: 100,
        lastSnapshotTs: 1,
      },
    };
    const lookup: BookLookup = (_v, symbol) => book[symbol];
    const real = computeGex(rows(), strikes(), 70000, lookup);
    // call: qty -100 → callGex -100*g; put: qty -(-100)=+100 → putGex +100*g
    // strikeGex = callGex - putGex = (-100 - 100) * 0.0001 * 70000^2 / 1e6
    const term = (0.0001 * 70000 * 70000) / 1_000_000;
    expect(real[0]?.gexUsdMillions).toBeCloseTo(-200 * term, 9);
  });

  it('buildEnrichedChain forwards bookLookup', () => {
    const lookup: BookLookup = () => ({
      venue: 'deribit',
      symbol: 'x',
      underlying: 'BTC',
      expiry: '2026-06-30',
      strike: 70000,
      optionType: 'call',
      dealerContracts: 0,
      lastOi: 0,
      lastSnapshotTs: 1,
    });
    const enriched = buildEnrichedChain('BTC', '2026-06-30', rows(), [chain()], lookup);
    // both legs map to dealerContracts 0 → flat GEX
    expect(enriched.gex[0]?.gexUsdMillions).toBe(0);
  });
});
