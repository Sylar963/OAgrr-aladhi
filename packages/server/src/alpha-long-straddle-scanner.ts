import { weekendShare, type EnrichedStrike } from '@oggregator/core';
import type {
  AlphaLongStraddleCandidate,
  AlphaLongStraddleFlag,
  AlphaLongStraddleScannerQuery,
  AlphaLongStraddleVerdict,
} from '@oggregator/protocol';

import {
  finite,
  floorToStep,
  lognormalCdf,
  readStraddlePair,
  solveStraddleIv,
  straddleValue,
  type StraddleExpiryInput,
  type StraddlePairSkipReason,
  type StraddleMarketContext,
  type StraddleVolModel,
} from './alpha-straddle-scanner.js';

const DAY_MS = 86_400_000;
const DAYS_IN_YEAR = 365;
const YEAR_MS = DAYS_IN_YEAR * DAY_MS;
const CONE_BUY_PERCENTILE = 25;
const CONE_EXPENSIVE_PERCENTILE = 50;
// Same ±2 vol-point "fair" band as the richness reading; our choice, untested.
const FAIR_BAND_VOL = 0.02;
// 2021–26 Deribit reconstruction: 7D straddles bought >5 pts under min(RV7, RV30) returned
// −40% of debit (realized fades and the market prices it). Flag, don't block.
const BELOW_REALIZED_VOL = 0.05;
const THETA_WINDOW_DTE = 2;

export type LongStraddleSkipReason =
  | StraddlePairSkipReason
  | 'wide_spread'
  | 'debit_below_intrinsic';

export type LongStraddleCandidateResult =
  | { candidate: AlphaLongStraddleCandidate; skipReason: null }
  | { candidate: null; skipReason: LongStraddleSkipReason };

export function computeLongStraddleCandidate(
  input: StraddleExpiryInput,
  strike: EnrichedStrike,
  model: StraddleVolModel,
  market: StraddleMarketContext,
  config: AlphaLongStraddleScannerQuery,
  nowMs: number,
): LongStraddleCandidateResult {
  const pair = readStraddlePair(strike, input.venue, 'buy', nowMs);
  if (typeof pair === 'string') return { candidate: null, skipReason: pair };
  const { call, put, forward } = pair;

  const bidCredit = call.bid + put.bid;
  const grossDebit = call.ask + put.ask;
  const combinedSpreadPct = ((grossDebit - bidCredit) / ((grossDebit + bidCredit) / 2)) * 100;
  if (combinedSpreadPct > config.maxSpreadPct) {
    return { candidate: null, skipReason: 'wide_spread' };
  }
  const entryFees = call.fee + put.fee;
  const netDebit = grossDebit + entryFees;
  const tYears = (input.expiryTs - nowMs) / YEAR_MS;
  const dte = (input.expiryTs - nowMs) / DAY_MS;
  const K = strike.strike;
  const buyIv = solveStraddleIv(netDebit, forward, K, tYears);
  if (buyIv == null) return { candidate: null, skipReason: 'debit_below_intrinsic' };

  const calendarForecastVol = model.forecastVol(dte);
  const forecastVol = model.forecastVolUntil(nowMs, input.expiryTs);
  const realizedMatchedVol = model.realizedMatched(dte);
  const volEdge = forecastVol == null ? null : forecastVol - buyIv;
  const conePercentile = model.conePercentile(buyIv, dte);
  const fairValueAtForecast =
    forecastVol == null ? null : straddleValue(forward, K, forecastVol, tYears);
  const modelEdgeUsd = fairValueAtForecast == null ? null : fairValueAtForecast - netDebit;
  const breakevenLow = K - netDebit;
  const breakevenHigh = K + netDebit;
  const probOutsideAtForecast =
    forecastVol == null
      ? null
      : 1 -
        (lognormalCdf(breakevenHigh, forward, forecastVol, tYears) -
          lognormalCdf(breakevenLow, forward, forecastVol, tYears));
  const expectedMoveAtForecastPct =
    forecastVol == null ? null : forecastVol * Math.sqrt(tYears) * Math.sqrt(2 / Math.PI) * 100;
  const thetaHorizon = Math.min(1 / DAYS_IN_YEAR, tYears);
  const thetaUsdPerDay =
    (straddleValue(forward, K, buyIv, tYears) -
      straddleValue(forward, K, buyIv, tYears - thetaHorizon)) *
    ((1 / DAYS_IN_YEAR) / thetaHorizon);

  const minQuantity = Math.max(call.minQuantity, put.minQuantity);
  const quantityStep = Math.max(call.quantityStep, put.quantityStep);
  const topOfBookQuantity = Math.min(call.size, put.size);
  const budgetUsd = (config.equity * config.riskPct) / 100;
  const riskBudgetQuantity = floorToStep(budgetUsd / netDebit, quantityStep);
  const fitted = floorToStep(Math.min(riskBudgetQuantity, topOfBookQuantity), quantityStep);
  const suggestedQuantity = fitted >= minQuantity ? fitted : 0;
  const netDelta = finite(call.delta) && finite(put.delta) ? call.delta + put.delta : null;
  const markIv =
    finite(call.markIv) && finite(put.markIv) ? (call.markIv + put.markIv) / 2 : null;

  const flags: AlphaLongStraddleFlag[] = [];
  if (forecastVol == null) flags.push('forecast_unavailable');
  else if (volEdge != null && volEdge <= 0) flags.push('iv_above_forecast');
  else if (volEdge != null && volEdge < FAIR_BAND_VOL) flags.push('edge_within_fair_band');
  if (conePercentile == null) flags.push('cone_unavailable');
  else if (conePercentile >= CONE_EXPENSIVE_PERCENTILE) flags.push('above_cone_median');
  else if (conePercentile > CONE_BUY_PERCENTILE) flags.push('above_cone_p25');
  const { rv7d, rv30d } = model.forecast;
  if (rv7d != null && rv30d != null && buyIv < Math.min(rv7d, rv30d) - BELOW_REALIZED_VOL) {
    flags.push('iv_far_below_realized');
  }
  if (market.termStructure === 'backwardation') flags.push('term_backwardation');
  if (dte < THETA_WINDOW_DTE) flags.push('theta_window');
  if (suggestedQuantity === 0) flags.push('size_below_minimum');

  return {
    candidate: {
      venue: input.venue,
      underlying: input.underlying,
      callInstrument: call.symbol,
      putInstrument: put.symbol,
      expiry: input.expiry,
      expiryTs: input.expiryTs,
      dte,
      strike: K,
      forwardPrice: forward,
      callBid: call.bid,
      putBid: put.bid,
      callAsk: call.ask,
      putAsk: put.ask,
      entryFees,
      grossDebit,
      netDebit,
      combinedSpreadPct,
      markIv,
      buyIv,
      forecastVol,
      calendarForecastVol,
      weekendShare: weekendShare(nowMs, input.expiryTs),
      realizedMatchedVol,
      volEdge,
      conePercentile,
      fairValueAtForecast,
      modelEdgeUsd,
      probOutsideAtForecast,
      breakevenLow,
      breakevenHigh,
      breakevenMovePct: (Math.min(breakevenHigh - forward, forward - breakevenLow) / forward) * 100,
      expectedMoveAtForecastPct,
      thetaUsdPerDay,
      dailyBreakevenMovePct: (buyIv / Math.sqrt(DAYS_IN_YEAR)) * 100,
      forecastDailyMovePct:
        forecastVol == null ? null : (forecastVol / Math.sqrt(DAYS_IN_YEAR)) * 100,
      netDelta,
      minQuantity,
      quantityStep,
      topOfBookQuantity,
      riskBudgetQuantity,
      suggestedQuantity,
      edgePerDebit: modelEdgeUsd == null ? null : modelEdgeUsd / netDebit,
      verdict: longStraddleVerdict(flags),
      flags,
      asOfMs: Math.min(call.asOfMs, put.asOfMs),
    },
    skipReason: null,
  };
}

const EXPENSIVE_FLAGS = new Set<AlphaLongStraddleFlag>(['iv_above_forecast', 'above_cone_median']);

export function longStraddleVerdict(
  flags: readonly AlphaLongStraddleFlag[],
): AlphaLongStraddleVerdict {
  if (flags.includes('forecast_unavailable')) return 'no-forecast';
  if (flags.some((flag) => EXPENSIVE_FLAGS.has(flag))) return 'expensive';
  return flags.length > 0 ? 'watch' : 'buy-candidate';
}

const VERDICT_ORDER: Record<AlphaLongStraddleVerdict, number> = {
  'buy-candidate': 0,
  watch: 1,
  expensive: 2,
  'no-forecast': 3,
};

function compareNullableDesc(a: number | null, b: number | null): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return b - a;
}

export function rankLongStraddleCandidates(
  candidates: AlphaLongStraddleCandidate[],
): AlphaLongStraddleCandidate[] {
  return candidates.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      compareNullableDesc(a.edgePerDebit, b.edgePerDebit) ||
      a.combinedSpreadPct - b.combinedSpreadPct ||
      a.dte - b.dte,
  );
}
