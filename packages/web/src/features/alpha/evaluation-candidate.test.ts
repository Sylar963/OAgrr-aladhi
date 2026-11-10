import { describe, expect, it } from 'vitest';
import { AlphaEvaluationCandidateSchema } from '@oggregator/protocol';
import { input, now } from './spread-scan.fixtures';
import { scanSpreads } from './spread-scanner';
import { longOptionEvaluationCandidate, verticalEvaluationCandidate } from './evaluation-candidate';

describe('evaluation candidate adapters', () => {
  it('preserves the selected spread quotes, venue size and combo fee at underlying-unit size', () => {
    const scan = input();
    const candidate = scanSpreads(scan)[0]!.candidates[0]!;
    const result = verticalEvaluationCandidate(
      candidate,
      scan.chain,
      { buyVenue: 'thalex', sellVenue: 'thalex' },
      10,
    );
    expect(AlphaEvaluationCandidateSchema.safeParse(result).success).toBe(true);
    expect(result!.entryFee).toBe(candidate.entryFee);
    expect(result!.legs.every((leg) => leg.quantity === scan.quantity)).toBe(true);
    expect(result!.legs.map((leg) => leg.quotedAt)).toEqual([now, now]);
    expect(result!.expiryTs).toBe(scan.chain.expiryTs);
  });

  it('converts contract premiums, quantities, fees and rules together', () => {
    const result = longOptionEvaluationCandidate(
      {
        venue: 'thalex',
        underlying: 'BTC',
        instrument: 'BTC-C',
        settle: 'USD',
        inverse: false,
        contractSize: 0.1,
        minQty: 2,
        expiry: '2026-12-25',
        expiryTs: now + 30 * 86_400_000,
        dte: 30,
        strike: 85_000,
        indexPrice: 80_000,
        forwardPrice: 80_000,
        referenceSource: 'venue-forward',
        atmIv: 0.4,
        expectedMoveUsd: null,
        expectedMovePct: null,
        mark: 90,
        bid: 80,
        ask: 100,
        takerFee: 2,
        entryCost: 102,
        bidSize: 10,
        askSize: 10,
        delta: 0.2,
        markIv: 0.45,
        spreadPct: 20,
        otmPct: 6.25,
        breakEvenPrice: 86_020,
        breakEvenMovePct: 7.525,
        probabilityAboveBreakEven: null,
        minimumOrderCost: 204,
        quantityAtMark: 10,
        quantityAtAsk: 10,
        conservativeQuantity: 8,
        targets: [],
        shocks: [],
        asOfMs: now,
      },
      4,
    );
    expect(result.entryFee).toBe(8);
    expect(result.costReserve).toBeNull();
    expect(result.legs[0]).toMatchObject({
      quantity: 0.4,
      price: 1_000,
      fee: 20,
      availableQuantity: 1,
      minQuantity: 0.2,
      quantityStep: null,
    });
    expect(AlphaEvaluationCandidateSchema.safeParse(result).success).toBe(true);
  });
});
