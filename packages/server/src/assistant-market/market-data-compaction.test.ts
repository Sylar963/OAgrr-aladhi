import { describe, expect, it } from 'vitest';

import {
  type ChainResponse,
  compactChain,
  compactIvHistory,
  compactSurface,
} from './market-data-compaction.js';

const NOW = Date.UTC(2026, 8, 23, 12);

function quote(overrides: Record<string, number | null>) {
  return {
    bid: null,
    ask: null,
    mid: null,
    markIv: null,
    delta: null,
    theta: null,
    openInterest: null,
    asOfMs: NOW,
    ...overrides,
  };
}

const chain: ChainResponse = {
  underlying: 'BTC',
  expiry: '2026-10-02',
  expiryTs: Date.UTC(2026, 9, 2, 8),
  dte: 8.8,
  stats: { forwardPriceUsd: 84_500, atmStrike: 85_000, atmIv: 0.3377 },
  strikes: [
    {
      strike: 80_000,
      call: { venues: {} },
      put: { venues: { deribit: quote({ bid: 400, ask: 420, mid: 410, markIv: 0.36 }) } },
    },
    {
      strike: 85_000,
      call: {
        venues: {
          deribit: quote({ bid: 1_520, ask: 1_610, mid: 1_565, markIv: 0.34, delta: 0.48, openInterest: 10 }),
          okx: quote({ bid: 1_540, ask: 1_600, mid: 1_570, markIv: 0.33, delta: 0.47, openInterest: 5 }),
          stale: quote({ bid: 1_900, ask: 1_000, asOfMs: NOW - 60 * 60_000 }),
        },
      },
      put: { venues: {} },
    },
    {
      strike: 100_000,
      call: { venues: { deribit: quote({ bid: 5, ask: 10, mid: 7.5 }) } },
      put: { venues: {} },
    },
  ],
};

describe('compactChain', () => {
  it('picks the best bid and ask across fresh venues and medians the rest', () => {
    const result = compactChain(chain, { nowMs: NOW });
    const call = result.rows.find((row) => row.strike === 85_000 && row.side === 'call');
    expect(call).toMatchObject({
      bestBidUsd: 1_540,
      bestBidVenue: 'okx',
      bestAskUsd: 1_600,
      bestAskVenue: 'okx',
      medianMidUsd: 1_567.5,
      medianMarkIv: 0.335,
      openInterestContracts: 15,
      quotingVenues: 2,
    });
  });

  it('filters by strike band while keeping explicitly included strikes', () => {
    const result = compactChain(chain, {
      nowMs: NOW,
      minStrike: 82_000,
      maxStrike: 90_000,
      includeStrikes: [100_000],
    });
    expect(result.rows.map((row) => `${row.strike}-${row.side}`)).toEqual([
      '85000-call',
      '100000-call',
    ]);
    expect(result.strikesAvailable).toBe(3);
    expect(result.strikesReturned).toBe(2);
  });

  it('returns puts only when requested', () => {
    const result = compactChain(chain, { nowMs: NOW, side: 'put' });
    expect(result.rows).toEqual([expect.objectContaining({ strike: 80_000, side: 'put' })]);
  });
});

describe('compactSurface', () => {
  it('derives 25-delta risk reversal and butterfly', () => {
    const result = compactSurface(
      {
        underlying: 'BTC',
        termStructure: 'contango',
        surface: [
          { expiry: '2026-10-02', dte: 9, delta25p: 0.36, atm: 0.34, delta25c: 0.35 },
        ],
      },
      { includeVenueAtm: false },
    );
    expect(result.rows[0]).toMatchObject({ riskReversal25d: -0.01, butterfly25d: 0.015 });
  });
});

describe('compactIvHistory', () => {
  it('downsamples the series to one close per UTC day', () => {
    const point = (ts: number, atmIv: number) => ({ ts, atmIv, rr25d: 0, bfly25d: 0 });
    const result = compactIvHistory({
      underlying: 'BTC',
      windowDays: 30,
      tenors: {
        '30d': {
          current: point(NOW, 0.36),
          atmRank: 25,
          atmPercentile: 14,
          min: { atmIv: 0.33 },
          max: { atmIv: 0.46 },
          series: [
            point(Date.UTC(2026, 8, 21, 1), 0.4),
            point(Date.UTC(2026, 8, 21, 23), 0.41),
            point(Date.UTC(2026, 8, 22, 5), 0.38),
          ],
        },
      },
    });
    expect(result.tenors['30d']?.dailyCloses).toEqual([
      { date: '2026-09-21', atmIv: 0.41, riskReversal25d: 0, butterfly25d: 0 },
      { date: '2026-09-22', atmIv: 0.38, riskReversal25d: 0, butterfly25d: 0 },
    ]);
  });
});
