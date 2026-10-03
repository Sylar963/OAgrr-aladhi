import type { IvHistoryPoint } from '../core/enrichment.js';
import { realizedVol } from './realized-vol.js';
import type { SpotCandle } from './spot-candles.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DAYS_IN_YEAR = 365;
// Engineering assumption, not fitted to BTC: how fast recent realized vol decays toward
// the long-run level in the forecast. Bennett's ~8-month figure is SX5E-specific.
const FORECAST_HALF_LIFE_DAYS = 14;
const LONG_RUN_MAX_DAYS = 180;
const MIN_FORECAST_CLOSES = 31;
const MIN_CONE_WINDOWS = 20;
const MIN_INDEPENDENT_BASELINE_WINDOWS = 4;
// Deribit daily candles close at 08:00 UTC while the DVOL-seeded IV history is daily at 00:00.
const IV_SAMPLE_TOLERANCE_MS = 12 * HOUR_MS;
const MIN_EXCESS_HISTORY_POINTS = 20;
const MIN_INTRADAY_SAMPLES = 12;
const IV_24H_TOLERANCE_MS = HOUR_MS;
// Our choice, untested on BTC: excess premium within ±2 vol points reads as fair.
export const EXCESS_PREMIUM_FAIR_BAND = 0.02;
const TERM_FLAT_BAND = 0.02;
const FORECAST_CURVE_MAX_DTE = 90;
// Pooled 2021–26 BTC-PERPETUAL hourly variance, Sat–Sun vs Mon–Fri UTC (yearly 0.35–0.67).
// Venues quote weekends at reduced variance, so a calendar-time forecast makes weekend-heavy
// short expiries look cheap. Our measurement, not a sourced rule.
export const WEEKEND_VARIANCE_WEIGHT = 0.52;
const AVERAGE_WEEK_WEIGHT = 5 / 7 + (2 / 7) * WEEKEND_VARIANCE_WEIGHT;

export type RichnessTenor = '7d' | '30d';
export type PremiumBaselineSource = 'venue' | 'blended';

export interface TenorIvSeries {
  '7d': readonly IvHistoryPoint[];
  '30d': readonly IvHistoryPoint[];
}

export interface VolForecastSummary {
  method: 'mean-reverting-realized-v1';
  rv7d: number | null;
  rv30d: number | null;
  longRunVol: number | null;
  longRunDays: number;
  halfLifeDays: number;
}

export interface PremiumBaseline {
  tenorDays: number;
  source: PremiumBaselineSource;
  medianSpread: number | null;
  sampleCount: number;
  independentSampleCount: number;
}

export interface VolForecastModel {
  forecast: VolForecastSummary;
  /** Calendar-time forecast: every day weighs the same. */
  forecastVol(dteDays: number): number | null;
  /** Forecast over [nowMs, expiryTs) with weekend days weighted at reduced variance. */
  forecastVolUntil(nowMs: number, expiryTs: number): number | null;
  realizedMatched(dteDays: number): number | null;
  conePercentile(vol: number, dteDays: number): number | null;
  premiumBaseline(dteDays: number): PremiumBaseline;
}

/** Fraction of [fromMs, toMs) that falls on Saturday or Sunday UTC. */
export function weekendShare(fromMs: number, toMs: number): number {
  if (!(toMs > fromMs)) return 0;
  let weekend = 0;
  for (let dayStart = Math.floor(fromMs / DAY_MS) * DAY_MS; dayStart < toMs; dayStart += DAY_MS) {
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday !== 0 && weekday !== 6) continue;
    weekend += Math.max(0, Math.min(toMs, dayStart + DAY_MS) - Math.max(fromMs, dayStart));
  }
  return weekend / (toMs - fromMs);
}

/** Rescales a calendar-time vol so a whole week keeps its variance and weekends weigh less. */
export function weekendAdjustedVol(vol: number, share: number): number {
  return vol * Math.sqrt((1 - share + share * WEEKEND_VARIANCE_WEIGHT) / AVERAGE_WEEK_WEIGHT);
}

function windowDays(dteDays: number, available: number): number {
  return Math.min(Math.max(Math.round(dteDays), 3), available);
}

function nearestIv(
  series: readonly IvHistoryPoint[],
  ts: number,
  toleranceMs: number = IV_SAMPLE_TOLERANCE_MS,
): number | null {
  if (series.length === 0) return null;
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid]!.ts < ts) low = mid + 1;
    else high = mid;
  }
  let best: IvHistoryPoint | null = null;
  for (const index of [low - 1, low]) {
    const point = series[index];
    if (point?.atmIv == null) continue;
    if (best == null || Math.abs(point.ts - ts) < Math.abs(best.ts - ts)) best = point;
  }
  return best != null && Math.abs(best.ts - ts) <= toleranceMs ? best.atmIv : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function meanAndSd(values: readonly number[]): { mean: number; sd: number } | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

function zScore(current: number, values: readonly number[]): number | null {
  const stats = meanAndSd(values);
  if (stats == null || !(stats.sd > 0)) return null;
  return (current - stats.mean) / stats.sd;
}

function percentileOf(current: number, values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return (values.filter((value) => value <= current).length / values.length) * 100;
}

/**
 * Matched-horizon realized-vol forecast from daily closes (Sinclair pp. 32–33): recent 7D
 * realized variance decays toward the long-run level, averaged over the option's life.
 */
export function forecastFromCloses(closes: readonly number[], dteDays: number): number | null {
  if (closes.length < MIN_FORECAST_CLOSES) return null;
  const rv7d = realizedVol(closes.slice(-8), DAYS_IN_YEAR);
  const longRunDays = Math.min(closes.length - 1, LONG_RUN_MAX_DAYS);
  const longRunVol = realizedVol(closes.slice(-(longRunDays + 1)), DAYS_IN_YEAR);
  if (rv7d == null || longRunVol == null) return null;
  const kappa = Math.LN2 / FORECAST_HALF_LIFE_DAYS;
  const tau = Math.max(dteDays, 1 / 24);
  const weight = (1 - Math.exp(-kappa * tau)) / (kappa * tau);
  const variance = longRunVol ** 2 + (rv7d ** 2 - longRunVol ** 2) * weight;
  return Math.sqrt(Math.max(variance, 0));
}

/** The 7D baseline serves expiries up to 14 days; longer expiries use the 30D baseline. */
export function baselineTenorDays(dteDays: number): 7 | 30 {
  return dteDays <= 14 ? 7 : 30;
}

/**
 * Forecast, vol cone, and implied-minus-subsequent-realized baseline (Sinclair pp. 32–43).
 * Shared by the short-straddle scanner and the richness reading so both judge IV the same way.
 */
export function buildVolForecastModel(
  candles: readonly SpotCandle[],
  ivSeries: TenorIvSeries,
  baselineSource: PremiumBaselineSource = 'blended',
): VolForecastModel {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const closes = sorted.map((candle) => candle.close);
  const available = closes.length - 1;
  const rv = (days: number) =>
    closes.length > days ? realizedVol(closes.slice(-(days + 1)), DAYS_IN_YEAR) : null;
  const rv7d = rv(7);
  const rv30d = rv(30);
  const longRunDays = Math.min(available, LONG_RUN_MAX_DAYS);
  const longRunVol = closes.length >= MIN_FORECAST_CLOSES ? rv(longRunDays) : null;
  const coneCache = new Map<number, number[]>();
  const baselineCache = new Map<number, PremiumBaseline>();

  function cone(days: number): number[] {
    const cached = coneCache.get(days);
    if (cached) return cached;
    const values: number[] = [];
    for (let end = days + 1; end <= closes.length; end += 1) {
      const vol = realizedVol(closes.slice(end - days - 1, end), DAYS_IN_YEAR);
      if (vol != null) values.push(vol);
    }
    coneCache.set(days, values);
    return values;
  }

  return {
    forecast: {
      method: 'mean-reverting-realized-v1',
      rv7d,
      rv30d,
      longRunVol,
      longRunDays: longRunVol == null ? 0 : longRunDays,
      halfLifeDays: FORECAST_HALF_LIFE_DAYS,
    },
    forecastVol(dteDays) {
      if (rv7d == null) return null;
      return forecastFromCloses(closes, dteDays);
    },
    forecastVolUntil(nowMs, expiryTs) {
      if (rv7d == null) return null;
      const calendar = forecastFromCloses(closes, (expiryTs - nowMs) / DAY_MS);
      return calendar == null ? null : weekendAdjustedVol(calendar, weekendShare(nowMs, expiryTs));
    },
    realizedMatched(dteDays) {
      if (available < 3) return null;
      return rv(windowDays(dteDays, available));
    },
    conePercentile(vol, dteDays) {
      if (available < 3) return null;
      const values = cone(windowDays(dteDays, available));
      if (values.length < MIN_CONE_WINDOWS) return null;
      return percentileOf(vol, values);
    },
    premiumBaseline(dteDays) {
      const tenorDays = baselineTenorDays(dteDays);
      const cached = baselineCache.get(tenorDays);
      if (cached) return cached;
      const series = tenorDays === 7 ? ivSeries['7d'] : ivSeries['30d'];
      const spreads: number[] = [];
      for (let index = 0; index + tenorDays < sorted.length; index += 1) {
        const iv = nearestIv(series, sorted[index]!.timestamp + DAY_MS);
        if (iv == null) continue;
        const subsequent = realizedVol(closes.slice(index, index + tenorDays + 1), DAYS_IN_YEAR);
        if (subsequent != null) spreads.push(iv - subsequent);
      }
      const independentSampleCount = Math.ceil(spreads.length / tenorDays);
      const baseline: PremiumBaseline = {
        tenorDays,
        source: baselineSource,
        medianSpread:
          independentSampleCount >= MIN_INDEPENDENT_BASELINE_WINDOWS ? median(spreads) : null,
        sampleCount: spreads.length,
        independentSampleCount,
      };
      baselineCache.set(tenorDays, baseline);
      return baseline;
    },
  };
}

/** Prefers the venue's own premium baseline and falls back to the cross-venue one. */
export function withVenueBaseline(
  blended: VolForecastModel,
  venue: VolForecastModel | null,
): VolForecastModel {
  if (venue == null) return blended;
  return {
    ...blended,
    premiumBaseline(dteDays) {
      const own = venue.premiumBaseline(dteDays);
      return own.medianSpread != null ? own : blended.premiumBaseline(dteDays);
    },
  };
}

// ── Richness reading ──────────────────────────────────────────────

export type RichnessState = 'cheap' | 'fair' | 'rich' | 'unavailable';
export type TermStructureState = 'contango' | 'flat' | 'backwardation' | 'unknown';

export interface ExcessPremiumHistory {
  zScore: number | null;
  percentile: number | null;
  sampleCount: number;
  firstTs: number | null;
}

export interface IntradayIvMove {
  ivChange24h: number | null;
  zScore24h: number | null;
  zScore7d: number | null;
  samples24h: number;
  samples7d: number;
}

export interface TenorRichness {
  tenorDays: 7 | 30;
  atmIv: number | null;
  forecastVol: number | null;
  ivMinusForecast: number | null;
  premiumBaseline: PremiumBaseline;
  excessPremium: number | null;
  excessChange24h: number | null;
  excessHistory: ExcessPremiumHistory;
  conePercentile: number | null;
  intraday: IntradayIvMove;
  level: { percentile90d: number | null; percentile1y: number | null };
  state: RichnessState;
}

export interface ForecastCurvePoint {
  dteDays: number;
  forecastVol: number | null;
  usualPremium: number | null;
}

export interface VolRichness {
  generatedAt: number;
  underlying: string;
  forecast: VolForecastSummary;
  tenors: Record<RichnessTenor, TenorRichness>;
  termStructure: { state: TermStructureState; slope: number | null };
  forecastCurve: ForecastCurvePoint[];
  fairBand: number;
}

export interface VolRichnessInput {
  underlying: string;
  nowMs: number;
  /** Daily spot candles, ascending or not; the last one may be the in-progress day. */
  dailyCandles: readonly SpotCandle[];
  /** Recent constant-maturity ATM IV at live-sampling cadence (5 min). */
  recentIv: TenorIvSeries;
  /** Longest available ATM IV history (hourly store merged with recent) for baselines. */
  baselineIv: TenorIvSeries;
  /** Percentile of current IV inside the 90-day in-memory window. */
  percentile90d: Partial<Record<RichnessTenor, number | null>>;
  /** 52-week Deribit DVOL percentile; a 30D measure, so attached to the 30D tenor only. */
  dvolPercentile1y: number | null;
}

export function termStructure(
  atmIv7d: number | null,
  atmIv30d: number | null,
): VolRichness['termStructure'] {
  if (atmIv7d == null || atmIv30d == null) return { state: 'unknown', slope: null };
  const slope = atmIv30d - atmIv7d;
  const state =
    slope > TERM_FLAT_BAND ? 'contango' : slope < -TERM_FLAT_BAND ? 'backwardation' : 'flat';
  return { state, slope };
}

export function richnessState(excessPremium: number | null): RichnessState {
  if (excessPremium == null) return 'unavailable';
  if (excessPremium <= -EXCESS_PREMIUM_FAIR_BAND) return 'cheap';
  if (excessPremium >= EXCESS_PREMIUM_FAIR_BAND) return 'rich';
  return 'fair';
}

function intradayMove(series: readonly IvHistoryPoint[], nowMs: number): IntradayIvMove {
  const current = series.at(-1)?.atmIv ?? null;
  const since = (ms: number) =>
    series
      .filter((point) => point.ts >= nowMs - ms && point.atmIv != null)
      .map((point) => point.atmIv!);
  const day = since(DAY_MS);
  const week = since(7 * DAY_MS);
  const prior = nearestIv(series, nowMs - DAY_MS, IV_24H_TOLERANCE_MS);
  return {
    ivChange24h: current != null && prior != null ? current - prior : null,
    zScore24h: current != null && day.length >= MIN_INTRADAY_SAMPLES ? zScore(current, day) : null,
    zScore7d:
      current != null && week.length >= MIN_INTRADAY_SAMPLES ? zScore(current, week) : null,
    samples24h: day.length,
    samples7d: week.length,
  };
}

/**
 * Daily ex-ante IV − forecast spreads: each uses only candles closed by then and the IV
 * nearest that close. Consecutive points overlap heavily, so the z-score is descriptive.
 */
function ivMinusForecastHistory(
  sorted: readonly SpotCandle[],
  ivSeries: readonly IvHistoryPoint[],
  tenorDays: number,
  nowMs: number,
): Array<{ ts: number; spread: number }> {
  const closes = sorted.map((candle) => candle.close);
  const out: Array<{ ts: number; spread: number }> = [];
  for (let index = MIN_FORECAST_CLOSES - 1; index < sorted.length; index += 1) {
    const closeTs = sorted[index]!.timestamp + DAY_MS;
    if (closeTs > nowMs) break;
    const iv = nearestIv(ivSeries, closeTs);
    const forecast = forecastFromCloses(closes.slice(0, index + 1), tenorDays);
    if (iv != null && forecast != null) out.push({ ts: closeTs, spread: iv - forecast });
  }
  return out;
}

function tenorRichness(
  tenor: RichnessTenor,
  input: VolRichnessInput,
  sorted: readonly SpotCandle[],
  model: VolForecastModel,
): TenorRichness {
  const tenorDays = tenor === '7d' ? 7 : 30;
  const recent = input.recentIv[tenor];
  const atmIv = recent.at(-1)?.atmIv ?? null;
  const forecastVol = model.forecastVol(tenorDays);
  const premiumBaseline = model.premiumBaseline(tenorDays);
  const usual = premiumBaseline.medianSpread;
  const ivMinusForecast = atmIv != null && forecastVol != null ? atmIv - forecastVol : null;
  const excessPremium = ivMinusForecast != null && usual != null ? ivMinusForecast - usual : null;

  const priorCloses = sorted
    .filter((candle) => candle.timestamp <= input.nowMs - DAY_MS)
    .map((candle) => candle.close);
  const priorForecast = forecastFromCloses(priorCloses, tenorDays);
  const priorIv = nearestIv(recent, input.nowMs - DAY_MS, IV_24H_TOLERANCE_MS);
  const excessChange24h =
    excessPremium != null && priorForecast != null && priorIv != null && usual != null
      ? excessPremium - (priorIv - priorForecast - usual)
      : null;

  const history = ivMinusForecastHistory(sorted, input.baselineIv[tenor], tenorDays, input.nowMs);
  const spreads = history.map((point) => point.spread);
  const enoughHistory = ivMinusForecast != null && spreads.length >= MIN_EXCESS_HISTORY_POINTS;

  return {
    tenorDays,
    atmIv,
    forecastVol,
    ivMinusForecast,
    premiumBaseline,
    excessPremium,
    excessChange24h,
    // The baseline is a constant, so z and percentile of IV − forecast equal those of the excess.
    excessHistory: {
      zScore: enoughHistory ? zScore(ivMinusForecast, spreads) : null,
      percentile: enoughHistory ? percentileOf(ivMinusForecast, spreads) : null,
      sampleCount: spreads.length,
      firstTs: history[0]?.ts ?? null,
    },
    conePercentile: atmIv == null ? null : model.conePercentile(atmIv, tenorDays),
    intraday: intradayMove(recent, input.nowMs),
    level: {
      percentile90d: input.percentile90d[tenor] ?? null,
      percentile1y: tenor === '30d' ? input.dvolPercentile1y : null,
    },
    state: richnessState(excessPremium),
  };
}

/**
 * Is IV cheap or expensive against what BTC is likely to realize? Excess premium is
 * IV − matched-horizon forecast − usual implied-minus-subsequent-realized spread (K12–K14).
 */
export function buildVolRichness(input: VolRichnessInput): VolRichness {
  const sorted = [...input.dailyCandles].sort((a, b) => a.timestamp - b.timestamp);
  const model = buildVolForecastModel(sorted, input.baselineIv);
  const tenors = {
    '7d': tenorRichness('7d', input, sorted, model),
    '30d': tenorRichness('30d', input, sorted, model),
  };
  const forecastCurve: ForecastCurvePoint[] = [];
  for (let dteDays = 1; dteDays <= FORECAST_CURVE_MAX_DTE; dteDays += 1) {
    forecastCurve.push({
      dteDays,
      forecastVol: model.forecastVolUntil(input.nowMs, input.nowMs + dteDays * DAY_MS),
      usualPremium: model.premiumBaseline(dteDays).medianSpread,
    });
  }
  return {
    generatedAt: input.nowMs,
    underlying: input.underlying,
    forecast: model.forecast,
    tenors,
    termStructure: termStructure(tenors['7d'].atmIv, tenors['30d'].atmIv),
    forecastCurve,
    fairBand: EXCESS_PREMIUM_FAIR_BAND,
  };
}
