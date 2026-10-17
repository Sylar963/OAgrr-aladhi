import type { ExpiryRiskWindow } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import {
  atmIvForHorizon,
  buildBookVsMarketFacts,
  buildExpiryOutlook,
  compactLevelInputs,
  openInterestClusters,
  profitZonesOf,
  supportAndResistance,
} from './portfolio-assistant-levels.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 84_000;

function window(overrides: Partial<ExpiryRiskWindow>): ExpiryRiskWindow {
  return {
    from: '2026-10-07T12:00:00.000Z',
    until: '2026-10-30',
    liveLegIds: ['a'],
    netCallSize: 0,
    upsideUnbounded: false,
    lossAtZeroSpotUsd: -1_000,
    worstLossUsd: -1_000,
    worstLossSpotUsd: 0,
    bestProfitUsd: null,
    bestProfitSpotUsd: null,
    breakevenSpotsUsd: [86_000],
    ...overrides,
  };
}

const TERM = [
  { expiry: '2026-10-16', daysToExpiry: 8.83, ivAtm: 0.44 },
  { expiry: '2026-10-30', daysToExpiry: 22.83, ivAtm: 0.4 },
  { expiry: '2026-11-27', daysToExpiry: 50.83, ivAtm: 0.42 },
];

describe('atmIvForHorizon', () => {
  it('uses the matching expiry, interpolates total variance between neighbours, and holds the ends', () => {
    expect(atmIvForHorizon(TERM, '2026-10-30', 22.83)).toEqual({ iv: 0.4, source: 'expiry' });
    const between = atmIvForHorizon(TERM, '2026-10-23', 15.83);
    expect(between?.source).toBe('interpolated');
    const variance = 0.44 ** 2 * 8.83 + 0.5 * (0.4 ** 2 * 22.83 - 0.44 ** 2 * 8.83);
    expect(between?.iv).toBeCloseTo(Math.sqrt(variance / 15.83), 10);
    expect(atmIvForHorizon(TERM, '2026-10-09', 1.83)).toEqual({ iv: 0.44, source: 'nearest' });
    expect(atmIvForHorizon(TERM, '2027-03-26', 170)).toEqual({ iv: 0.42, source: 'nearest' });
    expect(atmIvForHorizon([], '2026-10-30', 22.83)).toBeNull();
  });
});

describe('profitZonesOf', () => {
  it('alternates profit and loss across breakevens from the sign at zero spot', () => {
    expect(profitZonesOf(window({ lossAtZeroSpotUsd: -1_000, breakevenSpotsUsd: [86_000] }))).toEqual([
      { fromSpotUsd: 86_000, toSpotUsd: null },
    ]);
    expect(profitZonesOf(window({ lossAtZeroSpotUsd: 2_000, breakevenSpotsUsd: [80_000, 88_000] }))).toEqual([
      { fromSpotUsd: null, toSpotUsd: 80_000 },
      { fromSpotUsd: 88_000, toSpotUsd: null },
    ]);
    expect(
      profitZonesOf(window({ lossAtZeroSpotUsd: -500, breakevenSpotsUsd: [80_000, 88_000], bestProfitSpotUsd: 84_000 })),
    ).toEqual([{ fromSpotUsd: 80_000, toSpotUsd: 88_000 }]);
  });

  it('returns null when the sign is unknown or contradicts the best-profit spot', () => {
    expect(profitZonesOf(window({ lossAtZeroSpotUsd: 0, bestProfitSpotUsd: null }))).toBeNull();
    expect(
      profitZonesOf(window({ lossAtZeroSpotUsd: -500, breakevenSpotsUsd: [80_000, 88_000], bestProfitSpotUsd: 95_000 })),
    ).toBeNull();
  });
});

describe('buildExpiryOutlook', () => {
  it('gives the 1σ range, breakeven odds and a profit probability that sums the profitable zones', () => {
    const [long] = buildExpiryOutlook([window({ breakevenSpotsUsd: [86_000] })], TERM, SPOT, NOW);
    const days = (Date.parse('2026-10-30T08:00:00.000Z') - NOW) / 86_400_000;
    const move = 0.4 * Math.sqrt(days / 365);
    expect(long?.expectedMovePct).toBeCloseTo(move * 100, 1);
    expect(long?.expectedRangeUsd).toEqual({ low: Math.round(SPOT * (1 - move)), high: Math.round(SPOT * (1 + move)) });
    expect(long?.breakevens[0]).toMatchObject({ spotUsd: 86_000, insideExpectedRange: true });
    expect(long?.profitProbability).toBe(long?.breakevens[0]?.probabilityAbove);

    const [straddle] = buildExpiryOutlook(
      [window({ lossAtZeroSpotUsd: 5_000, breakevenSpotsUsd: [78_000, 90_000] })],
      TERM,
      SPOT,
      NOW,
    );
    const [low, high] = straddle?.breakevens ?? [];
    expect(straddle?.profitProbability).toBeCloseTo(1 - (low?.probabilityAbove ?? 0) + (high?.probabilityAbove ?? 0), 2);
  });

  it('skips windows that already ended', () => {
    expect(buildExpiryOutlook([window({ until: '2026-10-07' })], TERM, SPOT, NOW)).toEqual([]);
  });
});

describe('supportAndResistance', () => {
  it('finds the busiest smoothed peaks on each side of spot within the band', () => {
    const levels = Array.from({ length: 100 }, (_, index) => {
      const price = 60_000 + index * 500;
      const bars = Math.round(
        400 * Math.exp(-(((price - 80_000) / 1_500) ** 2)) + 250 * Math.exp(-(((price - 90_000) / 1_500) ** 2)) + 5,
      );
      return { price, bars };
    });
    const { support, resistance } = supportAndResistance(levels, 500, SPOT);
    expect(support[0]?.priceUsd).toBeGreaterThan(79_000);
    expect(support[0]?.priceUsd).toBeLessThan(81_000);
    expect(support[0]?.activity).toBe(1);
    expect(resistance[0]?.priceUsd).toBeGreaterThan(89_000);
    expect(resistance[0]?.priceUsd).toBeLessThan(91_000);
    expect(resistance[0]?.activity).toBeLessThan(1);
    expect(supportAndResistance([], 500, SPOT)).toEqual({ support: [], resistance: [] });
    const twin = supportAndResistance(
      [
        { price: 79_000, bars: 50 },
        { price: 79_500, bars: 300 },
        { price: 80_000, bars: 50 },
        { price: 80_500, bars: 280 },
        { price: 81_000, bars: 50 },
        { price: 76_000, bars: 120 },
      ].sort((left, right) => left.price - right.price),
      500,
      SPOT,
    );
    const prices = twin.support.map((level) => level.priceUsd);
    prices.forEach((price, index) =>
      prices.slice(index + 1).forEach((other) => expect(Math.abs(price - other)).toBeGreaterThanOrEqual(SPOT * 0.02)),
    );
  });
});

describe('openInterestClusters', () => {
  it('lists the largest open interest per side for each chain', () => {
    const rows = [
      { strike: 80_000, side: 'put' as const, openInterestContracts: 900 },
      { strike: 82_000, side: 'put' as const, openInterestContracts: null },
      { strike: 90_000, side: 'call' as const, openInterestContracts: 1_200 },
      { strike: 95_000, side: 'call' as const, openInterestContracts: 300 },
    ];
    const [cluster] = openInterestClusters([{ expiry: '2026-10-30', rows }]);
    expect(cluster).toEqual({
      expiry: '2026-10-30',
      calls: [
        { strike: 90_000, openInterestContracts: 1_200 },
        { strike: 95_000, openInterestContracts: 300 },
      ],
      puts: [{ strike: 80_000, openInterestContracts: 900 }],
    });
  });
});

describe('buildBookVsMarketFacts', () => {
  it('keeps only held strikes from the break-even route and names unavailable sources', () => {
    const levels = compactLevelInputs(
      'BTC',
      { ok: false, code: 'upstream_error', error: 'GEX failed.' },
      { ok: false, code: 'upstream_unavailable', error: 'No candles.' },
      [
        {
          ok: true,
          data: {
            underlying: 'BTC',
            expiry: '2026-10-30',
            expiryTs: 0,
            asOf: 0,
            spot: SPOT,
            forward: SPOT,
            resolutionSec: 3600,
            recordedSince: null,
            historical: { horizonDays: 23, windows: 700, lookbackDays: 730 },
            spotHistory: [],
            lines: [
              { strike: 85_000, right: 'call', markIv: 0.4, delta: 0.45, premiumUsd: 2_000, breakEven: 87_000.4, impliedProb: 0.4123, historicalProb: 0.38, history: [], projection: [] },
              { strike: 90_000, right: 'call', markIv: 0.4, delta: 0.25, premiumUsd: 900, breakEven: 90_900, impliedProb: 0.2, historicalProb: null, history: [], projection: [] },
            ],
          },
        },
      ],
      ['2026-10-30'],
    );
    const facts = buildBookVsMarketFacts({
      underlying: 'BTC',
      spotUsd: SPOT,
      nowMs: NOW,
      riskWindows: [window({})],
      termStructure: TERM,
      heldExpiryChains: [],
      heldLegs: [{ expiry: '2026-10-30', strike: 85_000, optionRight: 'call' }],
      levels,
    });
    expect(facts.heldLegOdds).toEqual([
      {
        expiry: '2026-10-30',
        strike: 85_000,
        right: 'call',
        breakEvenUsd: 87_000,
        impliedProbBeyondStrike: 0.412,
        historicalProbBeyondStrike: 0.38,
        historicalWindows: 700,
      },
    ]);
    expect(facts.gammaLevels).toBeNull();
    expect(facts.priceLevels).toBeNull();
    expect(facts.notes).toEqual(
      expect.arrayContaining(['gammaLevels unavailable: GEX failed.', 'priceLevels unavailable: No candles.']),
    );
    expect(facts.expiryOutlook).toHaveLength(1);
  });
});
