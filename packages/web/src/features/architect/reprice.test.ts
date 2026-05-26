import { describe, expect, it } from 'vitest';

import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';

import { repriceLeg } from './reprice';

function makeQuote(overrides: Partial<VenueQuote>): VenueQuote {
  return {
    bid: null,
    ask: null,
    mid: null,
    midRaw: null,
    bidSize: null,
    askSize: null,
    markIv: 0.5,
    bidIv: null,
    askIv: null,
    delta: 0.5,
    gamma: 0.1,
    theta: -0.1,
    vega: 0.2,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    ...overrides,
  };
}

function makeChain(callQuote: VenueQuote): EnrichedChainResponse {
  return {
    underlying: 'AVAX_USDC',
    expiry: '2026-06-26',
    expiryTs: 1,
    dte: 31,
    stats: {
      forwardPriceUsd: 9.123,
      indexPriceUsd: 9.123,
      basisPct: 0,
      atmStrike: 8.5,
      atmIv: 0.5,
      putCallOiRatio: 1,
      totalOiUsd: 1,
      skew25d: 0,
      bfly25d: 0,
    },
    strikes: [
      {
        strike: 8.5,
        call: { venues: { deribit: callQuote }, bestIv: 0.5, bestVenue: 'deribit' },
        put: { venues: {}, bestIv: null, bestVenue: null },
      },
    ],
    gex: [],
  };
}

describe('repriceLeg', () => {
  it('falls back to mid when top-of-book is missing', () => {
    const leg = repriceLeg(
      makeChain(makeQuote({ bid: 0, ask: 0, mid: 94 })),
      ['deribit'],
      { type: 'call', direction: 'buy', strike: 8.5, expiry: '2026-06-26', quantity: 1 },
      { exactStrike: true },
    );

    expect(leg?.entryPrice).toBe(94);
    expect(leg?.venue).toBe('deribit');
  });

  it('prefers a live ask over mid fallback', () => {
    const leg = repriceLeg(
      makeChain(makeQuote({ bid: 93.4, ask: 94.6, mid: 94 })),
      ['deribit'],
      { type: 'call', direction: 'buy', strike: 8.5, expiry: '2026-06-26', quantity: 1 },
      { exactStrike: true },
    );

    expect(leg?.entryPrice).toBe(94.6);
  });
});
