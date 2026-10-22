import type { CallPutFlowBucket } from '@oggregator/protocol';
import { defineMessages, type Locale, translate } from '@lib/i18n';
import type { IvHistoryPoint } from '@shared/enriched';

import type { SkewLinePoint } from './skew-history-utils';

export type RegimeState = 'risk-on' | 'neutral' | 'risk-off';
export type RegimeSource = 'rr' | 'contracts' | 'notional' | 'premium';

export interface RegimeParams {
  /** Trailing mean applied to the raw series before classification. */
  smoothSec: number;
  /** Trailing window of smoothed values the zones are built from (current point excluded). */
  bandSec: number;
  /** Zone half-width in standard deviations. */
  k: number;
  /**
   * Where a regime ends, as a fraction of the way from the mid-line back to the zone it broke:
   * 1 exits on re-entering the zone, 0 only on crossing the mid-line.
   */
  exitFraction: number;
}

export interface RegimePoint {
  time: number;
  raw: number;
  value: number;
  mid: number | null;
  upper: number | null;
  lower: number | null;
  /** null while the zone window is still warming up. */
  regime: RegimeState | null;
}

const HOUR = 3600;

export const REGIME_K = 1.5;
export const REGIME_EXIT_FRACTION = 0.5;
export const REGIME_SMOOTH_SEC: Record<RegimeSource, number> = {
  rr: HOUR,
  contracts: 6 * HOUR,
  notional: 6 * HOUR,
  premium: 6 * HOUR,
};

/**
 * Segmented rolling regime: the smoothed series is compared with a mean ± k·σ zone built only
 * from earlier smoothed values, so a point is never classified against data that came after it.
 * Breaking above the upper zone enters risk-on, below the lower zone risk-off; the regime holds
 * until the value falls back past `exitFraction` of the way to the mid-line.
 */
export function computeRegime(points: SkewLinePoint[], params: RegimeParams): RegimePoint[] {
  const smoothed: number[] = [];
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i]!.value;
    while (points[lo]!.time <= points[i]!.time - params.smoothSec) {
      sum -= points[lo]!.value;
      lo++;
    }
    smoothed.push(sum / (i - lo + 1));
  }

  const out: RegimePoint[] = [];
  const firstTime = points[0]?.time ?? 0;
  let bandLo = 0;
  let bandSum = 0;
  let bandSumSq = 0;
  let state: RegimeState = 'neutral';
  for (let i = 0; i < points.length; i++) {
    const time = points[i]!.time;
    const value = smoothed[i]!;
    while (points[bandLo]!.time < time - params.bandSec) {
      bandSum -= smoothed[bandLo]!;
      bandSumSq -= smoothed[bandLo]! ** 2;
      bandLo++;
    }
    const n = i - bandLo;
    const warm = firstTime <= time - params.bandSec && n >= 2;
    if (!warm) {
      out.push({
        time,
        raw: points[i]!.value,
        value,
        mid: null,
        upper: null,
        lower: null,
        regime: null,
      });
    } else {
      const mid = bandSum / n;
      const sd = Math.sqrt(Math.max(0, bandSumSq / n - mid * mid));
      const upper = mid + params.k * sd;
      const lower = mid - params.k * sd;
      if (value > upper) state = 'risk-on';
      else if (value < lower) state = 'risk-off';
      else if (state === 'risk-on' && value < mid + params.exitFraction * (upper - mid)) {
        state = 'neutral';
      } else if (state === 'risk-off' && value > mid - params.exitFraction * (mid - lower)) {
        state = 'neutral';
      }
      out.push({ time, raw: points[i]!.value, value, mid, upper, lower, regime: state });
    }
    bandSum += value;
    bandSumSq += value ** 2;
  }
  return out;
}

/** RR in vol points, one point per sample. */
export function rrSeries(series: IvHistoryPoint[]): SkewLinePoint[] {
  const out: SkewLinePoint[] = [];
  let prev = -Infinity;
  for (const point of series) {
    if (point.rr25d == null || !Number.isFinite(point.rr25d)) continue;
    const time = Math.floor(point.ts / 1000);
    if (time <= prev) continue;
    out.push({ time, value: point.rr25d * 100 });
    prev = time;
  }
  return out;
}

const FLOW_FIELDS: Record<
  Exclude<RegimeSource, 'rr'>,
  [keyof CallPutFlowBucket, keyof CallPutFlowBucket]
> = {
  contracts: ['callContracts', 'putContracts'],
  notional: ['callNotionalUsd', 'putNotionalUsd'],
  premium: ['callPremiumUsd', 'putPremiumUsd'],
};

/**
 * Calls minus puts per bucket on a regular grid; hours without trades are zero. The bucket still
 * filling at `nowSec` is dropped so a partial hour doesn't drag the latest value toward zero.
 */
export function flowSeries(
  buckets: CallPutFlowBucket[],
  source: Exclude<RegimeSource, 'rr'>,
  startSec: number,
  resolutionSec: number,
  nowSec: number,
): SkewLinePoint[] {
  const [callKey, putKey] = FLOW_FIELDS[source];
  const byTs = new Map(buckets.map((bucket) => [bucket.ts, bucket]));
  const out: SkewLinePoint[] = [];
  for (let ts = startSec; ts + resolutionSec <= nowSec; ts += resolutionSec) {
    const bucket = byTs.get(ts);
    out.push({ time: ts, value: bucket ? Number(bucket[callKey]) - Number(bucket[putKey]) : 0 });
  }
  return out;
}

export interface RegimeRun {
  regime: RegimeState;
  since: number;
}

export function currentRun(points: RegimePoint[]): RegimeRun | null {
  const last = points.at(-1);
  if (last?.regime == null) return null;
  let since = last.time;
  for (let i = points.length - 2; i >= 0; i--) {
    if (points[i]!.regime !== last.regime) break;
    since = points[i]!.time;
  }
  return { regime: last.regime, since };
}

export interface RegimeShare {
  riskOn: number;
  riskOff: number;
}

export function regimeShare(points: RegimePoint[]): RegimeShare | null {
  let on = 0;
  let off = 0;
  let total = 0;
  for (const point of points) {
    if (point.regime == null) continue;
    total++;
    if (point.regime === 'risk-on') on++;
    else if (point.regime === 'risk-off') off++;
  }
  return total === 0 ? null : { riskOn: (on / total) * 100, riskOff: (off / total) * 100 };
}

function compactUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatRegimeValue(value: number, source: RegimeSource, underlying: string): string {
  if (source === 'rr') return `${value > 0 ? '+' : ''}${value.toFixed(2)}vp`;
  if (source === 'contracts') {
    const digits = Math.abs(value) >= 100 ? 0 : 1;
    return `${value > 0 ? '+' : ''}${value.toFixed(digits)} ${underlying}`;
  }
  return compactUsd(value);
}

export function formatDuration(sec: number): string {
  const hours = Math.max(0, Math.round(sec / HOUR));
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const messages = defineMessages(
  {
    'risk-on': 'Risk-on',
    neutral: 'Neutral',
    'risk-off': 'Risk-off',
    rr: 'RR',
    contracts: 'call−put contracts',
    notional: 'call−put notional',
    premium: 'call−put premium',
    notEnough: 'Not enough history yet to build the rolling zones.',
    subject: '{smooth} avg {subject} {value}',
    zones: '{band} zones {lower} … {upper}',
    riskOn: 'Risk-on for {since}: {subject} broke above the upper zone ({zones}).',
    riskOff: 'Risk-off for {since}: {subject} broke below the lower zone ({zones}).',
    neutralRun: 'Neutral for {since}: {subject} inside the {zones}{position}.',
    upperHalf: ', upper half',
    lowerHalf: ', lower half',
    share: 'risk-on {on}% · risk-off {off}% of lookback',
  },
  {
    'risk-on': 'Risk-on',
    neutral: 'Neutral',
    'risk-off': 'Risk-off',
    rr: 'RR',
    contracts: 'contratos call−put',
    notional: 'nocional call−put',
    premium: 'prima call−put',
    notEnough: 'Aún no hay suficiente historial para construir las zonas móviles.',
    subject: 'prom. {smooth} {subject} {value}',
    zones: 'zonas {band} {lower} … {upper}',
    riskOn:
      'Risk-on desde hace {since}: {subject} rompió por encima de la zona superior ({zones}).',
    riskOff:
      'Risk-off desde hace {since}: {subject} rompió por debajo de la zona inferior ({zones}).',
    neutralRun: 'Neutral desde hace {since}: {subject} dentro de las {zones}{position}.',
    upperHalf: ', mitad superior',
    lowerHalf: ', mitad inferior',
    share: 'risk-on {on}% · risk-off {off}% del periodo',
  },
);

export function regimeLabel(regime: RegimeState, locale: Locale = 'en'): string {
  return translate(messages, regime, undefined, locale);
}

/** Plain-language read of the latest point. Descriptive only; the regime is not a forecast. */
export function describeRegime(
  points: RegimePoint[],
  source: RegimeSource,
  underlying: string,
  bandLabel: string,
  locale: Locale = 'en',
): string {
  const tr = (key: keyof typeof messages.en & string, vars?: Record<string, string>) =>
    translate(messages, key, vars, locale);
  const last = points.at(-1);
  const run = currentRun(points);
  if (last == null || run == null || last.upper == null || last.lower == null) {
    return tr('notEnough');
  }
  const fmt = (v: number) => formatRegimeValue(v, source, underlying);
  const smooth = formatDuration(REGIME_SMOOTH_SEC[source]);
  const subject = tr('subject', { smooth, subject: tr(source), value: fmt(last.value) });
  const zones = tr('zones', { band: bandLabel, lower: fmt(last.lower), upper: fmt(last.upper) });
  const since = formatDuration(last.time - run.since);
  if (run.regime === 'risk-on') return tr('riskOn', { since, subject, zones });
  if (run.regime === 'risk-off') return tr('riskOff', { since, subject, zones });
  const position =
    last.mid == null ? '' : last.value >= last.mid ? tr('upperHalf') : tr('lowerHalf');
  return tr('neutralRun', { since, subject, zones, position });
}

export function shareText(share: RegimeShare | null, locale: Locale = 'en'): string {
  if (share == null) return '';
  return translate(
    messages,
    'share',
    { on: Math.round(share.riskOn), off: Math.round(share.riskOff) },
    locale,
  );
}
