import type { AlphaPutCandidate } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { buildProtectionChoices, hedgedPnlAt } from './put-protection';

function candidate(strike: number, cost: number, overrides: Partial<AlphaPutCandidate> = {}): AlphaPutCandidate {
  const indexPrice = 100_000;
  const maxLoss = indexPrice - strike + cost;
  return {
    venue: 'deribit',
    underlying: 'BTC',
    instrument: `BTC-P-${strike}`,
    settle: 'BTC',
    inverse: true,
    contractSize: 1,
    minQty: 0.1,
    expiry: '2026-10-30',
    expiryTs: 0,
    dte: 30,
    strike,
    indexPrice,
    forwardPrice: indexPrice,
    referenceSource: 'venue-forward',
    atmIv: 0.45,
    expectedMoveUsd: null,
    expectedMovePct: null,
    mark: cost,
    bid: cost * 0.95,
    ask: cost,
    takerFee: null,
    entryCost: cost,
    bidSize: 5,
    askSize: 5,
    delta: -0.2,
    markIv: 0.5,
    spreadPct: 5,
    otmPct: ((indexPrice - strike) / indexPrice) * 100,
    breakEvenPrice: strike - cost,
    breakEvenMovePct: 0,
    minimumOrderCost: cost * 0.1,
    quantityAtMark: 0,
    quantityAtAsk: 0,
    conservativeQuantity: 0,
    targets: [],
    shocks: [],
    protection: {
      premiumPerUnit: cost,
      costPct: cost / 1_000,
      annualizedCostPct: 0,
      maxLossPct: maxLoss / 1_000,
      upsideBreakEvenPrice: indexPrice + cost,
      skewPremium: null,
    },
    hedge: {
      targetQty: 1,
      contracts: 1,
      coveredQty: 1,
      cost,
      costPctOfHolding: cost / 1_000,
      maxLoss,
      maxLossPct: maxLoss / 1_000,
      fullyCovered: true,
    },
    asOfMs: 0,
    ...overrides,
  };
}

describe('buildProtectionChoices', () => {
  const choices = [
    candidate(95_000, 3_000),
    candidate(90_000, 1_500),
    candidate(85_000, 700),
    candidate(75_000, 150),
  ];

  it('returns the tightest floor, the cheapest tail, and a middle strike', () => {
    const result = buildProtectionChoices(choices, '2026-10-30');
    expect(result.map((choice) => [choice.style, choice.candidate.strike])).toEqual([
      ['tight', 95_000],
      ['balanced', 85_000],
      ['cheap', 75_000],
    ]);
  });

  it('ignores other expiries and unhedged candidates', () => {
    const other = candidate(98_000, 4_000, { expiry: '2026-11-27' });
    const unhedged = candidate(97_000, 3_500, { hedge: null });
    const result = buildProtectionChoices([other, unhedged, ...choices.slice(0, 1)], '2026-10-30');
    expect(result.map((choice) => [choice.style, choice.candidate.strike])).toEqual([
      ['balanced', 95_000],
    ]);
  });
});

describe('hedgedPnlAt', () => {
  it('floors the hedged loss below the strike', () => {
    const put = candidate(90_000, 1_500);
    expect(hedgedPnlAt(put, put.hedge!, 50_000)).toBe(-11_500);
    expect(hedgedPnlAt(put, put.hedge!, 120_000)).toBe(18_500);
  });
});
