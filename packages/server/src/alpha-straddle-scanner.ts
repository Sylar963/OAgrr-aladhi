import {
  buildVolForecastModel,
  cdf,
  price76,
  termStructure,
  withVenueBaseline,
  type EnrichedStrike,
  type TenorIvSeries,
  type VenueId,
  type VenueQuote,
  type VolForecastModel,
} from '@oggregator/core';
import type {
  AlphaStraddleCandidate,
  AlphaStraddleFlag,
  AlphaStraddleScannerQuery,
  AlphaStraddleScannerResponse,
  AlphaStraddleVerdict,
} from '@oggregator/protocol';

const DAY_MS = 86_400_000;
const DAYS_IN_YEAR = 365;
const YEAR_MS = DAYS_IN_YEAR * DAY_MS;
const MAX_QUOTE_AGE_MS = 30_000;
const MAX_LEG_QUOTE_SKEW_MS = 5_000;
const CONE_SELL_PERCENTILE = 75;
const CONE_CHEAP_PERCENTILE = 50;
const REALIZED_ACCELERATION_RATIO = 1.25;
const GAMMA_WINDOW_DTE = 2;

export type StraddleSkipReason =
  | 'missing_pair'
  | 'incompatible_pair'
  | 'missing_market'
  | 'missing_fees'
  | 'stale_quote'
  | 'quote_skew'
  | 'wide_spread'
  | 'credit_below_intrinsic';

export type StraddleTermStructure = AlphaStraddleScannerResponse['context']['termStructure'];
export type StraddleSpotState = AlphaStraddleScannerResponse['context']['spotState'];

export type StraddleVolModel = VolForecastModel;
export type StraddleIvSeries = TenorIvSeries;
export const buildStraddleVolModel = buildVolForecastModel;
export { withVenueBaseline };

export interface StraddleMarketContext {
  termStructure: StraddleTermStructure;
  spotState: StraddleSpotState;
}

export interface StraddleExpiryInput {
  venue: VenueId;
  underlying: string;
  expiry: string;
  expiryTs: number;
}

export type StraddleCandidateResult =
  | { candidate: AlphaStraddleCandidate; skipReason: null }
  | { candidate: null; skipReason: StraddleSkipReason };

export function termStructureState(
  atmIv7d: number | null,
  atmIv30d: number | null,
): StraddleTermStructure {
  return termStructure(atmIv7d, atmIv30d).state;
}

export function straddleValue(forward: number, strike: number, vol: number, tYears: number): number {
  return (
    price76(forward, strike, vol, tYears, 'call') + price76(forward, strike, vol, tYears, 'put')
  );
}

export function solveStraddleIv(
  price: number,
  forward: number,
  strike: number,
  tYears: number,
): number | null {
  if (!(price > 0 && forward > 0 && strike > 0 && tYears > 0)) return null;
  let low = 1e-4;
  let high = 5;
  if (price <= straddleValue(forward, strike, low, tYears)) return null;
  if (price >= straddleValue(forward, strike, high, tYears)) return null;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (straddleValue(forward, strike, mid, tYears) < price) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function lognormalCdf(level: number, forward: number, vol: number, tYears: number): number {
  if (level <= 0) return 0;
  const sd = vol * Math.sqrt(tYears);
  return cdf((Math.log(level / forward) + 0.5 * sd * sd) / sd);
}

export function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return value;
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(8));
}

function positive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

interface Leg {
  bid: number;
  ask: number;
  bidSize: number;
  fee: number;
  delta: number | null;
  markIv: number | null;
  asOfMs: number;
  forward: number | null;
  symbol: string;
  minQuantity: number;
  quantityStep: number;
  settle: string;
  inverse: boolean;
}

function readLeg(quote: VenueQuote | undefined): Leg | 'missing' | 'missing_market' | 'missing_fees' {
  const execution = quote?.execution;
  if (quote == null || execution == null) return 'missing';
  if (
    !positive(execution.bidUsd) ||
    !positive(execution.askUsd) ||
    execution.askUsd < execution.bidUsd ||
    !positive(execution.bidSize) ||
    !finite(quote.asOfMs)
  ) {
    return 'missing_market';
  }
  if (!finite(execution.bidTakerFeeUsd) || execution.bidTakerFeeUsd < 0) return 'missing_fees';
  return {
    bid: execution.bidUsd,
    ask: execution.askUsd,
    bidSize: execution.bidSize,
    fee: execution.bidTakerFeeUsd,
    delta: quote.delta,
    markIv: quote.markIv,
    asOfMs: quote.asOfMs,
    forward: quote.underlyingPriceUsd ?? null,
    symbol: execution.exchangeSymbol,
    minQuantity: execution.minQuantity,
    quantityStep: execution.quantityStep,
    settle: execution.settleCurrency,
    inverse: execution.inverse,
  };
}

export function selectAtmStrike(
  strikes: readonly EnrichedStrike[],
  venue: VenueId,
): EnrichedStrike | null {
  const forward = strikes
    .flatMap((strike) => [strike.call.venues[venue], strike.put.venues[venue]])
    .find((quote) => positive(quote?.underlyingPriceUsd))?.underlyingPriceUsd;
  if (!positive(forward)) return null;
  let best: EnrichedStrike | null = null;
  for (const strike of strikes) {
    if (strike.call.venues[venue] == null || strike.put.venues[venue] == null) continue;
    if (best == null || Math.abs(strike.strike - forward) < Math.abs(best.strike - forward)) {
      best = strike;
    }
  }
  return best;
}

export function computeStraddleCandidate(
  input: StraddleExpiryInput,
  strike: EnrichedStrike,
  model: StraddleVolModel,
  market: StraddleMarketContext,
  config: AlphaStraddleScannerQuery,
  nowMs: number,
): StraddleCandidateResult {
  const call = readLeg(strike.call.venues[input.venue]);
  const put = readLeg(strike.put.venues[input.venue]);
  if (call === 'missing' || put === 'missing') return { candidate: null, skipReason: 'missing_pair' };
  if (call === 'missing_market' || put === 'missing_market') {
    return { candidate: null, skipReason: 'missing_market' };
  }
  if (call === 'missing_fees' || put === 'missing_fees') {
    return { candidate: null, skipReason: 'missing_fees' };
  }
  if (call.settle !== put.settle || call.inverse !== put.inverse) {
    return { candidate: null, skipReason: 'incompatible_pair' };
  }
  if (nowMs - Math.min(call.asOfMs, put.asOfMs) > MAX_QUOTE_AGE_MS) {
    return { candidate: null, skipReason: 'stale_quote' };
  }
  if (Math.abs(call.asOfMs - put.asOfMs) > MAX_LEG_QUOTE_SKEW_MS) {
    return { candidate: null, skipReason: 'quote_skew' };
  }
  const forward = call.forward ?? put.forward;
  if (!positive(forward)) return { candidate: null, skipReason: 'missing_market' };

  const grossCredit = call.bid + put.bid;
  const askDebit = call.ask + put.ask;
  const combinedSpreadPct = ((askDebit - grossCredit) / ((askDebit + grossCredit) / 2)) * 100;
  if (combinedSpreadPct > config.maxSpreadPct) {
    return { candidate: null, skipReason: 'wide_spread' };
  }
  const entryFees = call.fee + put.fee;
  const netCredit = grossCredit - entryFees;
  const tYears = (input.expiryTs - nowMs) / YEAR_MS;
  const dte = (input.expiryTs - nowMs) / DAY_MS;
  const K = strike.strike;
  const sellIv = solveStraddleIv(netCredit, forward, K, tYears);
  if (sellIv == null) return { candidate: null, skipReason: 'credit_below_intrinsic' };

  const forecastVol = model.forecastVol(dte);
  const realizedMatchedVol = model.realizedMatched(dte);
  const hurdleCandidates = [forecastVol, realizedMatchedVol].filter(finite);
  const hurdleVol = hurdleCandidates.length === 0 ? null : Math.max(...hurdleCandidates);
  const volEdge = hurdleVol == null ? null : sellIv - hurdleVol;
  const premiumBaseline = model.premiumBaseline(dte);
  const excessEdge =
    forecastVol == null || premiumBaseline.medianSpread == null
      ? null
      : sellIv - forecastVol - premiumBaseline.medianSpread;
  const conePercentile = model.conePercentile(sellIv, dte);
  const fairValueAtForecast =
    forecastVol == null ? null : straddleValue(forward, K, forecastVol, tYears);
  const modelEdgeUsd = fairValueAtForecast == null ? null : netCredit - fairValueAtForecast;
  const breakevenLow = K - netCredit;
  const breakevenHigh = K + netCredit;
  const probInsideAtForecast =
    forecastVol == null
      ? null
      : lognormalCdf(breakevenHigh, forward, forecastVol, tYears) -
        lognormalCdf(breakevenLow, forward, forecastVol, tYears);

  const stressVol = Math.max(sellIv, hurdleVol ?? sellIv);
  const stressLog = config.stressSigma * stressVol * Math.sqrt(tYears);
  const stressUp = forward * Math.exp(stressLog);
  const stressDown = forward * Math.exp(-stressLog);
  const stressLossUsd = Math.max(0, Math.max(stressUp - K, K - stressDown) - netCredit);
  const minQuantity = Math.max(call.minQuantity, put.minQuantity);
  const quantityStep = Math.max(call.quantityStep, put.quantityStep);
  const topOfBookQuantity = Math.min(call.bidSize, put.bidSize);
  const budgetUsd = (config.equity * config.riskPct) / 100;
  const riskBudgetQuantity =
    stressLossUsd > 0 ? floorToStep(budgetUsd / stressLossUsd, quantityStep) : topOfBookQuantity;
  const fitted = floorToStep(Math.min(riskBudgetQuantity, topOfBookQuantity), quantityStep);
  const suggestedQuantity = fitted >= minQuantity ? fitted : 0;
  const netDelta =
    finite(call.delta) && finite(put.delta) ? -(call.delta + put.delta) : null;
  const markIv =
    finite(call.markIv) && finite(put.markIv) ? (call.markIv + put.markIv) / 2 : null;

  const flags: AlphaStraddleFlag[] = [];
  if (forecastVol == null) flags.push('forecast_unavailable');
  if (volEdge != null && volEdge <= 0) flags.push('iv_below_hurdle');
  if (modelEdgeUsd != null && modelEdgeUsd <= 0) flags.push('negative_model_edge');
  if (conePercentile == null) flags.push('cone_unavailable');
  else if (conePercentile < CONE_CHEAP_PERCENTILE) flags.push('below_cone_median');
  else if (conePercentile < CONE_SELL_PERCENTILE) flags.push('below_cone_p75');
  if (premiumBaseline.medianSpread == null) flags.push('premium_baseline_unknown');
  else if (excessEdge != null && excessEdge <= 0) flags.push('premium_not_above_normal');
  if (market.termStructure === 'backwardation') flags.push('term_backwardation');
  if (market.spotState === 'breaking-out' || market.spotState === 'extended') {
    flags.push('spot_breaking_out');
  }
  const { rv7d, rv30d } = model.forecast;
  if (rv7d != null && rv30d != null && rv7d > rv30d * REALIZED_ACCELERATION_RATIO) {
    flags.push('realized_accelerating');
  }
  if (dte < GAMMA_WINDOW_DTE) flags.push('gamma_window');
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
      grossCredit,
      netCredit,
      combinedSpreadPct,
      markIv,
      sellIv,
      forecastVol,
      realizedMatchedVol,
      hurdleVol,
      volEdge,
      excessEdge,
      conePercentile,
      premiumBaseline,
      fairValueAtForecast,
      modelEdgeUsd,
      probInsideAtForecast,
      breakevenLow,
      breakevenHigh,
      breakevenMovePct: (Math.min(breakevenHigh - forward, forward - breakevenLow) / forward) * 100,
      dailyBreakevenMovePct: (sellIv / Math.sqrt(DAYS_IN_YEAR)) * 100,
      forecastDailyMovePct:
        forecastVol == null ? null : (forecastVol / Math.sqrt(DAYS_IN_YEAR)) * 100,
      netDelta,
      stressMovePct: (Math.exp(stressLog) - 1) * 100,
      stressLossUsd,
      minQuantity,
      quantityStep,
      topOfBookQuantity,
      riskBudgetQuantity,
      suggestedQuantity,
      edgePerStress:
        modelEdgeUsd == null || stressLossUsd <= 0 ? null : modelEdgeUsd / stressLossUsd,
      verdict: straddleVerdict(flags),
      flags,
      asOfMs: Math.min(call.asOfMs, put.asOfMs),
    },
    skipReason: null,
  };
}

const CHEAP_FLAGS = new Set<AlphaStraddleFlag>([
  'iv_below_hurdle',
  'negative_model_edge',
  'below_cone_median',
]);

export function straddleVerdict(flags: readonly AlphaStraddleFlag[]): AlphaStraddleVerdict {
  if (flags.includes('forecast_unavailable')) return 'no-forecast';
  if (flags.some((flag) => CHEAP_FLAGS.has(flag))) return 'cheap';
  return flags.length > 0 ? 'watch' : 'sell-candidate';
}

const VERDICT_ORDER: Record<AlphaStraddleVerdict, number> = {
  'sell-candidate': 0,
  watch: 1,
  cheap: 2,
  'no-forecast': 3,
};

function compareNullableDesc(a: number | null, b: number | null): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return b - a;
}

export function rankStraddleCandidates(
  candidates: AlphaStraddleCandidate[],
): AlphaStraddleCandidate[] {
  return candidates.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      compareNullableDesc(a.edgePerStress, b.edgePerStress) ||
      a.combinedSpreadPct - b.combinedSpreadPct ||
      a.dte - b.dte,
  );
}
