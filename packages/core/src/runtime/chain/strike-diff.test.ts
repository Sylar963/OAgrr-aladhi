import { describe, expect, it } from 'vitest';
import type { EnrichedChainResponse } from '../../core/enrichment.js';
import { diffEnrichedStrike, diffEnrichedStrikes } from './strike-diff.js';

type EnrichedStrike = EnrichedChainResponse['strikes'][number];
type VenueQuote = EnrichedStrike['call']['venues']['deribit'];

function quote(overrides: Partial<NonNullable<VenueQuote>> = {}): NonNullable<VenueQuote> {
  return {
    bid: 100,
    ask: 110,
    mid: 105,
    midRaw: 0.0015,
    bidSize: 1,
    askSize: 2,
    markIv: 0.5,
    bidIv: 0.49,
    askIv: 0.51,
    delta: 0.5,
    gamma: 0.01,
    theta: -5,
    vega: 10,
    spreadPct: 0.1,
    totalCost: 111,
    estimatedFees: { maker: 0.1, taker: 0.2 },
    openInterest: 10,
    volume24h: 5,
    openInterestUsd: 700_000,
    volume24hUsd: 350_000,
    asOfMs: 1_000,
    ...overrides,
  } as NonNullable<VenueQuote>;
}

function strike(call: Record<string, VenueQuote>, bestIv = 0.5): EnrichedStrike {
  return {
    strike: 70_000,
    call: { venues: call, bestIv, bestVenue: 'deribit' },
    put: { venues: {}, bestIv: null, bestVenue: null },
  } as EnrichedStrike;
}

describe('diffEnrichedStrike', () => {
  it('returns null when nothing changed', () => {
    const prev = strike({ deribit: quote() });
    const next = strike({ deribit: quote() });
    expect(diffEnrichedStrike(prev, next)).toBeNull();
  });

  it('sends only the changed fields of the changed venue and side', () => {
    const prev = strike({ deribit: quote(), okx: quote() });
    const next = strike({ deribit: quote({ bid: 101, asOfMs: 2_000 }), okx: quote() });

    expect(diffEnrichedStrike(prev, next)).toEqual({
      strike: 70_000,
      call: { venues: { deribit: { bid: 101, asOfMs: 2_000 } } },
    });
  });

  it('diffs one level into nested records', () => {
    const prev = strike({ deribit: quote() });
    const next = strike({ deribit: quote({ estimatedFees: { maker: 0.1, taker: 0.3 } }) });

    expect(diffEnrichedStrike(prev, next)?.call?.venues?.['deribit']).toEqual({
      estimatedFees: { taker: 0.3 },
    });
  });

  it('sends a whole nested record when it was previously null, and null when it is cleared', () => {
    const fees = { maker: 0.1, taker: 0.2 };
    expect(
      diffEnrichedStrike(
        strike({ deribit: quote({ estimatedFees: null }) }),
        strike({ deribit: quote({ estimatedFees: fees }) }),
      )?.call?.venues?.['deribit'],
    ).toEqual({ estimatedFees: fees });
    expect(
      diffEnrichedStrike(
        strike({ deribit: quote({ estimatedFees: fees }) }),
        strike({ deribit: quote({ estimatedFees: null }) }),
      )?.call?.venues?.['deribit'],
    ).toEqual({ estimatedFees: null });
  });

  it('replaces a new venue or a quote that lost a key, and removes a dropped venue', () => {
    const withAsOf = quote();
    const { asOfMs: _dropped, ...withoutAsOf } = withAsOf;
    const prev = strike({ deribit: withAsOf, okx: quote() });
    const next = strike({ deribit: withoutAsOf as NonNullable<VenueQuote>, bybit: quote() });

    expect(diffEnrichedStrike(prev, next)?.call?.venues).toEqual({
      deribit: { ...withoutAsOf, replace: true },
      bybit: { ...quote(), replace: true },
      okx: null,
    });
  });

  it('carries best IV and best venue changes', () => {
    const diff = diffEnrichedStrike(strike({}, 0.5), strike({}, 0.55));
    expect(diff?.call).toEqual({ bestIv: 0.55 });
  });

  it('sends every side in full for a strike with no previous state', () => {
    const next = strike({ deribit: quote() });
    expect(diffEnrichedStrike(undefined, next)).toEqual({
      strike: 70_000,
      call: { bestIv: 0.5, bestVenue: 'deribit', venues: { deribit: { ...quote(), replace: true } } },
      put: { bestIv: null, bestVenue: null },
    });
  });
});

describe('diffEnrichedStrikes', () => {
  it('drops strikes whose content did not change', () => {
    const prev = [strike({ deribit: quote() })];
    expect(diffEnrichedStrikes(prev, [strike({ deribit: quote() })])).toEqual([]);
  });
});
