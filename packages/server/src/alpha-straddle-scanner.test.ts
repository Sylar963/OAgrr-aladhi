import { price76, type EnrichedStrike, type SpotCandle, type VenueQuote } from '@oggregator/core';
import {
  AlphaStraddleScannerQuerySchema,
  type AlphaStraddleCandidate,
} from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import {
  buildStraddleVolModel,
  computeStraddleCandidate,
  rankStraddleCandidates,
  solveStraddleIv,
  straddleVerdict,
  termStructureState,
  type StraddleMarketContext,
  withVenueBaseline,
} from './alpha-straddle-scanner.js';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;
const FORWARD = 60_000;
const STRIKE = 60_000;
const DAILY_MOVE = 0.02;
const REALIZED = DAILY_MOVE * Math.sqrt(365);
const config = AlphaStraddleScannerQuerySchema.parse({ equity: 100_000, riskPct: 1 });
const calm: StraddleMarketContext = { termStructure: 'contango', spotState: 'inside-range' };

function candles(days = 200, recentMove = DAILY_MOVE): SpotCandle[] {
  let close = FORWARD;
  return Array.from({ length: days }, (_, index) => {
    const move = index >= days - 7 ? recentMove : DAILY_MOVE;
    if (index > 0) close *= Math.exp(index % 2 === 0 ? move : -move);
    return {
      timestamp: NOW - (days - index) * DAY_MS,
      open: close,
      high: close,
      low: close,
      close,
    };
  });
}

function ivSeries(atmIv: number) {
  return candles().map((candle) => ({
    ts: candle.timestamp + DAY_MS,
    atmIv,
    rr25d: null,
    bfly25d: null,
    rr10d: null,
    bfly10d: null,
  }));
}

function leg(bid: number, overrides: Partial<VenueQuote['execution']> = {}): VenueQuote {
  return {
    bid,
    ask: bid * 1.02,
    mid: bid * 1.01,
    midRaw: null,
    bidSize: 2,
    askSize: 2,
    markIv: 0.5,
    bidIv: null,
    askIv: null,
    delta: 0.5,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    asOfMs: NOW - 1_000,
    underlyingPriceUsd: FORWARD,
    inverse: false,
    execution: {
      exchangeSymbol: 'TEST',
      settleCurrency: 'USDC',
      inverse: false,
      quantityUnit: 'base',
      contractMultiplierBase: 1,
      nativeMinQuantity: 0.01,
      nativeQuantityStep: 0.01,
      nativePriceTick: 1,
      minQuantity: 0.01,
      quantityStep: 0.01,
      bidSize: 2,
      askSize: 2,
      bidUsd: bid,
      askUsd: bid * 1.02,
      markUsd: bid * 1.01,
      bidMakerFeeUsd: 1,
      bidTakerFeeUsd: 3,
      askMakerFeeUsd: 1,
      askTakerFeeUsd: 3,
      ...overrides,
    },
  };
}

function straddleAt(vol: number, dteDays = 7): EnrichedStrike {
  const t = dteDays / 365;
  const callBid = price76(FORWARD, STRIKE, vol, t, 'call') + 3;
  const putBid = price76(FORWARD, STRIKE, vol, t, 'put') + 3;
  return {
    strike: STRIKE,
    call: { venues: { thalex: leg(callBid) }, bestIv: null, bestVenue: null },
    put: { venues: { thalex: { ...leg(putBid), delta: -0.5 } }, bestIv: null, bestVenue: null },
  };
}

function evaluate(vol: number, market = calm, dteDays = 7, model = richModel()) {
  const result = computeStraddleCandidate(
    { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-22', expiryTs: NOW + dteDays * DAY_MS },
    straddleAt(vol, dteDays),
    model,
    market,
    config,
    NOW,
  );
  if (result.candidate == null) throw new Error(`skipped: ${result.skipReason}`);
  return result.candidate;
}

function richModel() {
  return buildStraddleVolModel(candles(), { '7d': ivSeries(REALIZED + 0.05), '30d': [] });
}

describe('solveStraddleIv', () => {
  it('recovers the volatility used to price the straddle', () => {
    const t = 10 / 365;
    const price =
      price76(FORWARD, 62_000, 0.55, t, 'call') + price76(FORWARD, 62_000, 0.55, t, 'put');
    expect(solveStraddleIv(price, FORWARD, 62_000, t)).toBeCloseTo(0.55, 6);
  });

  it('returns null when the credit is below intrinsic value', () => {
    expect(solveStraddleIv(500, FORWARD, 58_000, 7 / 365)).toBeNull();
  });
});

describe('buildStraddleVolModel', () => {
  it('forecasts the realized level when recent and long-run volatility agree', () => {
    const model = richModel();
    expect(model.forecastVol(7)).toBeCloseTo(REALIZED, 3);
    expect(model.forecastVol(40)).toBeCloseTo(REALIZED, 3);
  });

  it('decays a recent volatility spike toward the long-run level as horizon grows', () => {
    const model = buildStraddleVolModel(candles(200, 0.05), { '7d': [], '30d': [] });
    const short = model.forecastVol(1)!;
    const long = model.forecastVol(45)!;
    expect(short).toBeGreaterThan(long);
    expect(short).toBeLessThanOrEqual(model.forecast.rv7d!);
    expect(long).toBeGreaterThan(model.forecast.longRunVol!);
  });

  it('measures the normal implied-minus-subsequent-realized premium', () => {
    const baseline = richModel().premiumBaseline(7);
    expect(baseline.tenorDays).toBe(7);
    expect(baseline.medianSpread).toBeCloseTo(0.05, 3);
    expect(baseline.independentSampleCount).toBeGreaterThanOrEqual(4);
  });

  it('matches daily IV stamped at 00:00 UTC against candles that close at 08:00 UTC', () => {
    const series = ivSeries(REALIZED + 0.05).map((point) => ({ ...point, ts: point.ts - 8 * 3_600_000 }));
    const baseline = buildStraddleVolModel(candles(), { '7d': [], '30d': series }).premiumBaseline(30);
    expect(baseline.medianSpread).toBeCloseTo(0.05, 3);
    expect(baseline.independentSampleCount).toBeGreaterThanOrEqual(4);
  });

  it("prefers the venue's own premium baseline and marks its source", () => {
    const blended = richModel();
    const venue = buildStraddleVolModel(candles(), { '7d': ivSeries(REALIZED + 0.08), '30d': [] }, 'venue');
    const baseline = withVenueBaseline(blended, venue).premiumBaseline(7);
    expect(baseline.source).toBe('venue');
    expect(baseline.medianSpread).toBeCloseTo(0.08, 3);
  });

  it('falls back to the blended baseline while the venue lacks history', () => {
    const venue = buildStraddleVolModel(candles(), { '7d': [], '30d': [] }, 'venue');
    const baseline = withVenueBaseline(richModel(), venue).premiumBaseline(7);
    expect(baseline.source).toBe('blended');
    expect(baseline.medianSpread).toBeCloseTo(0.05, 3);
  });

  it('leaves the baseline unknown instead of zero when IV history is missing', () => {
    const model = buildStraddleVolModel(candles(), { '7d': [], '30d': [] });
    expect(model.premiumBaseline(30).medianSpread).toBeNull();
  });

  it('cannot forecast without enough spot history', () => {
    const model = buildStraddleVolModel(candles(20), { '7d': [], '30d': [] });
    expect(model.forecastVol(7)).toBeNull();
  });
});

describe('computeStraddleCandidate', () => {
  it('flags premium sold below realized volatility as cheap', () => {
    const candidate = evaluate(REALIZED - 0.08);
    expect(candidate.verdict).toBe('cheap');
    expect(candidate.flags).toEqual(
      expect.arrayContaining(['iv_below_hurdle', 'negative_model_edge', 'below_cone_median']),
    );
  });

  it('marks premium rich against forecast, cone, and normal premium as a sell candidate', () => {
    const candidate = evaluate(REALIZED + 0.25);
    expect(candidate.flags).toEqual([]);
    expect(candidate.verdict).toBe('sell-candidate');
    expect(candidate.sellIv).toBeCloseTo(REALIZED + 0.25, 4);
    expect(candidate.excessEdge).toBeGreaterThan(0);
    expect(candidate.modelEdgeUsd).toBeGreaterThan(0);
  });

  it('prices breakevens from the credit net of entry fees', () => {
    const candidate = evaluate(REALIZED + 0.25);
    expect(candidate.entryFees).toBe(6);
    expect(candidate.netCredit).toBeCloseTo(candidate.grossCredit - 6, 8);
    expect(candidate.breakevenLow).toBeCloseTo(STRIKE - candidate.netCredit, 8);
    expect(candidate.breakevenHigh).toBeCloseTo(STRIKE + candidate.netCredit, 8);
    expect(candidate.netDelta).toBeCloseTo(0, 8);
  });

  it('sizes to the stress-loss budget and the thinner leg of top-of-book', () => {
    const candidate = evaluate(REALIZED + 0.25);
    expect(candidate.suggestedQuantity).toBeLessThanOrEqual(candidate.topOfBookQuantity);
    expect(candidate.suggestedQuantity * candidate.stressLossUsd).toBeLessThanOrEqual(1_000);
    expect(Math.round(candidate.suggestedQuantity / 0.01) * 0.01).toBeCloseTo(
      candidate.suggestedQuantity,
      10,
    );
  });

  it('downgrades rich premium to watch in a stressed regime', () => {
    const candidate = evaluate(REALIZED + 0.25, {
      termStructure: 'backwardation',
      spotState: 'breaking-out',
    });
    expect(candidate.verdict).toBe('watch');
    expect(candidate.flags).toEqual(['term_backwardation', 'spot_breaking_out']);
  });

  it('flags the final two days as a gamma window', () => {
    expect(evaluate(REALIZED + 0.3, calm, 1).flags).toContain('gamma_window');
  });

  it('skips a straddle whose entry fees are unknown', () => {
    const strike = straddleAt(0.6);
    strike.put.venues.thalex = {
      ...strike.put.venues.thalex!,
      execution: { ...strike.put.venues.thalex!.execution!, bidTakerFeeUsd: null },
    };
    const result = computeStraddleCandidate(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-22', expiryTs: NOW + 7 * DAY_MS },
      strike,
      richModel(),
      calm,
      config,
      NOW,
    );
    expect(result.skipReason).toBe('missing_fees');
  });
});

describe('ranking and verdicts', () => {
  it('orders sell candidates ahead of cheap premium and missing edge last', () => {
    const rich = evaluate(REALIZED + 0.25);
    const cheap = evaluate(REALIZED - 0.08);
    const unknown: AlphaStraddleCandidate = { ...rich, edgePerStress: null, venue: 'deribit' };
    const ranked = rankStraddleCandidates([cheap, unknown, rich]);
    expect(ranked.map((candidate) => candidate.verdict)).toEqual([
      'sell-candidate',
      'sell-candidate',
      'cheap',
    ]);
    expect(ranked[1]).toBe(unknown);
  });

  it('never calls a straddle sellable without a forecast', () => {
    expect(straddleVerdict(['forecast_unavailable', 'iv_below_hurdle'])).toBe('no-forecast');
  });

  it('classifies term structure with a flat band', () => {
    expect(termStructureState(0.6, 0.5)).toBe('backwardation');
    expect(termStructureState(0.5, 0.51)).toBe('flat');
    expect(termStructureState(0.45, 0.5)).toBe('contango');
    expect(termStructureState(null, 0.5)).toBe('unknown');
  });
});
