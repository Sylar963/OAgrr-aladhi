import { describe, expect, it } from 'vitest';

import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';

import type { Leg } from './payoff';
import { openingCost, repriceLeg } from './reprice';

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

function makeChain(
  callQuote: VenueQuote,
  callVenues: Record<string, VenueQuote> = { deribit: callQuote },
  putVenues: Record<string, VenueQuote> = {},
): EnrichedChainResponse {
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
        call: { venues: callVenues, bestIv: 0.5, bestVenue: 'deribit' },
        put: { venues: putVenues, bestIv: null, bestVenue: null },
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

function makeLeg(overrides: Partial<Leg>): Leg {
  return {
    id: 'leg',
    type: 'call',
    direction: 'buy',
    strike: 8.5,
    expiry: '2026-06-26',
    quantity: 1,
    entryPrice: 0,
    venue: '',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
    ...overrides,
  };
}

describe('openingCost', () => {
  const deribit = makeQuote({ bid: 90, ask: 100, mid: 95 });
  const thalex = makeQuote({ bid: 92, ask: 98, mid: 95 });
  const putQuote = makeQuote({ bid: 40, ask: 50, mid: 45 });
  const chain = makeChain(deribit, { deribit, thalex }, { deribit: putQuote });

  it('crosses the spread on the routed venue and reports the cost versus mid', () => {
    const legs = [
      makeLeg({ direction: 'buy', quantity: 2 }),
      makeLeg({ type: 'put', direction: 'sell', quantity: 1 }),
    ];

    const cost = openingCost(legs, () => chain, ['deribit']);

    expect(cost.netPremiumAtMarket).toBe(-2 * 100 + 40);
    expect(cost.netPremiumAtMid).toBe(-2 * 95 + 45);
    expect(cost.spreadCost).toBe(15);
    expect(cost.unquotedLegs).toBe(0);
  });

  it('takes each leg from the best venue on best route', () => {
    const cost = openingCost([makeLeg({ direction: 'buy' })], () => chain, ['deribit', 'thalex']);

    expect(cost.netPremiumAtMarket).toBe(-98);
    expect(cost.spreadCost).toBe(3);
  });

  it('ignores the stored entry price so held positions show the cost of opening now', () => {
    const cost = openingCost(
      [makeLeg({ direction: 'sell', entryPrice: 500 })],
      () => chain,
      ['thalex'],
    );

    expect(cost.netPremiumAtMarket).toBe(92);
  });

  it('applies the contract multiplier', () => {
    const cost = openingCost(
      [makeLeg({ direction: 'buy', contractMultiplier: 100 })],
      () => chain,
      ['deribit'],
    );

    expect(cost.netPremiumAtMarket).toBe(-10_000);
  });

  it('counts mid fallbacks and leaves unquoted legs out of the totals', () => {
    const oneSided = makeChain(makeQuote({ bid: 0, ask: 0, mid: 94 }));
    const cost = openingCost(
      [makeLeg({ direction: 'buy' }), makeLeg({ type: 'put', direction: 'buy' })],
      () => oneSided,
      ['deribit'],
    );

    expect(cost.netPremiumAtMarket).toBe(-94);
    expect(cost.midFallbackLegs).toBe(1);
    expect(cost.unquotedLegs).toBe(1);
  });

  it('treats a missing chain as unquoted', () => {
    const cost = openingCost([makeLeg({})], () => null, ['deribit']);

    expect(cost.unquotedLegs).toBe(1);
    expect(cost.netPremiumAtMarket).toBe(0);
  });
});
