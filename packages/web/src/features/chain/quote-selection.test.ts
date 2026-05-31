import { describe, expect, it } from 'vitest';

import type { EnrichedSide, VenueQuote } from '@shared/enriched';

import { bestBidAsk, crossVenueSpreadPct, isActionableQuote } from './quote-selection';

function quote(overrides: Partial<VenueQuote>): VenueQuote {
  return {
    bid: null,
    ask: null,
    mid: null,
    midRaw: null,
    bidSize: null,
    askSize: null,
    markIv: null,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
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

describe('quote selection', () => {
  it('excludes stale quotes from best bid and ask selection', () => {
    const now = 1_000_000;
    const side: EnrichedSide = {
      bestIv: null,
      bestVenue: null,
      venues: {
        bybit: quote({ bid: 110, ask: 90, asOfMs: now - 120_000 }),
        deribit: quote({ bid: 100, ask: 105, asOfMs: now - 500 }),
      },
    };

    expect(bestBidAsk(side, new Set(['bybit', 'deribit']), now)).toEqual({
      bid: 100,
      ask: 105,
      bidVenue: 'deribit',
      askVenue: 'deribit',
    });
  });

  it('treats missing timestamps as actionable for backward-compatible payloads', () => {
    expect(isActionableQuote(quote({ ask: 10 }), 1_000_000)).toBe(true);
  });

  it('computes spread from cross-venue best bid and ask', () => {
    expect(
      crossVenueSpreadPct({ bid: 100, ask: 110, bidVenue: 'deribit', askVenue: 'bybit' }),
    ).toBeCloseTo(9.5238, 4);
  });

  it('computes negative spreads for crossed cross-venue markets', () => {
    expect(
      crossVenueSpreadPct({ bid: 100, ask: 90, bidVenue: 'deribit', askVenue: 'bybit' }),
    ).toBeCloseTo(-10.5263, 4);
  });

  it('returns null for missing cross-venue spread prices', () => {
    expect(crossVenueSpreadPct({ bid: null, ask: 110, bidVenue: null, askVenue: 'bybit' })).toBeNull();
  });
});
