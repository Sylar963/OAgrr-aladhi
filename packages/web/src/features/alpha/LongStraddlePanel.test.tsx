import type {
  AlphaLongStraddleCandidate,
  AlphaLongStraddleScannerResponse,
} from '@oggregator/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LongStraddlePanel from './LongStraddlePanel';

const replaceLegs = vi.fn();
const scan = vi.hoisted(() => ({ data: null as AlphaLongStraddleScannerResponse | null }));

vi.mock('./useStraddleScanner', () => ({
  useLongStraddleScanner: () => ({ data: scan.data, isLoading: false, isFetching: false, error: null }),
}));
vi.mock('@features/architect/strategy-store', () => ({
  useStrategyStore: (select: (state: { replaceLegs: typeof replaceLegs }) => unknown) =>
    select({ replaceLegs }),
}));

function candidate(overrides: Partial<AlphaLongStraddleCandidate>): AlphaLongStraddleCandidate {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    callInstrument: 'BTC-30OCT26-84000-C',
    putInstrument: 'BTC-30OCT26-84000-P',
    expiry: '2026-10-30',
    expiryTs: 1_793_347_200_000,
    dte: 27.2,
    strike: 84_000,
    forwardPrice: 84_037,
    callBid: 3_000,
    putBid: 2_920,
    callAsk: 3_060,
    putAsk: 2_980,
    entryFees: 37,
    grossDebit: 6_040,
    netDebit: 6_077,
    combinedSpreadPct: 2,
    markIv: 0.3425,
    buyIv: 0.33,
    forecastVol: 0.371,
    calendarForecastVol: 0.371,
    weekendShare: 0.29,
    realizedMatchedVol: 0.36,
    volEdge: 0.041,
    conePercentile: 18,
    fairValueAtForecast: 6_830,
    modelEdgeUsd: 753,
    probOutsideAtForecast: 0.47,
    breakevenLow: 77_923,
    breakevenHigh: 90_077,
    breakevenMovePct: 7.2,
    expectedMoveAtForecastPct: 8.1,
    thetaUsdPerDay: 112,
    dailyBreakevenMovePct: 1.73,
    forecastDailyMovePct: 1.94,
    netDelta: 0.02,
    minQuantity: 0.1,
    quantityStep: 0.1,
    topOfBookQuantity: 4,
    riskBudgetQuantity: 0,
    suggestedQuantity: 0,
    edgePerDebit: 0.124,
    verdict: 'buy-candidate',
    flags: [],
    asOfMs: 1_790_400_000_000,
    ...overrides,
  };
}

function response(candidates: AlphaLongStraddleCandidate[]): AlphaLongStraddleScannerResponse {
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
      maxSpreadPct: 10,
      limit: 50,
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

describe('LongStraddlePanel', () => {
  it('shows a forecast-backed cheap straddle as a buy candidate with its max loss', () => {
    scan.data = response([candidate({})]);
    render(<LongStraddlePanel underlying="BTC" venues={['deribit']} />);
    expect(screen.getByText('CHECK SETUP')).toBeTruthy();
    expect(screen.getByText('4/4 pass')).toBeTruthy();
    expect(screen.getByText('1 BUY')).toBeTruthy();
    expect(screen.getByText(/buy 84,000 C \+ P/)).toBeTruthy();
    expect(screen.getByText('debit $6,077')).toBeTruthy();
  });

  it('explains why a straddle priced above the forecast is not a buy', () => {
    scan.data = response([
      candidate({
        buyIv: 0.4,
        volEdge: -0.029,
        conePercentile: 70,
        modelEdgeUsd: -500,
        verdict: 'expensive',
        flags: ['iv_above_forecast', 'above_cone_median'],
      }),
    ]);
    render(<LongStraddlePanel underlying="BTC" venues={['deribit']} />);
    expect(screen.getByText("EXPENSIVE · DON'T BUY")).toBeTruthy();
    expect(screen.getByText('1/4 pass')).toBeTruthy();
    expect(screen.getByText(/not below the matched-horizon forecast/)).toBeTruthy();
  });

  it('warns that IV far below trailing realized is a fading spike', () => {
    scan.data = response([
      candidate({ verdict: 'watch', flags: ['iv_far_below_realized'] }),
    ]);
    render(<LongStraddlePanel underlying="BTC" venues={['deribit']} />);
    expect(screen.getByText(/lost about 40% of the debit/)).toBeTruthy();
  });

  it('loads both long legs into the builder at the asks', () => {
    scan.data = response([candidate({ suggestedQuantity: 0.3 })]);
    render(<LongStraddlePanel underlying="BTC" venues={['deribit']} />);
    fireEvent.click(screen.getByRole('button', { name: /Open both legs in Builder V2/ }));
    const [legs, underlying] = replaceLegs.mock.calls[0]!;
    expect(underlying).toBe('BTC');
    expect(legs).toMatchObject([
      { type: 'call', direction: 'buy', strike: 84_000, quantity: 0.3, entryPrice: 3_060 },
      { type: 'put', direction: 'buy', strike: 84_000, quantity: 0.3, entryPrice: 2_980 },
    ]);
  });
});
