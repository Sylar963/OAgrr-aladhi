import { describe, expect, it } from 'vitest';

import type { EnrichedStrike, VenueQuote } from '@shared/enriched';

import { applyStrikeDiffs } from './chain-diff';

function quote(overrides: Partial<VenueQuote> = {}): VenueQuote {
  return {
    bid: 100,
    ask: 110,
    mid: 105,
    midRaw: null,
    bidSize: 1,
    askSize: 2,
    markIv: 0.5,
    bidIv: null,
    askIv: null,
    delta: 0.5,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: { maker: 0.1, taker: 0.2 },
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    asOfMs: 1_000,
    ...overrides,
  } as VenueQuote;
}

function strike(value: number, venues: Record<string, VenueQuote>): EnrichedStrike {
  return {
    strike: value,
    call: { venues, bestIv: 0.5, bestVenue: 'deribit' },
    put: { venues: {}, bestIv: null, bestVenue: null },
  } as EnrichedStrike;
}

describe('applyStrikeDiffs', () => {
  it('merges changed fields and keeps untouched strikes and sides by reference', () => {
    const untouched = strike(60_000, { deribit: quote() });
    const changed = strike(70_000, { deribit: quote(), okx: quote() });
    const result = applyStrikeDiffs(
      [untouched, changed],
      [{ strike: 70_000, call: { venues: { deribit: { bid: 101, estimatedFees: { taker: 0.3 } } } } }],
    );

    expect(result[0]).toBe(untouched);
    expect(result[1]!.put).toBe(changed.put);
    expect(result[1]!.call.venues['okx']).toBe(changed.call.venues['okx']);
    expect(result[1]!.call.venues['deribit']).toEqual(
      quote({ bid: 101, estimatedFees: { maker: 0.1, taker: 0.3 } }),
    );
  });

  it('replaces a quote marked replace, removes null venues and updates best IV', () => {
    const existing = strike(70_000, { deribit: quote({ asOfMs: 5 }), okx: quote() });
    const replacement = quote({ bid: 90 });
    delete (replacement as Partial<VenueQuote>).asOfMs;

    const [result] = applyStrikeDiffs(
      [existing],
      [
        {
          strike: 70_000,
          call: { bestIv: 0.6, venues: { deribit: { ...replacement, replace: true }, okx: null } },
        },
      ],
    );

    expect(result!.call.venues).toEqual({ deribit: replacement });
    expect(result!.call.bestIv).toBe(0.6);
    expect(result!.call.bestVenue).toBe('deribit');
  });

  it('inserts unseen strikes in order', () => {
    const result = applyStrikeDiffs(
      [strike(60_000, {}), strike(80_000, {})],
      [{ strike: 70_000, call: { venues: { deribit: { ...quote(), replace: true } } } }],
    );
    expect(result.map((s) => s.strike)).toEqual([60_000, 70_000, 80_000]);
  });
});
