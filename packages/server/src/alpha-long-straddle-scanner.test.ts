import { price76, type EnrichedStrike, type SpotCandle, type VenueQuote } from '@oggregator/core';
import { AlphaLongStraddleScannerQuerySchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import {
  computeLongStraddleCandidate,
  longStraddleVerdict,
  rankLongStraddleCandidates,
} from './alpha-long-straddle-scanner.js';
import {
  buildStraddleVolModel,
  solveStraddleIv,
  type StraddleMarketContext,
} from './alpha-straddle-scanner.js';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;
const FORWARD = 60_000;
const STRIKE = 60_000;
const DAILY_MOVE = 0.02;
const ASK_FEE = 3;
const config = AlphaLongStraddleScannerQuerySchema.parse({ equity: 100_000, riskPct: 1 });
const calm: StraddleMarketContext = { termStructure: 'contango', spotState: 'inside-range' };

function candles(days = 200): SpotCandle[] {
  let close = FORWARD;
  return Array.from({ length: days }, (_, index) => {
    if (index > 0) close *= Math.exp(index % 2 === 0 ? DAILY_MOVE : -DAILY_MOVE);
    return { timestamp: NOW - (days - index) * DAY_MS, open: close, high: close, low: close, close };
  });
}

const model = buildStraddleVolModel(candles(), { '7d': [], '30d': [] });
const forecast7d = model.forecastVol(7)!;

function leg(ask: number, overrides: Partial<VenueQuote['execution']> = {}): VenueQuote {
  return {
    bid: ask * 0.98,
    ask,
    mid: ask * 0.99,
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
      bidUsd: ask * 0.98,
      askUsd: ask,
      markUsd: ask * 0.99,
      bidMakerFeeUsd: 1,
      bidTakerFeeUsd: ASK_FEE,
      askMakerFeeUsd: 1,
      askTakerFeeUsd: ASK_FEE,
      ...overrides,
    },
  };
}

/** Asks priced so that asks + taker fees equal the straddle's value at `vol`. */
function straddleAt(vol: number, dteDays = 7, overrides: Partial<VenueQuote['execution']> = {}): EnrichedStrike {
  const t = dteDays / 365;
  const callAsk = price76(FORWARD, STRIKE, vol, t, 'call') - ASK_FEE;
  const putAsk = price76(FORWARD, STRIKE, vol, t, 'put') - ASK_FEE;
  return {
    strike: STRIKE,
    call: { venues: { thalex: leg(callAsk, overrides) }, bestIv: null, bestVenue: null },
    put: { venues: { thalex: { ...leg(putAsk, overrides), delta: -0.45 } }, bestIv: null, bestVenue: null },
  };
}

function evaluate(vol: number, market = calm, dteDays = 7) {
  const result = computeLongStraddleCandidate(
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

describe('computeLongStraddleCandidate', () => {
  it('prices the buy IV from the asks plus taker fees', () => {
    const candidate = evaluate(forecast7d - 0.03);
    expect(candidate.entryFees).toBe(2 * ASK_FEE);
    expect(candidate.netDebit).toBeCloseTo(candidate.grossDebit + 2 * ASK_FEE, 8);
    expect(candidate.buyIv).toBeCloseTo(forecast7d - 0.03, 6);
    expect(candidate.volEdge).toBeCloseTo(0.03, 6);
  });

  it('marks a straddle priced below the forecast and low on the cone as a buy candidate', () => {
    const candidate = evaluate(forecast7d - 0.03);
    expect(candidate.flags).toEqual([]);
    expect(candidate.verdict).toBe('buy-candidate');
    expect(candidate.modelEdgeUsd).toBeGreaterThan(0);
    expect(candidate.conePercentile).toBeLessThanOrEqual(25);
  });

  it('calls a straddle expensive when the buy IV is at or above the forecast', () => {
    const candidate = evaluate(forecast7d + 0.03);
    expect(candidate.flags).toContain('iv_above_forecast');
    expect(candidate.flags).toContain('above_cone_median');
    expect(candidate.verdict).toBe('expensive');
    expect(candidate.modelEdgeUsd).toBeLessThan(0);
  });

  it('watches an edge inside the ±2 vol-point fair band', () => {
    const candidate = evaluate(forecast7d - 0.01);
    expect(candidate.flags).toContain('edge_within_fair_band');
    expect(candidate.verdict).toBe('watch');
  });

  it('watches IV far below trailing 7D realized as a fading spike', () => {
    const candidate = evaluate(forecast7d - 0.08);
    expect(candidate.flags).toContain('realized_spike_fading');
    expect(candidate.verdict).toBe('watch');
  });

  it('flags backwardation and the last two days of theta', () => {
    const candidate = evaluate(forecast7d - 0.03, { termStructure: 'backwardation', spotState: 'inside-range' }, 1);
    expect(candidate.flags).toEqual(expect.arrayContaining(['term_backwardation', 'theta_window']));
    expect(candidate.verdict).toBe('watch');
  });

  it('bounds the loss to the debit and sizes it to the budget', () => {
    const candidate = evaluate(forecast7d - 0.03);
    const budget = (config.equity * config.riskPct) / 100;
    expect(candidate.suggestedQuantity * candidate.netDebit).toBeLessThanOrEqual(budget);
    expect((candidate.suggestedQuantity + candidate.quantityStep) * candidate.netDebit).toBeGreaterThan(budget);
    expect(candidate.breakevenLow).toBeCloseTo(STRIKE - candidate.netDebit, 8);
    expect(candidate.breakevenHigh).toBeCloseTo(STRIKE + candidate.netDebit, 8);
  });

  it('caps size at the smaller ask size', () => {
    const result = computeLongStraddleCandidate(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-22', expiryTs: NOW + 7 * DAY_MS },
      straddleAt(forecast7d - 0.03, 7, { askSize: 0.05 }),
      model,
      calm,
      config,
      NOW,
    );
    expect(result.candidate?.topOfBookQuantity).toBe(0.05);
    expect(result.candidate?.suggestedQuantity).toBe(0.05);
  });

  it('reports positive daily theta decay, a delta near zero, and odds of finishing outside the breakevens', () => {
    const candidate = evaluate(forecast7d - 0.03);
    expect(candidate.thetaUsdPerDay).toBeGreaterThan(0);
    expect(candidate.netDelta).toBeCloseTo(0.05, 8);
    expect(candidate.probOutsideAtForecast).toBeGreaterThan(0);
    expect(candidate.probOutsideAtForecast).toBeLessThan(1);
  });

  it('skips quotes without ask-side taker fees', () => {
    const result = computeLongStraddleCandidate(
      { venue: 'thalex', underlying: 'BTC', expiry: '2027-01-22', expiryTs: NOW + 7 * DAY_MS },
      straddleAt(forecast7d, 7, { askTakerFeeUsd: null }),
      model,
      calm,
      config,
      NOW,
    );
    expect(result.skipReason).toBe('missing_fees');
  });

  it('does not treat the bid-side credit IV as the buy IV', () => {
    const candidate = evaluate(forecast7d - 0.03);
    const t = 7 / 365;
    const bidIv = solveStraddleIv(candidate.callBid + candidate.putBid, FORWARD, STRIKE, t)!;
    expect(bidIv).toBeLessThan(candidate.buyIv);
  });
});

describe('longStraddleVerdict', () => {
  it('needs a forecast before judging the price', () => {
    expect(longStraddleVerdict(['forecast_unavailable', 'cone_unavailable'])).toBe('no-forecast');
  });
});

describe('rankLongStraddleCandidates', () => {
  it('puts buy candidates first, then larger model edge per dollar of debit', () => {
    const buy = evaluate(forecast7d - 0.03);
    const expensive = evaluate(forecast7d + 0.03);
    const fair = evaluate(forecast7d - 0.01);
    const ranked = rankLongStraddleCandidates([expensive, fair, buy]);
    expect(ranked.map((candidate) => candidate.verdict)).toEqual(['buy-candidate', 'watch', 'expensive']);
  });
});
