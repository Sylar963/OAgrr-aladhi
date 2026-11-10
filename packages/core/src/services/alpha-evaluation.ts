import type {
  AlphaEvaluationCandidate,
  AlphaEvaluationRequest,
  AlphaEvaluationResponse,
  AlphaExecutionIssue,
} from '@oggregator/protocol';
import type { IvHistoryResponse } from '../core/enrichment.js';
import { cdf, price76 } from '../feeds/thalex/bs-solver.js';
import type { RegimeQueryResult } from './regime.js';
import { realizedVol } from './realized-vol.js';
import type { SpotCandle } from './spot-candles.js';
import { buildVolForecastModel, type TenorIvSeries } from './vol-richness.js';

const DAY_MS = 86_400_000;
const MAX_HISTORY_AGE_MS = 36 * 3_600_000;
const MAX_CONTEXT_AGE_MS = 5 * 60_000;

export interface AlphaEvaluationMarket {
  candles: readonly SpotCandle[];
  ivHistory: IvHistoryResponse | null;
  baselineIv: TenorIvSeries;
  regime: RegimeQueryResult | null;
}

interface Segment {
  low: number;
  high: number;
  slope: number;
  intercept: number;
}

function intrinsic(candidate: AlphaEvaluationCandidate, price: number): number {
  return candidate.legs.reduce(
    (sum, leg) =>
      sum +
      (leg.side === 'buy' ? 1 : -1) *
        leg.quantity *
        Math.max(leg.right === 'call' ? price - leg.strike : leg.strike - price, 0),
    candidate.holdingQuantity * (price - candidate.spot),
  );
}

function payoffSegments(candidate: AlphaEvaluationCandidate, cash: number): Segment[] {
  const strikes = [...new Set(candidate.legs.map((leg) => leg.strike))].sort((a, b) => a - b);
  const bounds = [0, ...strikes, Infinity];
  return bounds.slice(0, -1).map((low, index) => {
    const high = bounds[index + 1]!;
    const point = Number.isFinite(high) ? (low + high) / 2 : low + candidate.spot;
    const slope = candidate.legs.reduce((sum, leg) => {
      const sign = leg.side === 'buy' ? 1 : -1;
      if (leg.right === 'call' && point > leg.strike) return sum + sign * leg.quantity;
      if (leg.right === 'put' && point < leg.strike) return sum - sign * leg.quantity;
      return sum;
    }, candidate.holdingQuantity);
    return { low, high, slope, intercept: cash + intrinsic(candidate, point) - slope * point };
  });
}

function scenarioAt(
  candidate: AlphaEvaluationCandidate,
  cash: number,
  meanReturnPct: number,
  annualVol: number,
  years: number,
) {
  const meanSpot = candidate.spot * (1 + meanReturnPct / 100);
  const variance = annualVol ** 2 * years;
  if (variance === 0) {
    const pnl = cash + intrinsic(candidate, meanSpot);
    return {
      meanSpot,
      expectedPnl: pnl,
      probabilityOfProfit: pnl > 0 ? 1 : 0,
      pnl05: pnl,
      expectedShortfall95: pnl,
    };
  }
  const deviation = Math.sqrt(variance);
  const mass = (price: number, moment: 0 | 1) =>
    price <= 0
      ? 0
      : price === Infinity
        ? 1
        : cdf((Math.log(price / meanSpot) + (moment === 0 ? 0.5 : -0.5) * variance) / deviation);
  const segments = payoffSegments(candidate, cash);
  function below(pnl: number, strict = false) {
    let probability = 0;
    let expectation = 0;
    for (const segment of segments) {
      let { low, high } = segment;
      const { slope, intercept } = segment;
      if (slope === 0) {
        if (strict ? intercept >= pnl : intercept > pnl) continue;
      } else if (slope > 0) high = Math.min(high, (pnl - intercept) / slope);
      else low = Math.max(low, (pnl - intercept) / slope);
      if (high <= low) continue;
      const p = mass(high, 0) - mass(low, 0);
      probability += p;
      expectation += slope * meanSpot * (mass(high, 1) - mass(low, 1)) + intercept * p;
    }
    return { probability: Math.max(0, Math.min(1, probability)), expectation };
  }
  const knots = [0, ...candidate.legs.map((leg) => leg.strike)];
  let low = Math.min(...knots.map((price) => cash + intrinsic(candidate, price)));
  let high = Math.max(low + 1, cash + intrinsic(candidate, meanSpot));
  for (let i = 0; below(high).probability < 0.05 && i < 100; i += 1)
    high += Math.max(1, Math.abs(high));
  for (let i = 0; i < 100; i += 1) {
    const middle = (low + high) / 2;
    if (below(middle).probability >= 0.05) high = middle;
    else low = middle;
  }
  const atom = segments.find(
    (segment) =>
      segment.slope === 0 &&
      below(segment.intercept, true).probability <= 0.05 &&
      below(segment.intercept).probability >= 0.05,
  );
  const pnl05 = atom?.intercept ?? high;
  const tail = below(pnl05, true);
  // Flat payoff regions have probability mass; include only the needed fraction at the quantile.
  const expectedShortfall95 =
    (tail.expectation + Math.max(0, 0.05 - tail.probability) * pnl05) / 0.05;
  const expectedPnl = candidate.legs.reduce(
    (sum, leg) =>
      sum +
      (leg.side === 'buy' ? 1 : -1) *
        leg.quantity *
        price76(meanSpot, leg.strike, annualVol, years, leg.right),
    cash + candidate.holdingQuantity * (meanSpot - candidate.spot),
  );
  return {
    meanSpot,
    expectedPnl,
    probabilityOfProfit: 1 - below(0).probability,
    pnl05,
    expectedShortfall95,
  };
}

function completedHistory(candles: readonly SpotCandle[], now: number) {
  return candles
    .filter(
      (candle) =>
        Number.isFinite(candle.timestamp) &&
        candle.timestamp > 0 &&
        candle.timestamp + DAY_MS <= now &&
        Number.isFinite(candle.close) &&
        candle.close > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function validWindow(candles: readonly SpotCandle[], count: number, now: number) {
  const window = candles.slice(-count);
  const through = window.at(-1);
  return (
    window.length === count &&
    through != null &&
    now - (through.timestamp + DAY_MS) <= MAX_HISTORY_AGE_MS &&
    window.every(
      (point, index) => index === 0 || point.timestamp - window[index - 1]!.timestamp === DAY_MS,
    )
  );
}

export function evaluateAlphaTrade(
  request: AlphaEvaluationRequest,
  market: AlphaEvaluationMarket,
  options: { nowMs: number; id: string },
): AlphaEvaluationResponse {
  const { candidate, scenario } = request;
  const now = options.nowMs;
  const days = (candidate.expiryTs - now) / DAY_MS;
  const direction =
    candidate.strategy === 'protective-put'
      ? 'insurance'
      : ['call-debit', 'put-credit', 'long-call'].includes(candidate.strategy)
        ? 'bullish'
        : 'bearish';
  const alignment =
    direction === 'insurance'
      ? 'insurance'
      : scenario == null
        ? 'not-specified'
        : scenario.meanReturnPct === 0
          ? 'flat-thesis'
          : scenario.meanReturnPct > 0 === (direction === 'bullish')
            ? 'aligned'
            : 'conflicts';
  const closed = completedHistory(market.candles, now);
  const forecastWindow = closed.slice(-181);
  const supported = days > 0 && days <= 90;
  const forecastReady =
    supported &&
    forecastWindow.length >= 31 &&
    validWindow(forecastWindow, forecastWindow.length, now);
  const model = forecastReady ? buildVolForecastModel(forecastWindow, market.baselineIv) : null;
  const forecastVol = model?.forecastVolUntil(now, candidate.expiryTs) ?? null;
  // Baseline needs the full completed history; forecast estimation itself remains capped at 180 days.
  const baseline =
    forecastReady && validWindow(closed, closed.length, now)
      ? buildVolForecastModel(closed, market.baselineIv).premiumBaseline(days)
      : null;
  const usualPremium = baseline?.medianSpread ?? null;
  const ivMinusForecast =
    candidate.atmIv != null && forecastVol != null ? candidate.atmIv - forecastVol : null;
  const rv = (length: number) =>
    validWindow(closed, length + 1, now)
      ? realizedVol(
          closed.slice(-(length + 1)).map((candle) => candle.close),
          365,
        )
      : null;
  const rv7d = rv(7);
  const rv30d = rv(30);
  const pastReturn = (length: number) =>
    validWindow(closed, length + 1, now)
      ? (closed.at(-1)!.close / closed.at(-(length + 1))!.close - 1) * 100
      : null;
  const liveIv = market.ivHistory;
  const currentIv = (tenor: '7d' | '30d') => {
    const point = liveIv?.tenors[tenor].current;
    return point && point.ts <= now && now - point.ts <= MAX_CONTEXT_AGE_MS ? point : null;
  };
  const iv7 = currentIv('7d');
  const iv30 = currentIv('30d');
  const regime = market.regime;
  const freshRegime =
    regime != null && regime.ts > 0 && regime.ts <= now && now - regime.ts <= MAX_CONTEXT_AGE_MS
      ? regime
      : null;

  const issues: AlphaExecutionIssue[] = [];
  if (days <= 0) issues.push('expired');
  const maxAge = candidate.legs.length === 2 ? 15_000 : 30_000;
  for (const leg of candidate.legs) {
    if (leg.quoteMode === 'delayed') issues.push('delayed-feed');
    if (leg.quoteMode === 'unknown') issues.push('unknown-feed');
    if (leg.quotedAt == null) issues.push('missing-quote-time');
    else if (leg.quotedAt > now + 1_000) issues.push('future-quote');
    else if (now - leg.quotedAt > maxAge) issues.push('stale-quote');
    if (leg.availableQuantity == null) issues.push('missing-size');
    else if (leg.availableQuantity < leg.quantity - 1e-9) issues.push('insufficient-size');
    if (leg.minQuantity == null || leg.quantityStep == null) issues.push('missing-quantity-rules');
    else if (
      leg.quantity < leg.minQuantity - 1e-9 ||
      Math.abs(leg.quantity / leg.quantityStep - Math.round(leg.quantity / leg.quantityStep)) > 1e-7
    )
      issues.push('invalid-quantity');
  }
  const times = candidate.legs.flatMap((leg) => (leg.quotedAt == null ? [] : [leg.quotedAt]));
  if (times.length > 1 && Math.max(...times) - Math.min(...times) > 2_000)
    issues.push('unsynchronized-legs');
  if (candidate.entryFee == null || candidate.legs.some((leg) => leg.fee == null))
    issues.push('missing-fees');
  if (candidate.costReserve == null) issues.push('missing-cost-reserve');
  const inverse = candidate.legs.some((leg) => leg.inverse);
  if (inverse) issues.push('inverse-settlement');
  if (new Set(candidate.legs.map((leg) => leg.venue)).size > 1) issues.push('cross-venue');
  if (new Set(candidate.legs.map((leg) => leg.settlement)).size > 1)
    issues.push('mixed-settlement');
  const grossEntryCash = candidate.legs.reduce(
    (sum, leg) => sum + (leg.side === 'sell' ? 1 : -1) * leg.quantity * leg.price,
    0,
  );
  const costsKnown =
    candidate.entryFee != null && candidate.costReserve != null && !issues.includes('missing-fees');
  const netEntryCash =
    costsKnown && !inverse ? grossEntryCash - candidate.entryFee! - candidate.costReserve! : null;
  const knots = [0, ...candidate.legs.map((leg) => leg.strike)];
  const maxExpiryLoss =
    netEntryCash == null
      ? null
      : Math.max(0, -Math.min(...knots.map((price) => netEntryCash + intrinsic(candidate, price))));
  if (candidate.lossBudget == null) issues.push('missing-budget');
  else if (maxExpiryLoss != null && maxExpiryLoss > candidate.lossBudget + 1e-8)
    issues.push('over-budget');
  const blocking = new Set<AlphaExecutionIssue>([
    'expired',
    'future-quote',
    'stale-quote',
    'unsynchronized-legs',
    'insufficient-size',
    'invalid-quantity',
    'delayed-feed',
    'inverse-settlement',
    'over-budget',
  ]);
  const base =
    scenario != null && netEntryCash != null && days > 0
      ? scenarioAt(candidate, netEntryCash, scenario.meanReturnPct, scenario.annualVol, days / 365)
      : null;
  const protectedLeg = candidate.strategy === 'protective-put' ? candidate.legs[0]! : null;
  return {
    id: options.id,
    version: 'alpha-evaluation-v1',
    evaluatedAt: now,
    request,
    direction,
    alignment,
    pricing: {
      horizonDays: days,
      forecastVol,
      forecastMethod: 'mean-reverting-realized-v1',
      forecastSupported: supported,
      atmIv: candidate.atmIv,
      ivMinusForecast,
      usualPremium,
      excessPremium:
        ivMinusForecast != null && usualPremium != null ? ivMinusForecast - usualPremium : null,
      baselineTenorDays: baseline == null ? null : days <= 14 ? 7 : 30,
      baselineSource: baseline?.source ?? null,
      baselineIndependentSamples: baseline?.independentSampleCount ?? 0,
      historyThrough: closed.at(-1) == null ? null : closed.at(-1)!.timestamp + DAY_MS,
    },
    stress: {
      rv7d,
      rv30d,
      accelerationRatio: rv7d != null && rv30d != null && rv30d > 0 ? rv7d / rv30d : null,
      return1dPct: pastReturn(1),
      return7dPct: pastReturn(7),
      return30dPct: pastReturn(30),
      termSlope: iv7?.atmIv != null && iv30?.atmIv != null ? iv30.atmIv - iv7.atmIv : null,
      skew25d: iv30?.rr25d ?? null,
      regime:
        freshRegime == null
          ? null
          : {
              volatility: freshRegime.dominant,
              skewSentiment: freshRegime.direction,
              clusterConfidence: freshRegime.confidence,
              observedAt: freshRegime.ts,
            },
    },
    execution: {
      status: issues.some((issue) => blocking.has(issue))
        ? 'blocked'
        : issues.length > 0
          ? 'incomplete'
          : 'checks-pass',
      issues: [...new Set(issues)],
      quoteSource: 'client-snapshot',
    },
    payoff: {
      grossEntryCash,
      netEntryCash,
      maxExpiryLoss,
      budgetUsePct:
        candidate.lossBudget != null && maxExpiryLoss != null
          ? (maxExpiryLoss / candidate.lossBudget) * 100
          : null,
      stressPoints:
        netEntryCash == null
          ? []
          : [-50, -30, -10, 0, 10, 30, 50].map((movePct) => {
              const spot = candidate.spot * (1 + movePct / 100);
              return { movePct, spot, pnl: netEntryCash + intrinsic(candidate, spot) };
            }),
      protection:
        protectedLeg == null
          ? null
          : {
              coveredQuantity: protectedLeg.quantity,
              coverageRatio: protectedLeg.quantity / candidate.holdingQuantity,
              premiumCost: netEntryCash == null ? null : -netEntryCash,
              unhedgedLossAtZero: candidate.holdingQuantity * candidate.spot,
              hedgedLossAtZero:
                netEntryCash == null ? null : -(netEntryCash + intrinsic(candidate, 0)),
            },
    },
    scenario:
      base == null || scenario == null || netEntryCash == null
        ? null
        : {
            ...base,
            lowerMeanExpectedPnl: scenarioAt(
              candidate,
              netEntryCash,
              scenario.meanReturnPct - scenario.meanUncertaintyPct,
              scenario.annualVol,
              days / 365,
            ).expectedPnl,
            upperMeanExpectedPnl: scenarioAt(
              candidate,
              netEntryCash,
              scenario.meanReturnPct + scenario.meanUncertaintyPct,
              scenario.annualVol,
              days / 365,
            ).expectedPnl,
          },
    evidence: 'unvalidated',
  };
}
