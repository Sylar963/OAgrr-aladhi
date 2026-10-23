import type { EnrichedStrike, SpotCandle } from '@oggregator/core';
import type {
  AlphaIronFlyCandidate,
  AlphaIronFlyFlag,
  AlphaIronFlyHistoryStats,
  AlphaIronFlyScannerQuery,
  AlphaIronFlyVerdict,
  AlphaIronFlyWindowSet,
} from '@oggregator/protocol';

import {
  finite,
  floorToStep,
  lognormalCdf,
  positive,
  readLeg,
  selectAtmStrike,
  type StraddleExpiryInput,
  type StraddleLeg,
} from './alpha-straddle-scanner.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const MAX_QUOTE_AGE_MS = 30_000;
const MAX_LEG_QUOTE_SKEW_MS = 5_000;
// Wing widths as a share of the forward; each picks the nearest listed symmetric width.
const WIDTH_TARGETS_PCT = [1, 2, 3, 5];
export const HOLDOUT_WEEKS = 26;
// Below a year of fit windows the tails are too thin to say anything about a short-gamma payoff.
const MIN_FIT_WINDOWS = 52;
const Z_95 = 1.96;

export type IronFlySkipReason =
  | 'no_atm_strike'
  | 'missing_pair'
  | 'missing_market'
  | 'missing_fees'
  | 'incompatible_pair'
  | 'stale_quote'
  | 'quote_skew'
  | 'no_wings'
  | 'wide_spread'
  | 'credit_not_positive'
  | 'credit_above_width';

export type IronFlyCandidateResult =
  | { candidate: AlphaIronFlyCandidate; skipReason: null }
  | { candidate: null; skipReason: IronFlySkipReason };

/**
 * Past windows that start at the same hour of the week as `entryTs` and end at the same hour
 * of the week as `expiryTs`, from hourly perp candles. A candle stamped t closes at t + 1h, so
 * the price at hour h is the close of the candle stamped h − 1h. Oldest first.
 */
export function comparableWindows(
  candles: readonly SpotCandle[],
  entryTs: number,
  expiryTs: number,
  lookbackWeeks: number,
  holdoutWeeks: number = HOLDOUT_WEEKS,
): AlphaIronFlyWindowSet {
  const priceAt = new Map<number, number>();
  let lastHour = -Infinity;
  for (const candle of candles) {
    if (!(candle.close > 0)) continue;
    const hour = candle.timestamp + HOUR_MS;
    priceAt.set(hour, candle.close);
    if (hour > lastHour) lastHour = hour;
  }
  const entryHour = Math.floor(entryTs / HOUR_MS) * HOUR_MS;
  const expiryHour = Math.round(expiryTs / HOUR_MS) * HOUR_MS;
  const startTs: number[] = [];
  const ratios: number[] = [];
  for (let week = lookbackWeeks; week >= 1; week--) {
    const start = entryHour - week * WEEK_MS;
    const end = expiryHour - week * WEEK_MS;
    if (end > lastHour) continue;
    const from = priceAt.get(start);
    const to = priceAt.get(end);
    if (from == null || to == null) continue;
    startTs.push(start);
    ratios.push(to / from);
  }
  return {
    expiryTs,
    horizonHours: (expiryHour - entryHour) / HOUR_MS,
    startTs,
    ratios,
    holdoutFrom: Math.max(0, ratios.length - holdoutWeeks),
  };
}

export function ironFlyPnl(credit: number, center: number, width: number, settle: number): number {
  return credit - Math.min(Math.abs(settle - center), width);
}

/** Windows longer than a week overlap their neighbours, so they count as less than one each. */
export function independentWindowShare(horizonHours: number): number {
  return horizonHours <= 7 * 24 ? 1 : (7 * 24) / horizonHours;
}

export function ironFlyHistoryStats(
  pnls: readonly number[],
  horizonHours: number,
): AlphaIronFlyHistoryStats {
  const n = pnls.length;
  const independentN = n * independentWindowShare(horizonHours);
  if (n === 0) {
    return {
      n,
      independentN,
      profitRate: null,
      meanPnl: null,
      ciLow: null,
      ciHigh: null,
      worstPnl: null,
      bestPnl: null,
    };
  }
  let sum = 0;
  let wins = 0;
  let worst = Infinity;
  let best = -Infinity;
  for (const pnl of pnls) {
    sum += pnl;
    if (pnl > 0) wins += 1;
    if (pnl < worst) worst = pnl;
    if (pnl > best) best = pnl;
  }
  const mean = sum / n;
  let ci: number | null = null;
  if (n > 1 && independentN > 1) {
    let squares = 0;
    for (const pnl of pnls) squares += (pnl - mean) ** 2;
    ci = Z_95 * Math.sqrt(squares / (n - 1) / independentN);
  }
  return {
    n,
    independentN,
    profitRate: wins / n,
    meanPnl: mean,
    ciLow: ci == null ? null : mean - ci,
    ciHigh: ci == null ? null : mean + ci,
    worstPnl: worst,
    bestPnl: best,
  };
}

/** Symmetric listed wings nearest each width target, narrowest first. */
export function selectWingWidths(
  strikes: readonly EnrichedStrike[],
  venue: StraddleExpiryInput['venue'],
  center: number,
  forward: number,
): number[] {
  const calls = new Set<number>();
  const puts = new Set<number>();
  for (const strike of strikes) {
    if (strike.strike > center && strike.call.venues[venue] != null) calls.add(strike.strike);
    if (strike.strike < center && strike.put.venues[venue] != null) puts.add(strike.strike);
  }
  const available = [...calls]
    .map((strike) => strike - center)
    .filter((width) => puts.has(center - width))
    .sort((a, b) => a - b);
  if (available.length === 0) return [];
  const chosen = new Set<number>();
  for (const pct of WIDTH_TARGETS_PCT) {
    const target = (forward * pct) / 100;
    let best = available[0]!;
    for (const width of available) {
      if (Math.abs(width - target) < Math.abs(best - target)) best = width;
    }
    chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b);
}

function quoteAt(strikes: readonly EnrichedStrike[], value: number): EnrichedStrike | undefined {
  return strikes.find((strike) => strike.strike === value);
}

type FlyLegs = { call: StraddleLeg; put: StraddleLeg; wingCall: StraddleLeg; wingPut: StraddleLeg };

function readFlyLegs(
  strikes: readonly EnrichedStrike[],
  venue: StraddleExpiryInput['venue'],
  center: number,
  width: number,
  nowMs: number,
): FlyLegs | IronFlySkipReason {
  const body = quoteAt(strikes, center);
  const upper = quoteAt(strikes, center + width);
  const lower = quoteAt(strikes, center - width);
  const legs = [
    readLeg(body?.call.venues[venue], 'sell'),
    readLeg(body?.put.venues[venue], 'sell'),
    readLeg(upper?.call.venues[venue], 'buy'),
    readLeg(lower?.put.venues[venue], 'buy'),
  ];
  if (legs.includes('missing')) return 'missing_pair';
  if (legs.includes('missing_market')) return 'missing_market';
  if (legs.includes('missing_fees')) return 'missing_fees';
  const [call, put, wingCall, wingPut] = legs as StraddleLeg[];
  const all = [call!, put!, wingCall!, wingPut!];
  if (all.some((leg) => leg.settle !== call!.settle || leg.inverse !== call!.inverse)) {
    return 'incompatible_pair';
  }
  const times = all.map((leg) => leg.asOfMs);
  if (nowMs - Math.min(...times) > MAX_QUOTE_AGE_MS) return 'stale_quote';
  if (Math.max(...times) - Math.min(...times) > MAX_LEG_QUOTE_SKEW_MS) return 'quote_skew';
  return { call: call!, put: put!, wingCall: wingCall!, wingPut: wingPut! };
}

export function computeIronFlyCandidates(
  input: StraddleExpiryInput,
  strikes: readonly EnrichedStrike[],
  windows: AlphaIronFlyWindowSet,
  config: AlphaIronFlyScannerQuery,
  nowMs: number,
): IronFlyCandidateResult[] {
  const atm = selectAtmStrike(strikes, input.venue);
  if (atm == null) return [{ candidate: null, skipReason: 'no_atm_strike' }];
  const center = atm.strike;
  const forward =
    atm.call.venues[input.venue]?.underlyingPriceUsd ?? atm.put.venues[input.venue]?.underlyingPriceUsd;
  if (!positive(forward)) return [{ candidate: null, skipReason: 'missing_market' }];
  const widths = selectWingWidths(strikes, input.venue, center, forward);
  if (widths.length === 0) return [{ candidate: null, skipReason: 'no_wings' }];
  return widths.map((width) =>
    computeIronFly(input, strikes, center, width, forward, windows, config, nowMs),
  );
}

function computeIronFly(
  input: StraddleExpiryInput,
  strikes: readonly EnrichedStrike[],
  center: number,
  width: number,
  forward: number,
  windows: AlphaIronFlyWindowSet,
  config: AlphaIronFlyScannerQuery,
  nowMs: number,
): IronFlyCandidateResult {
  const legs = readFlyLegs(strikes, input.venue, center, width, nowMs);
  if (typeof legs === 'string') return { candidate: null, skipReason: legs };
  const { call, put, wingCall, wingPut } = legs;

  const grossCredit = call.bid + put.bid - wingCall.ask - wingPut.ask;
  const buyBackDebit = call.ask + put.ask - wingCall.bid - wingPut.bid;
  const mid = (grossCredit + buyBackDebit) / 2;
  const combinedSpreadPct = mid > 0 ? ((buyBackDebit - grossCredit) / mid) * 100 : Infinity;
  if (combinedSpreadPct > config.maxSpreadPct) return { candidate: null, skipReason: 'wide_spread' };
  const entryFees = call.fee + put.fee + wingCall.fee + wingPut.fee;
  const netCredit = grossCredit - entryFees;
  if (!(netCredit > 0)) return { candidate: null, skipReason: 'credit_not_positive' };
  if (netCredit >= width) return { candidate: null, skipReason: 'credit_above_width' };

  const maxLoss = width - netCredit;
  const breakevenLow = center - netCredit;
  const breakevenHigh = center + netCredit;
  const tYears = (input.expiryTs - nowMs) / YEAR_MS;
  const markIv =
    finite(call.markIv) && finite(put.markIv) ? (call.markIv + put.markIv) / 2 : null;
  const impliedProfitRate =
    markIv != null && markIv > 0 && tYears > 0
      ? lognormalCdf(breakevenHigh, forward, markIv, tYears) -
        lognormalCdf(breakevenLow, forward, markIv, tYears)
      : null;

  const pnls = windows.ratios.map((ratio) => ironFlyPnl(netCredit, center, width, forward * ratio));
  const fit = ironFlyHistoryStats(pnls.slice(0, windows.holdoutFrom), windows.horizonHours);
  const holdout = ironFlyHistoryStats(pnls.slice(windows.holdoutFrom), windows.horizonHours);
  const all = ironFlyHistoryStats(pnls, windows.horizonHours);

  const minQuantity = Math.max(call.minQuantity, put.minQuantity, wingCall.minQuantity, wingPut.minQuantity);
  const quantityStep = Math.max(
    call.quantityStep,
    put.quantityStep,
    wingCall.quantityStep,
    wingPut.quantityStep,
  );
  const topOfBookQuantity = Math.min(call.size, put.size, wingCall.size, wingPut.size);
  const budgetUsd = (config.equity * config.riskPct) / 100;
  const riskBudgetQuantity = floorToStep(budgetUsd / maxLoss, quantityStep);
  const fitted = floorToStep(Math.min(riskBudgetQuantity, topOfBookQuantity), quantityStep);
  const suggestedQuantity = fitted >= minQuantity ? fitted : 0;
  const deltas = [call.delta, put.delta, wingCall.delta, wingPut.delta];
  const netDelta = deltas.every(finite)
    ? -(call.delta! + put.delta!) + wingCall.delta! + wingPut.delta!
    : null;

  const flags: AlphaIronFlyFlag[] = [];
  if (fit.n < MIN_FIT_WINDOWS) flags.push('thin_history');
  if (fit.meanPnl != null && fit.meanPnl <= 0) flags.push('fit_mean_negative');
  if (holdout.meanPnl != null && holdout.meanPnl <= 0) flags.push('holdout_mean_negative');
  if (fit.ciLow == null || fit.ciLow <= 0) flags.push('ci_includes_zero');
  if (independentWindowShare(windows.horizonHours) < 1) flags.push('overlapping_windows');
  if (suggestedQuantity === 0) flags.push('size_below_minimum');

  return {
    candidate: {
      venue: input.venue,
      underlying: input.underlying,
      expiry: input.expiry,
      expiryTs: input.expiryTs,
      dte: (input.expiryTs - nowMs) / DAY_MS,
      center,
      width,
      forwardPrice: forward,
      callInstrument: call.symbol,
      putInstrument: put.symbol,
      wingCallInstrument: wingCall.symbol,
      wingPutInstrument: wingPut.symbol,
      callBid: call.bid,
      putBid: put.bid,
      wingCallAsk: wingCall.ask,
      wingPutAsk: wingPut.ask,
      entryFees,
      grossCredit,
      netCredit,
      maxLoss,
      breakevenLow,
      breakevenHigh,
      profitZonePct: (netCredit / forward) * 100,
      combinedSpreadPct,
      markIv,
      impliedProfitRate,
      fit,
      holdout,
      all,
      fitEvPerMaxLoss: fit.meanPnl == null ? null : fit.meanPnl / maxLoss,
      netDelta,
      minQuantity,
      quantityStep,
      topOfBookQuantity,
      riskBudgetQuantity,
      suggestedQuantity,
      verdict: ironFlyVerdict(flags),
      flags,
      asOfMs: Math.min(call.asOfMs, put.asOfMs, wingCall.asOfMs, wingPut.asOfMs),
    },
    skipReason: null,
  };
}

const WATCH_FLAGS = new Set<AlphaIronFlyFlag>([
  'holdout_mean_negative',
  'ci_includes_zero',
  'overlapping_windows',
  'size_below_minimum',
]);

export function ironFlyVerdict(flags: readonly AlphaIronFlyFlag[]): AlphaIronFlyVerdict {
  if (flags.includes('thin_history')) return 'thin-history';
  if (flags.includes('fit_mean_negative')) return 'historically-negative';
  return flags.some((flag) => WATCH_FLAGS.has(flag)) ? 'watch' : 'historically-positive';
}

const VERDICT_ORDER: Record<AlphaIronFlyVerdict, number> = {
  'historically-positive': 0,
  watch: 1,
  'historically-negative': 2,
  'thin-history': 3,
};

function compareNullableDesc(a: number | null, b: number | null): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return b - a;
}

export function rankIronFlyCandidates(candidates: AlphaIronFlyCandidate[]): AlphaIronFlyCandidate[] {
  return candidates.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      compareNullableDesc(a.fitEvPerMaxLoss, b.fitEvPerMaxLoss) ||
      a.dte - b.dte ||
      a.width - b.width,
  );
}
