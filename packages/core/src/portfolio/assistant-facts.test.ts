import type { PortfolioMetrics, PositionLeg } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import {
  buildPortfolioAssistantRiskFacts,
  rankPortfolioRiskContributors,
} from './assistant-facts.js';

const position: PositionLeg = {
  legId: 'leg-1',
  underlying: 'BTC',
  expiry: '2026-12-25',
  strike: 100_000,
  optionRight: 'call',
  size: -2,
  entryPriceUsd: 1_000,
  entryIv: 0.6,
  realizedPnlUsd: 0,
  entryTs: 1,
  venueHint: null,
  source: 'manual',
};

const metrics: PortfolioMetrics = {
  accountId: 'secret-account',
  generatedAt: 1,
  forwardDays: 0,
  totals: {
    netDeltaUsd: -1,
    netGammaUsd: -2,
    netVegaUsd: -3,
    netThetaUsd: 4,
    netVannaUsd: -5,
    netVolgaUsd: 6,
    unrealizedPnlUsd: 7,
  },
  pnlCurve: {
    status: 'missing_marks',
    underlying: 'BTC',
    currentSpotUsd: 90_000,
    breakEvenPricesUsd: [],
    maxProfitUsd: null,
    maxLossUsd: null,
    upsideBounded: false,
    downsideBounded: false,
    points: [],
  },
  byStrike: [
    {
      strike: 100_000,
      expiry: '2026-12-25',
      optionRight: 'call',
      delta: -1,
      gamma: -4,
      vega: -3,
      vanna: -5,
      volga: 6,
      contracts: 2,
    },
    {
      strike: 90_000,
      expiry: '2026-12-25',
      optionRight: 'put',
      delta: 1,
      gamma: 2,
      vega: 1,
      vanna: 1,
      volga: 1,
      contracts: 1,
    },
  ],
  byExpiry: [{ expiry: '2026-12-25', dte: 90, vega: -3, gamma: -2, theta: 4, contracts: 2 }],
  breakEven: [
    {
      legId: 'leg-1',
      strike: 100_000,
      expiry: '2026-12-25',
      optionRight: 'call',
      entryIv: 0.6,
      currentMarkUsd: null,
      currentIv: 0.5,
      breakEvenIv: null,
      ivCushionPct: null,
    },
  ],
  shockGrid: [],
  shockGridMeta: {
    totalLegs: 1,
    pricedLegs: 0,
    excludedLegIds: ['leg-1'],
    anchor: 'per_leg_forward',
  },
  strategies: [],
  accounting: {
    openGrossDebitUsd: 0,
    openGrossCreditUsd: 2_000,
    openNetPremiumUsd: -2_000,
    knownFeesUsd: null,
    realizedPnlUsd: 0,
    persistedTradeCount: null,
    historyFromMs: null,
    lastSyncedAtMs: null,
    persistence: 'unavailable',
  },
};

describe('portfolio assistant risk facts', () => {
  it('preserves missing marks and IV fractions', () => {
    const facts = buildPortfolioAssistantRiskFacts([position], metrics);
    expect(facts.positions[0]?.currentMarkUsd).toBeNull();
    expect(facts.positions[0]?.currentIv).toBe(0.5);
    expect(facts.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no current mark'),
        expect.stringContaining('excluded from shock repricing'),
        expect.stringContaining('do not infer them as zero'),
      ]),
    );
  });

  it('ranks by absolute contribution with deterministic ties', () => {
    const facts = buildPortfolioAssistantRiskFacts([position], metrics);
    expect(rankPortfolioRiskContributors(facts, 'gamma')[0]).toMatchObject({
      strike: 100_000,
      value: -4,
    });
    expect(rankPortfolioRiskContributors(facts, 'theta')[0]).toMatchObject({
      dimension: 'expiry',
      value: 4,
    });
  });
});
