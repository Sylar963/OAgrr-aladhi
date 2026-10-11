import { describe, it, expect } from 'vitest';
import type { EnrichedChainResponse } from '@shared/enriched';

import {
  computeExpiryRows,
  computeMaxPainUsd,
  computeSummary,
  computeTopPositions,
  computeVenueRows,
} from './positioning-utils';

interface Leg {
  venue: string;
  oi?: number;
  oiUsd?: number;
  volUsd?: number;
  iv?: number;
}

function quote(leg: Leg) {
  return {
    openInterest: leg.oi ?? null,
    openInterestUsd: leg.oiUsd ?? null,
    volume24h: null,
    volume24hUsd: leg.volUsd ?? null,
    markIv: leg.iv ?? null,
  };
}

function venues(legs: Leg[] = []) {
  return Object.fromEntries(legs.map((l) => [l.venue, quote(l)]));
}

function chain(
  expiry: string,
  dte: number,
  strikes: Array<{ strike: number; call?: Leg[]; put?: Leg[] }>,
  stats: { forwardPriceUsd?: number; atmStrike?: number } = {},
): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry,
    dte,
    strikes: strikes.map((s) => ({
      strike: s.strike,
      call: { venues: venues(s.call), bestIv: null, bestVenue: null },
      put: { venues: venues(s.put), bestIv: null, bestVenue: null },
    })),
    stats: {
      forwardPriceUsd: stats.forwardPriceUsd ?? null,
      atmStrike: stats.atmStrike ?? null,
      atmIv: null,
    },
    gex: [],
  } as unknown as EnrichedChainResponse;
}

describe('computeSummary', () => {
  it('derives P/C from USD notional, ignoring native contract counts', () => {
    // OKX reports 100 contracts of 0.01 BTC; Deribit 1 contract of 1 BTC. Same notional.
    const c = chain('2026-10-30', 19, [
      {
        strike: 100_000,
        call: [{ venue: 'okx', oi: 100, oiUsd: 100_000 }],
        put: [{ venue: 'deribit', oi: 1, oiUsd: 100_000 }],
      },
    ]);
    const s = computeSummary([c]);
    expect(s.oiUsd).toBe(200_000);
    expect(s.pcOi).toBe(1);
  });

  it('computes turnover and near-expiry share', () => {
    const near = chain('2026-10-13', 2, [
      { strike: 1, call: [{ venue: 'deribit', oiUsd: 25, volUsd: 10 }] },
    ]);
    const far = chain('2026-12-25', 75, [
      { strike: 1, put: [{ venue: 'deribit', oiUsd: 75, volUsd: 10 }] },
    ]);
    const s = computeSummary([near, far]);
    expect(s.turnover).toBeCloseTo(0.2);
    expect(s.nearOiUsd).toBe(25);
    expect(s.nearOiShare).toBeCloseTo(0.25);
  });

  it('returns null ratios when the denominator is empty', () => {
    const s = computeSummary([]);
    expect(s.pcOi).toBeNull();
    expect(s.turnover).toBeNull();
    expect(s.nearOiShare).toBeNull();
  });
});

describe('computeMaxPainUsd', () => {
  it('picks the settlement strike minimising option-holder payout', () => {
    const c = chain('2026-10-30', 19, [
      { strike: 90, put: [{ venue: 'deribit', oiUsd: 1_000 }] },
      { strike: 100, call: [{ venue: 'deribit', oiUsd: 10 }], put: [{ venue: 'deribit', oiUsd: 10 }] },
      { strike: 110, call: [{ venue: 'deribit', oiUsd: 1_000 }] },
    ]);
    expect(computeMaxPainUsd(c)).toBe(100);
  });

  it('returns null when there is no open interest', () => {
    expect(computeMaxPainUsd(chain('2026-10-30', 19, [{ strike: 100 }]))).toBeNull();
  });
});

describe('computeExpiryRows', () => {
  it('sorts by DTE and computes shares and max-pain distance', () => {
    const far = chain(
      '2026-12-25',
      75,
      [{ strike: 110, call: [{ venue: 'deribit', oiUsd: 300 }] }],
      { forwardPriceUsd: 100 },
    );
    const near = chain(
      '2026-10-16',
      5,
      [{ strike: 100, put: [{ venue: 'deribit', oiUsd: 100, volUsd: 50 }] }],
      { forwardPriceUsd: 100 },
    );
    const rows = computeExpiryRows([far, near], null);
    expect(rows.map((r) => r.expiry)).toEqual(['2026-10-16', '2026-12-25']);
    expect(rows[0]!.oiShare).toBeCloseTo(0.25);
    expect(rows[0]!.turnover).toBeCloseTo(0.5);
    expect(rows[0]!.pcOi).toBeNull();
    expect(rows[1]!.maxPainDistPct).toBeCloseTo(10);
  });

  it('drops expiries with no OI and no volume', () => {
    expect(computeExpiryRows([chain('2026-10-30', 19, [{ strike: 100 }])], 100)).toEqual([]);
  });
});

describe('computeTopPositions', () => {
  it('ranks contracts by aggregated USD OI and reports the dominant venue', () => {
    const c = chain('2026-10-30', 19, [
      {
        strike: 120,
        call: [
          { venue: 'deribit', oiUsd: 600 },
          { venue: 'okx', oiUsd: 200 },
        ],
      },
      { strike: 80, put: [{ venue: 'bybit', oiUsd: 200 }] },
    ]);
    const top = computeTopPositions([c], 100, 1);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({
      strike: 120,
      right: 'call',
      oiUsd: 800,
      topVenue: 'deribit',
      topVenueShare: 0.75,
      moneynessPct: 20,
    });
    expect(top[0]!.oiShare).toBeCloseTo(0.8);
  });
});

describe('computeVenueRows', () => {
  it('computes shares, turnover and ATM IV gap to the cross-venue median', () => {
    const c = chain(
      '2026-10-30',
      19,
      [
        {
          strike: 100,
          call: [
            { venue: 'deribit', oiUsd: 300, volUsd: 30, iv: 0.5 },
            { venue: 'okx', oiUsd: 100, volUsd: 10, iv: 0.52 },
            { venue: 'bybit', iv: 0.48 },
          ],
        },
      ],
      { atmStrike: 100 },
    );
    const rows = computeVenueRows([c]);
    const byVenue = Object.fromEntries(rows.map((r) => [r.venue, r]));

    expect(rows[0]!.venue).toBe('deribit');
    expect(byVenue.deribit!.oiShare).toBeCloseTo(0.75);
    expect(byVenue.deribit!.turnover).toBeCloseTo(0.1);
    expect(byVenue.deribit!.ivGapVp).toBeCloseTo(0);
    expect(byVenue.okx!.ivGapVp).toBeCloseTo(2);
    expect(byVenue.bybit).toBeUndefined();
  });

  it('skips IV gaps for near-dated expiries', () => {
    const c = chain(
      '2026-10-12',
      1,
      [
        {
          strike: 100,
          call: [
            { venue: 'deribit', oiUsd: 1, iv: 0.5 },
            { venue: 'okx', oiUsd: 1, iv: 0.9 },
          ],
        },
      ],
      { atmStrike: 100 },
    );
    expect(computeVenueRows([c]).every((r) => r.ivGapVp === null)).toBe(true);
  });
});
