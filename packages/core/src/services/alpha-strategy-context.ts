import type {
  AlphaContextReason,
  AlphaContextStrategy,
  AlphaMarketContextQuery,
  AlphaStrategyContext,
} from '@oggregator/protocol';
import type { IvHistoryResponse } from '../core/enrichment.js';
import { realizedVol } from './realized-vol.js';
import type { SpotCandle } from './spot-candles.js';
import { forecastFromCloses, weekendAdjustedVol, weekendShare } from './vol-richness.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface AlphaStrategyContextInput extends Omit<AlphaMarketContextQuery, 'underlying'> {
  nowMs: number;
  candles: readonly SpotCandle[];
  hourlyCandles?: readonly SpotCandle[];
  ivHistory: IvHistoryResponse | null;
}

function closed(candles: readonly SpotCandle[], step: number, now: number) {
  const data = candles
    .filter(
      (c) =>
        c.timestamp > 0 && c.timestamp + step <= now && Number.isFinite(c.close) && c.close > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const last = data.at(-1);
  if (!last || now - last.timestamp - step > step * 1.5) return [];
  let start = data.length - 1;
  while (start > 0 && data[start]!.timestamp - data[start - 1]!.timestamp === step) start -= 1;
  return data.slice(start);
}

function quantile(values: readonly number[], percentile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = percentile * (sorted.length - 1);
  const low = Math.floor(at);
  return sorted[low]! + (sorted[Math.ceil(at)]! - sorted[low]!) * (at - low);
}

function directionOf(
  data: readonly SpotCandle[],
  hourly: boolean,
): Pick<AlphaStrategyContext, 'direction' | 'directionBasis' | 'moves'> {
  const windows = hourly ? [6, 24, 168] : [1, 7, 30];
  const annualization = hourly ? 365 * 24 : 365;
  const reference = hourly ? 168 : 30;
  if (data.length <= reference)
    return { direction: 'unavailable', directionBasis: 'unavailable', moves: [] };
  const vol = realizedVol(
    data.slice(-(reference + 1)).map((c) => c.close),
    annualization,
  );
  if (vol == null || vol <= 0)
    return { direction: 'unavailable', directionBasis: 'unavailable', moves: [] };
  const moves = windows.map((window) => {
    const change = Math.log(data.at(-1)!.close / data.at(-(window + 1))!.close);
    return {
      hours: hourly ? window : window * 24,
      returnPct: Math.expm1(change) * 100,
      sigmaUnits: change / (vol * Math.sqrt(window / annualization)),
    };
  });
  const up = moves.filter((m) => m.sigmaUnits >= 1).length;
  const down = moves.filter((m) => m.sigmaUnits <= -1).length;
  return {
    direction: up > 0 && down > 0 ? 'transition' : up >= 2 ? 'up' : down >= 2 ? 'down' : 'range',
    directionBasis: hourly ? 'hourly' : 'daily',
    moves,
  };
}

function deliveryRange(data: readonly SpotCandle[], days: number, currentForecast: number | null) {
  const window = Math.max(1, Math.ceil(days));
  if (days < 1 || days > 90 || currentForecast == null)
    return { low: null, high: null, count: 0, window };
  const closes = data.map((c) => c.close);
  const ratios: number[] = [];
  // Origins do not overlap in their outcome windows; every forecast uses only its preceding closes.
  for (let origin = 180; origin + window < closes.length; origin += window) {
    const from = data[origin]!.timestamp + DAY;
    const prediction = forecastFromCloses(closes.slice(0, origin + 1), window);
    const delivered = realizedVol(closes.slice(origin, origin + window + 1), 365);
    const forecast =
      prediction == null
        ? null
        : weekendAdjustedVol(prediction, weekendShare(from, from + window * DAY));
    if (forecast != null && forecast > 0 && delivered != null) ratios.push(delivered / forecast);
  }
  const low = ratios.length >= 8 ? quantile(ratios, 0.2) : null;
  const high = ratios.length >= 8 ? quantile(ratios, 0.8) : null;
  return {
    low: low == null ? null : currentForecast * low,
    high: high == null ? null : currentForecast * high,
    count: ratios.length,
    window,
  };
}

export function buildAlphaStrategyContext(input: AlphaStrategyContextInput): AlphaStrategyContext {
  const { nowMs: now } = input;
  const days = input.expiryTs == null ? (input.horizonDays ?? 7) : (input.expiryTs - now) / DAY;
  const daily = closed(input.candles, DAY, now);
  const hourly = closed(input.hourlyCandles ?? [], HOUR, now);
  const direction = directionOf(
    days <= 7 && hourly.length >= 169 ? hourly : daily,
    days <= 7 && hourly.length >= 169,
  );
  const closes = daily.map((c) => c.close);
  const rv = (n: number, end = closes.length) =>
    end > n ? realizedVol(closes.slice(end - n - 1, end), 365) : null;
  const rv7d = rv(7);
  const rv30d = rv(30);
  const ratio = rv7d != null && rv30d != null && rv30d > 0 ? rv7d / rv30d : null;
  const ratios: number[] = [];
  for (let end = 31; end < closes.length; end += 1) {
    const fast = rv(7, end),
      slow = rv(30, end);
    if (fast != null && slow != null && slow > 0) ratios.push(fast / slow);
  }
  const rank =
    ratio == null || ratios.length < 30
      ? null
      : (ratios.filter((r) => r <= ratio).length / ratios.length) * 100;
  const accelerating = ratio != null && ratio > 1 && rank != null && rank >= 90;
  const supportedHorizon = days > 0 && days <= 90;
  const forecast = supportedHorizon ? forecastFromCloses(closes, days) : null;
  const forecastVol =
    forecast == null ? null : weekendAdjustedVol(forecast, weekendShare(now, now + days * DAY));
  const delivery = deliveryRange(daily, days, forecastVol);
  function live(tenor: '7d' | '30d') {
    const point = input.ivHistory?.tenors[tenor].current;
    return point && point.ts <= now && now - point.ts <= 300_000 ? point.atmIv : null;
  }
  const iv7 = live('7d'),
    iv30 = live('30d');
  let atmIv: number | null = null;
  let source: AlphaStrategyContext['pricing']['source'] = 'unavailable';
  if (input.expiryTs != null) {
    if (
      input.selectedIv != null &&
      input.ivAsOfMs != null &&
      input.ivAsOfMs <= now &&
      now - input.ivAsOfMs <= 120_000
    ) {
      atmIv = input.selectedIv;
      source = 'selected-chain';
    }
  } else if (days === 7 && iv7 != null) {
    atmIv = iv7;
    source = '7d';
  } else if (days === 30 && iv30 != null) {
    atmIv = iv30;
    source = '30d';
  } else if (days >= 7 && days <= 30 && iv7 != null && iv30 != null) {
    const weight = (days - 7) / 23;
    atmIv = Math.sqrt((iv7 ** 2 * 7 * (1 - weight) + iv30 ** 2 * 30 * weight) / days);
    source = 'interpolated';
  }
  const cheap = atmIv != null && delivery.low != null && atmIv < delivery.low;
  const expensive = atmIv != null && delivery.high != null && atmIv > delivery.high;
  const priced = atmIv != null && delivery.low != null && delivery.high != null;
  const tenor = days <= 14 ? '7d' : '30d';
  const point = input.ivHistory?.tenors[tenor].current;
  const freshPoint = point && point.ts <= now && now - point.ts <= 300_000 ? point : null;
  const rr =
    source === 'selected-chain'
      ? input.selectedSkew
      : source === 'interpolated'
        ? null
        : freshPoint?.rr25d;
  const fly =
    source === 'selected-chain'
      ? input.selectedBfly
      : source === 'interpolated'
        ? null
        : freshPoint?.bfly25d;
  const callIv = atmIv != null && rr != null && fly != null ? atmIv + fly + rr / 2 : null;
  const putIv = atmIv != null && rr != null && fly != null ? atmIv + fly - rr / 2 : null;
  const call25Iv = callIv != null && callIv > 0 ? callIv : null;
  const put25Iv = putIv != null && putIv > 0 ? putIv : null;
  const backwardation = iv7 != null && iv30 != null ? iv7 - iv30 > 0.02 : null;

  function assess(
    strategy: AlphaContextStrategy,
  ): AlphaStrategyContext['assessments'][AlphaContextStrategy] {
    const reasons: AlphaContextReason[] = [];
    if (!supportedHorizon) return { verdict: 'unavailable', reasons: ['horizon-unsupported'] };
    if (direction.direction === 'unavailable' || forecastVol == null)
      return { verdict: 'unavailable', reasons: ['history-unavailable'] };
    const insurance = strategy === 'protective-put';
    const credit = strategy.endsWith('credit');
    const vertical = credit || strategy.endsWith('debit');
    const bullish =
      strategy === 'long-call' || strategy === 'call-debit' || strategy === 'put-credit';
    const wingIv = bullish ? call25Iv : put25Iv;
    const buyCost = wingIv ?? atmIv;
    const buyCheap = buyCost != null && delivery.low != null && buyCost < delivery.low;
    const buyExpensive = buyCost != null && delivery.high != null && buyCost > delivery.high;
    const trend = direction.direction === 'up' || direction.direction === 'down';
    const aligned = trend && (direction.direction === 'up') === bullish;
    if (insurance) reasons.push('insurance-purpose');
    else if (trend)
      reasons.push(
        aligned ? (direction.direction === 'up' ? 'price-up' : 'price-down') : 'direction-conflict',
      );
    else
      reasons.push(
        direction.direction === 'transition' ? 'reversal-risk' : 'direction-unconfirmed',
      );
    reasons.push(
      !priced
        ? 'pricing-unknown'
        : (vertical ? cheap : buyCheap)
          ? 'vol-below-range'
          : (vertical ? expensive : buyExpensive)
            ? 'vol-above-range'
            : 'vol-within-range',
    );
    if (!vertical) reasons.push(wingIv == null ? 'wing-pricing-unavailable' : 'wing-pricing');
    if (accelerating) reasons.push('vol-accelerating');
    if (backwardation) reasons.push('front-vol-stress');
    if (days < 1) reasons.push('near-expiry');
    if (vertical) reasons.push('vertical-price-check');
    if (credit && cheap) reasons.push('credit-premium-thin');
    if (credit && trend && !aligned)
      reasons.push(bullish ? 'downside-short-risk' : 'upside-short-risk');
    if (insurance && buyExpensive) reasons.push('insurance-expensive');
    const stressed = accelerating || backwardation === true || days < 1;
    let verdict: AlphaStrategyContext['assessments'][AlphaContextStrategy]['verdict'] =
      'conditional';
    if (insurance) {
      if (buyCheap && wingIv != null) verdict = 'supported';
    } else if (trend && !aligned) {
      verdict = 'poor-fit';
    } else if (!trend) {
      if (credit && direction.direction === 'range' && expensive && !stressed)
        verdict = 'supported';
    } else if (credit) {
      if (!stressed && !cheap && priced) verdict = 'supported';
    } else if (vertical) {
      if (atmIv != null && days >= 1) verdict = 'supported';
    } else if (buyCheap && wingIv != null && days >= 1) {
      verdict = 'supported';
    }
    return { verdict, reasons };
  }
  return {
    version: 'market-context-v2',
    horizonDays: days,
    horizonSource: input.expiryTs == null ? 'scan-reference' : 'selected-expiry',
    ...direction,
    pricing: {
      atmIv,
      call25Iv,
      put25Iv,
      source,
      forecastVol,
      deliveryLow: delivery.low,
      deliveryHigh: delivery.high,
      deliveryWindowDays: delivery.window,
      calibrationWindows: delivery.count,
    },
    stress: {
      rv7d,
      rv30d,
      accelerationRatio: ratio,
      accelerationPercentile: rank,
      accelerating,
      backwardation,
    },
    assessments: {
      'call-credit': assess('call-credit'),
      'put-credit': assess('put-credit'),
      'call-debit': assess('call-debit'),
      'put-debit': assess('put-debit'),
      'long-call': assess('long-call'),
      'long-put': assess('long-put'),
      'protective-put': assess('protective-put'),
    },
  };
}
