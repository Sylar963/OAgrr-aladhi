import type { AlphaStraddleCandidate, AlphaStraddleScannerResponse } from '@oggregator/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import StraddleScannerPanel from './StraddleScannerPanel';

const replaceLegs = vi.fn();
const scan = vi.hoisted(() => ({ data: null as AlphaStraddleScannerResponse | null }));

vi.mock('./useStraddleScanner', () => ({
  useStraddleScanner: () => ({ data: scan.data, isLoading: false, isFetching: false, error: null }),
  useShortStraddleEvidence: () => ({ data: undefined, isError: true }),
}));
vi.mock('@features/architect/strategy-store', () => ({
  useStrategyStore: (select: (state: { replaceLegs: typeof replaceLegs }) => unknown) =>
    select({ replaceLegs }),
}));

function candidate(overrides: Partial<AlphaStraddleCandidate>): AlphaStraddleCandidate {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    callInstrument: 'BTC-30OCT26-84000-C',
    putInstrument: 'BTC-30OCT26-84000-P',
    expiry: '2026-10-30',
    expiryTs: 1_793_347_200_000,
    dte: 34.2,
    strike: 84_000,
    forwardPrice: 84_037,
    callBid: 3_500,
    putBid: 3_420,
    callAsk: 3_560,
    putAsk: 3_480,
    entryFees: 37,
    grossCredit: 6_920,
    netCredit: 6_883,
    combinedSpreadPct: 1.7,
    markIv: 0.3425,
    sellIv: 0.335,
    forecastVol: 0.371,
    realizedMatchedVol: 0.36,
    hurdleVol: 0.371,
    volEdge: -0.036,
    excessEdge: null,
    conePercentile: 44,
    premiumBaseline: { tenorDays: 30, medianSpread: null, sampleCount: 0, independentSampleCount: 0 },
    fairValueAtForecast: 7_606,
    modelEdgeUsd: -723,
    probInsideAtForecast: 0.5,
    breakevenLow: 77_117,
    breakevenHigh: 90_883,
    breakevenMovePct: 8.1,
    dailyBreakevenMovePct: 1.75,
    forecastDailyMovePct: 1.94,
    netDelta: 0.01,
    stressMovePct: 37,
    stressLossUsd: 27_247,
    minQuantity: 0.1,
    quantityStep: 0.1,
    topOfBookQuantity: 4,
    riskBudgetQuantity: 0,
    suggestedQuantity: 0,
    edgePerStress: -0.026,
    verdict: 'cheap',
    flags: ['iv_below_hurdle', 'negative_model_edge', 'below_cone_median'],
    asOfMs: 1_790_400_000_000,
    ...overrides,
  };
}

function response(candidates: AlphaStraddleCandidate[]): AlphaStraddleScannerResponse {
  return {
    generatedAt: 1_790_400_000_000,
    underlying: 'BTC',
    venues: ['deribit'],
    config: {
      underlying: 'BTC',
      venues: ['deribit'],
      minDte: 1,
      maxDte: 45,
      equity: 10_000,
      riskPct: 1,
      stressSigma: 3,
      maxSpreadPct: 10,
      limit: 30,
    },
    forecast: {
      method: 'mean-reverting-realized-v1',
      rv7d: 0.38,
      rv30d: 0.32,
      longRunVol: 0.36,
      longRunDays: 180,
      halfLifeDays: 14,
    },
    context: {
      atmIv7d: 0.29,
      atmIv30d: 0.35,
      ivPercentile30d: 7,
      termStructure: 'contango',
      spotState: 'inside-range',
    },
    venueStatus: [{ venue: 'deribit', eligibleExpiries: 7, error: null }],
    candidates,
    skipped: {},
  };
}

afterEach(() => {
  cleanup();
  replaceLegs.mockReset();
});

describe('StraddleScannerPanel', () => {
  it('explains why cheap premium is not a sell', () => {
    scan.data = response([candidate({})]);
    render(<StraddleScannerPanel underlying="BTC" venues={['deribit']} />);
    expect(screen.getAllByText("CHEAP · DON'T SELL").length).toBeGreaterThan(0);
    expect(screen.getByText(/below the median realized vol for this horizon/)).toBeTruthy();
    expect(screen.getByText('Evidence collection is unavailable on this server.')).toBeTruthy();
  });

  it('loads both short legs into the builder at the bids', () => {
    scan.data = response([
      candidate({ verdict: 'sell-candidate', flags: [], suggestedQuantity: 0.3 }),
    ]);
    render(<StraddleScannerPanel underlying="BTC" venues={['deribit']} />);
    fireEvent.click(screen.getByRole('button', { name: /Open both legs in Builder V2/ }));
    const [legs, underlying] = replaceLegs.mock.calls[0]!;
    expect(underlying).toBe('BTC');
    expect(legs).toMatchObject([
      { type: 'call', direction: 'sell', strike: 84_000, quantity: 0.3, entryPrice: 3_500 },
      { type: 'put', direction: 'sell', strike: 84_000, quantity: 0.3, entryPrice: 3_420 },
    ]);
  });
});
