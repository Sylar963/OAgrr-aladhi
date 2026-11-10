import type { AlphaEvaluationRequest, AlphaEvaluationResponse } from '@oggregator/protocol';
import { verticalEvaluationCandidate } from './evaluation-candidate';
import { input } from './spread-scan.fixtures';
import { scanSpreads } from './spread-scanner';

export function evaluationCandidateFixture() {
  const source = input();
  const candidate = scanSpreads(source)[0]!.candidates.find(
    (entry) => entry.kind === 'call-credit',
  )!;
  return verticalEvaluationCandidate(
    candidate,
    source.chain,
    { buyVenue: 'thalex', sellVenue: 'thalex' },
    10,
  )!;
}

export function evaluationResponseFixture(
  request: AlphaEvaluationRequest,
): AlphaEvaluationResponse {
  return {
    id: 'f940d987-ff8b-4c82-87dd-9322fd179763',
    version: 'alpha-evaluation-v1',
    evaluatedAt: Date.now(),
    request: structuredClone(request),
    direction: 'bearish',
    alignment: 'not-specified',
    pricing: {
      horizonDays: 7,
      forecastVol: null,
      forecastMethod: 'mean-reverting-realized-v1',
      forecastSupported: true,
      atmIv: 0.4,
      ivMinusForecast: null,
      usualPremium: null,
      excessPremium: null,
      baselineTenorDays: null,
      baselineSource: null,
      baselineIndependentSamples: 0,
      historyThrough: null,
    },
    stress: {
      rv7d: null,
      rv30d: null,
      accelerationRatio: null,
      return1dPct: null,
      return7dPct: null,
      return30dPct: null,
      termSlope: null,
      skew25d: null,
      regime: null,
    },
    execution: { status: 'incomplete', issues: ['missing-budget'], quoteSource: 'client-snapshot' },
    payoff: {
      grossEntryCash: 3,
      netEntryCash: 2.63,
      maxExpiryLoss: 7.37,
      budgetUsePct: 73.7,
      stressPoints: [],
      protection: null,
    },
    scenario: null,
    evidence: 'unvalidated',
  };
}
