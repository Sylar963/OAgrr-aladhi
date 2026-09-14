import type { AlphaLottoCandidate } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { buildLottoOutcomes } from './lotto-outcomes';

function candidate(overrides: Partial<AlphaLottoCandidate> = {}): AlphaLottoCandidate {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    instrument: 'BTC-25SEP26-90000-C',
    settle: 'USD',
    inverse: false,
    contractSize: 1,
    minQty: 1,
    expiry: '2026-09-25',
    expiryTs: 1_795_000_000_000,
    dte: 10,
    strike: 90_000,
    indexPrice: 80_000,
    forwardPrice: 80_500,
    referenceSource: 'venue-forward',
    atmIv: 0.4,
    expectedMoveUsd: 5_000,
    expectedMovePct: 6.25,
    mark: 100,
    bid: 95,
    ask: 100,
    takerFee: 2,
    entryCost: 102,
    bidSize: 10,
    askSize: 10,
    delta: 0.2,
    markIv: 0.45,
    spreadPct: 5,
    otmPct: 12.5,
    breakEvenPrice: 90_102,
    breakEvenMovePct: 12.63,
    minimumOrderCost: 102,
    quantityAtMark: 2,
    quantityAtAsk: 2,
    conservativeQuantity: 2,
    targets: [],
    shocks: [],
    asOfMs: 1_794_000_000_000,
    ...overrides,
  };
}

describe('buildLottoOutcomes', () => {
  it('calculates maximum spend and expiry payout from available ask quantity', () => {
    const outcomes = buildLottoOutcomes([candidate()], 100_000, 250, '2026-09-25');

    expect(outcomes[0]).toMatchObject({
      quantity: 2,
      spend: 204,
      payout: 20_000,
      profit: 19_796,
    });
  });

  it('returns distinct safer, balanced, and moonshot choices', () => {
    const outcomes = buildLottoOutcomes([
      candidate({ instrument: 'safe', strike: 85_000, breakEvenMovePct: 7 }),
      candidate({ instrument: 'middle', strike: 90_000, breakEvenMovePct: 13, entryCost: 80 }),
      candidate({ instrument: 'moon', strike: 95_000, breakEvenMovePct: 19, entryCost: 30 }),
    ], 105_000, 250, '2026-09-25');

    expect(outcomes.map((outcome) => outcome.style)).toEqual(['safer', 'balanced', 'moonshot']);
    expect(new Set(outcomes.map((outcome) => outcome.candidate.instrument)).size).toBe(3);
  });

  it('excludes contracts that do not profit at the chosen target', () => {
    const outcomes = buildLottoOutcomes([candidate()], 90_050, 250, '2026-09-25');

    expect(outcomes).toEqual([]);
  });

  it('uses only contracts from the chosen expiry', () => {
    const outcomes = buildLottoOutcomes([
      candidate(),
      candidate({ instrument: 'later', expiry: '2026-10-30' }),
    ], 100_000, 250, '2026-10-30');

    expect(outcomes[0]?.candidate.instrument).toBe('later');
  });
});
