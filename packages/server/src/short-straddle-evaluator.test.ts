import type { PersistedShortStraddleSnapshot } from '@oggregator/db';
import { describe, expect, it } from 'vitest';

import { evaluateShortStraddleSnapshots } from './short-straddle-evaluator.js';

const COHORT_AT = new Date('2026-07-13T08:00:00.000Z');

function observation(
  overrides: Partial<PersistedShortStraddleSnapshot> = {},
): PersistedShortStraddleSnapshot {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    cohortSlotTs: COHORT_AT,
    horizonHours: 0,
    sampleSlotTs: COHORT_AT,
    capturedAt: new Date('2026-07-13T08:05:00.000Z'),
    expiry: '2026-07-20',
    expiryTs: new Date('2026-07-20T08:00:00.000Z'),
    strike: 60_000,
    spotPriceUsd: 60_000,
    forwardPriceUsd: 60_100,
    callBidUsd: 100,
    callAskUsd: 105,
    callBidSize: 5,
    callAskSize: 6,
    callMarkIv: 0.5,
    callDelta: 0.5,
    callVegaUsdPerVolPoint: 10,
    callOpenInterest: 100,
    callMakerFeeUsd: 0.5,
    callTakerFeeUsd: 2,
    callAskMakerFeeUsd: 0.6,
    callAskTakerFeeUsd: 4,
    callQuoteTs: new Date('2026-07-13T08:04:59.000Z'),
    putBidUsd: 90,
    putAskUsd: 95,
    putBidSize: 4,
    putAskSize: 7,
    putMarkIv: 0.52,
    putDelta: -0.5,
    putVegaUsdPerVolPoint: 11,
    putOpenInterest: 110,
    putMakerFeeUsd: 0.5,
    putTakerFeeUsd: 3,
    putAskMakerFeeUsd: 0.6,
    putAskTakerFeeUsd: 5,
    putQuoteTs: new Date('2026-07-13T08:04:59.000Z'),
    ...overrides,
  };
}

describe('evaluateShortStraddleSnapshots', () => {
  it('reports collection status until a fixed-contract mark exists', () => {
    const report = evaluateShortStraddleSnapshots([observation()], {
      underlying: 'BTC',
      windowDays: 90,
      minimumSamples: 100,
      asOfMs: COHORT_AT.getTime(),
    });

    expect(report).toMatchObject({
      status: 'collecting',
      cohortCount: 1,
      completedSampleCount: 0,
      segments: [],
    });
  });

  it('subtracts executable entry and exit taker fees from fixed-contract PnL', () => {
    const entry = observation();
    const mark = observation({
      horizonHours: 1,
      sampleSlotTs: new Date('2026-07-13T09:00:00.000Z'),
      capturedAt: new Date('2026-07-13T09:05:00.000Z'),
      callAskUsd: 80,
      callAskSize: 3,
      putAskUsd: 70,
      putAskSize: 2,
    });

    const report = evaluateShortStraddleSnapshots([entry, mark], {
      underlying: 'BTC',
      windowDays: 90,
      minimumSamples: 10,
      asOfMs: COHORT_AT.getTime() + 3_600_000,
    });

    expect(report.status).toBe('insufficient_data');
    expect(report.segments[0]).toMatchObject({
      horizonHours: 1,
      sampleCount: 1,
      independentSampleCount: 1,
      overlappingSampleCountExcluded: 0,
      profitableCount: 1,
      totalPnlUsdPerUnit: 26,
      meanPnlUsdPerUnit: 26,
      meanCommonTopOfBookQuantity: 2,
    });
    expect(report.segments[0]?.meanPnlPctOfGrossCredit).toBeCloseTo(26 / 190);
  });

  it('excludes marks that do not match the entry strike', () => {
    const report = evaluateShortStraddleSnapshots(
      [observation(), observation({ horizonHours: 1, strike: 61_000 })],
      {
        underlying: 'BTC',
        windowDays: 90,
        minimumSamples: 10,
        asOfMs: COHORT_AT.getTime() + 3_600_000,
      },
    );

    expect(report.completedSampleCount).toBe(0);
    expect(report.status).toBe('insufficient_data');
    expect(report).toMatchObject({ eligibleSampleCount: 1, missingMarkCount: 1, markCoverageRate: 0 });
  });

  it('requires the configured sample count before evidence is available', () => {
    const secondCohort = new Date(COHORT_AT.getTime() + 3_600_000);
    const rows = [
      observation(),
      observation({
        horizonHours: 1,
        sampleSlotTs: new Date(COHORT_AT.getTime() + 3_600_000),
      }),
      observation({ cohortSlotTs: secondCohort, sampleSlotTs: secondCohort }),
      observation({
        cohortSlotTs: secondCohort,
        horizonHours: 1,
        sampleSlotTs: new Date(secondCohort.getTime() + 3_600_000),
      }),
    ];

    const report = evaluateShortStraddleSnapshots(rows, {
      underlying: 'BTC',
      windowDays: 90,
      minimumSamples: 2,
      asOfMs: secondCohort.getTime() + 3_600_000,
    });

    expect(report.status).toBe('evidence_available');
    expect(report.segments[0]?.status).toBe('evidence_available');
    expect(report.segments[0]?.assessment).toBe('negative_after_costs');
    expect(report.segments[0]?.meanPnl95ConfidenceLowUsdPerUnit).not.toBeNull();
  });

  it('excludes overlapping cohorts from statistical sample counts', () => {
    const secondCohort = new Date(COHORT_AT.getTime() + 3_600_000);
    const rows = [
      observation(),
      observation({
        horizonHours: 6,
        sampleSlotTs: new Date(COHORT_AT.getTime() + 6 * 3_600_000),
      }),
      observation({ cohortSlotTs: secondCohort, sampleSlotTs: secondCohort }),
      observation({
        cohortSlotTs: secondCohort,
        horizonHours: 6,
        sampleSlotTs: new Date(secondCohort.getTime() + 6 * 3_600_000),
      }),
    ];

    const report = evaluateShortStraddleSnapshots(rows, {
      underlying: 'BTC',
      windowDays: 90,
      minimumSamples: 2,
      asOfMs: secondCohort.getTime() + 6 * 3_600_000,
    });

    expect(report.segments[0]).toMatchObject({
      sampleCount: 2,
      independentSampleCount: 1,
      overlappingSampleCountExcluded: 1,
      status: 'insufficient_data',
    });
  });
});
