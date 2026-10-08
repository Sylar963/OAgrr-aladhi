import { describe, expect, it } from 'vitest';

import type { EnrichedChainResponse, EnrichedSide, VenueQuote } from '@shared/enriched';

import {
  atmStraddleBreakevens,
  compositeMidUsd,
  otmStrangleBreakevens,
  pickNearestExpiry,
} from './breakeven-levels';

const NOW = Date.parse('2026-10-08T08:00:00Z');

function side(...mids: Array<number | null>): EnrichedSide {
  const venues: EnrichedSide['venues'] = {};
  const ids = ['deribit', 'okx', 'bybit', 'binance'] as const;
  mids.forEach((mid, i) => {
    venues[ids[i]!] = { mid } as VenueQuote;
  });
  return { venues, bestIv: null, bestVenue: null };
}

function chain(strikes: EnrichedChainResponse['strikes'], stats: Partial<EnrichedChainResponse['stats']> = {}): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry: '2026-10-23',
    expiryTs: null,
    dte: 15,
    stats: {
      forwardPriceUsd: null,
      indexPriceUsd: 100_000,
      basisPct: null,
      atmStrike: 100_000,
      atmIv: null,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
      ...stats,
    },
    strikes,
    gex: [],
  };
}

describe('pickNearestExpiry', () => {
  const candidates = [
    { expiry: '2026-10-09', expiryTs: null },
    { expiry: '2026-10-16', expiryTs: null },
    { expiry: '2026-10-23', expiryTs: null },
    { expiry: '2026-10-30', expiryTs: null },
    { expiry: '2026-11-06', expiryTs: null },
    { expiry: '2026-11-27', expiryTs: null },
  ];

  it('picks the listed expiry closest to the target tenor', () => {
    expect(pickNearestExpiry(candidates, 15, NOW)).toBe('2026-10-23');
    expect(pickNearestExpiry(candidates, 30, NOW)).toBe('2026-11-06');
  });

  it('skips expired listings and prefers expiryTs over the date string', () => {
    const list = [
      { expiry: '2026-10-08', expiryTs: NOW - 1 },
      { expiry: '2026-10-20', expiryTs: Date.parse('2026-10-23T08:00:00Z') },
    ];
    expect(pickNearestExpiry(list, 0, NOW)).toBe('2026-10-20');
  });

  it('returns null when nothing is listed', () => {
    expect(pickNearestExpiry([], 15, NOW)).toBeNull();
  });
});

describe('compositeMidUsd', () => {
  it('takes the median of usable venue mids', () => {
    expect(compositeMidUsd(side(100, 110, 500))).toBe(110);
    expect(compositeMidUsd(side(100, 120))).toBe(110);
  });

  it('ignores missing and non-positive mids', () => {
    expect(compositeMidUsd(side(null, 0, 90))).toBe(90);
    expect(compositeMidUsd(side(null))).toBeNull();
  });
});

describe('atmStraddleBreakevens', () => {
  it('puts break-evens at strike ± call + put premium', () => {
    const result = atmStraddleBreakevens(
      chain([
        { strike: 95_000, call: side(6_000), put: side(1_000) },
        { strike: 100_000, call: side(3_000), put: side(2_500) },
      ]),
    );
    expect(result).toMatchObject({ putStrike: 100_000, callStrike: 100_000, premiumUsd: 5_500, lowerUsd: 94_500, upperUsd: 105_500 });
  });

  it('falls back to the nearest strike priced on both sides', () => {
    const result = atmStraddleBreakevens(
      chain([
        { strike: 100_000, call: side(3_000), put: side(null) },
        { strike: 101_000, call: side(2_500), put: side(3_000) },
      ]),
    );
    expect(result?.putStrike).toBe(101_000);
  });

  it('returns null without a reference spot', () => {
    expect(atmStraddleBreakevens(chain([], { indexPriceUsd: null, forwardPriceUsd: null }))).toBeNull();
  });
});

describe('otmStrangleBreakevens', () => {
  it('uses strikes nearest 25% below and above spot', () => {
    const result = otmStrangleBreakevens(
      chain([
        { strike: 70_000, call: side(null), put: side(50) },
        { strike: 75_000, call: side(null), put: side(120) },
        { strike: 100_000, call: side(3_000), put: side(2_500) },
        { strike: 125_000, call: side(80), put: side(null) },
        { strike: 130_000, call: side(40), put: side(null) },
      ]),
    );
    expect(result).toMatchObject({ putStrike: 75_000, callStrike: 125_000, premiumUsd: 200, lowerUsd: 74_800, upperUsd: 125_200 });
  });

  it('returns null when one wing has no priced strike', () => {
    expect(otmStrangleBreakevens(chain([{ strike: 75_000, call: side(null), put: side(120) }]))).toBeNull();
  });
});
