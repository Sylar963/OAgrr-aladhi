import type { IvHistoryPoint } from '@shared/enriched';

export type SkewDisplayMode = 'raw' | 'normalized' | 'zscore';
export type SkewMetricKey = 'rr25d' | 'bfly25d';

export interface SkewLinePoint {
  time: number;
  value: number;
}

interface MetricPoint {
  time: number;
  value: number;
}

function metricPoints(series: IvHistoryPoint[], key: SkewMetricKey): MetricPoint[] {
  const rows: MetricPoint[] = [];
  let prev = -Infinity;
  for (const point of series) {
    const value = point[key];
    if (value == null || !Number.isFinite(value)) continue;
    const time = Math.floor(point.ts / 1000);
    if (time <= prev) continue;
    rows.push({ time, value });
    prev = time;
  }
  return rows;
}

export function buildSkewLineData(
  series: IvHistoryPoint[],
  key: SkewMetricKey,
  mode: SkewDisplayMode,
): SkewLinePoint[] {
  if (mode === 'zscore') {
    const points = metricPoints(series, key);
    if (points.length < 2) return [];
    const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
    const variance =
      points.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / points.length;
    const stddev = Math.sqrt(variance);
    if (!(stddev > 0)) return [];
    return points.map((point) => ({
      time: point.time,
      value: (point.value - mean) / stddev,
    }));
  }

  const rows: SkewLinePoint[] = [];
  let prev = -Infinity;
  for (const point of series) {
    const value = point[key];
    if (value == null || !Number.isFinite(value)) continue;
    const time = Math.floor(point.ts / 1000);
    if (time <= prev) continue;
    if (mode === 'normalized') {
      const atm = point.atmIv;
      if (atm == null || !Number.isFinite(atm) || atm <= 0) continue;
      rows.push({ time, value: (value / atm) * 100 });
    } else {
      rows.push({ time, value: value * 100 });
    }
    prev = time;
  }
  return rows;
}

export function latestSkewDisplayValue(
  series: IvHistoryPoint[],
  key: SkewMetricKey,
  mode: SkewDisplayMode,
): number | null {
  const rows = buildSkewLineData(series, key, mode);
  return rows.length > 0 ? rows[rows.length - 1]!.value : null;
}

export function formatSkewDisplayValue(value: number | null, mode: SkewDisplayMode): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  if (mode === 'zscore') return `${sign}${value.toFixed(2)}σ`;
  if (mode === 'normalized') return `${sign}${value.toFixed(1)}% ATM`;
  return `${sign}${value.toFixed(1)}%`;
}

export type SkewZone = 'normal' | 'stretched' | 'extreme';

export function zoneFor(value: number | null, mode: SkewDisplayMode): SkewZone | null {
  if (mode !== 'zscore' || value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 2) return 'extreme';
  if (abs >= 1) return 'stretched';
  return 'normal';
}

export interface SmilePoint {
  /** Delta-axis position in [0,1]: put |δ| on the left, 1−callδ on the right. */
  x: number;
  /** IV in vol points (fraction × 100). */
  iv: number;
  label: string;
}

const DELTA_X = { put10: 0.1, put25: 0.25, atm: 0.5, call25: 0.75, call10: 0.9 };

const MS_PER_DAY = 86_400_000;

export function pickReferencePoint(
  series: IvHistoryPoint[],
  nowTs: number,
  refDays: number,
): IvHistoryPoint | null {
  if (series.length === 0) return null;
  const target = nowTs - refDays * MS_PER_DAY;
  const tolerance = (refDays * MS_PER_DAY) / 2;
  let best: IvHistoryPoint | null = null;
  let bestDist = Infinity;
  for (const point of series) {
    if (point.atmIv == null || point.rr25d == null || point.bfly25d == null) continue;
    const dist = Math.abs(point.ts - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return best != null && bestDist <= tolerance ? best : null;
}

export interface SkewBands {
  p10: number;
  p50: number;
  p90: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** p10/p50/p90 of a metric over the lookback, in vol points. */
export function buildBands(points: SkewLinePoint[]): SkewBands | null {
  if (points.length < 2) return null;
  const sorted = points.map((p) => p.value).sort((a, b) => a - b);
  return { p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
}

export function zoneForPercentile(percentile: number | null): SkewZone | null {
  if (percentile == null || !Number.isFinite(percentile)) return null;
  const tail = Math.min(percentile, 100 - percentile);
  if (tail <= 5) return 'extreme';
  if (tail <= 15) return 'stretched';
  return 'normal';
}

export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th';
  return `${v}${suffix}`;
}

function relativeTo(percentile: number | null, low: string, high: string): string {
  if (percentile == null) return 'no history yet';
  if (percentile >= 85) return `${high} (${ordinal(percentile)} pct)`;
  if (percentile <= 15) return `${low} (${ordinal(percentile)} pct)`;
  return `typical for the lookback (${ordinal(percentile)} pct)`;
}

/** Plain-language read of RR/Fly level and where it sits in the lookback. Inputs in vol points. */
export function describeSkew(
  rrVp: number | null,
  rrPct: number | null,
  flyVp: number | null,
  flyPct: number | null,
): string {
  const parts: string[] = [];
  if (rrVp != null) {
    const level =
      Math.abs(rrVp) < 0.25
        ? 'Calls ≈ puts'
        : rrVp < 0
          ? `Puts over calls by ${Math.abs(rrVp).toFixed(1)}vp`
          : `Calls over puts by ${rrVp.toFixed(1)}vp`;
    parts.push(`${level}: ${relativeTo(rrPct, 'puts unusually bid', 'calls unusually bid')}.`);
  }
  if (flyVp != null) {
    parts.push(`Tails ${relativeTo(flyPct, 'unusually cheap', 'unusually rich')}.`);
  }
  return parts.join(' ');
}

export function reconstructSmile(point: IvHistoryPoint): SmilePoint[] {
  const { atmIv, rr25d, bfly25d, rr10d, bfly10d } = point;
  if (atmIv == null || !Number.isFinite(atmIv)) return [];
  const pts: SmilePoint[] = [];
  const has10 =
    rr10d != null && Number.isFinite(rr10d) && bfly10d != null && Number.isFinite(bfly10d);
  if (has10) {
    pts.push({ x: DELTA_X.put10, iv: (atmIv + bfly10d! - rr10d! / 2) * 100, label: '10Δp' });
  }
  if (rr25d != null && Number.isFinite(rr25d) && bfly25d != null && Number.isFinite(bfly25d)) {
    pts.push({ x: DELTA_X.put25, iv: (atmIv + bfly25d - rr25d / 2) * 100, label: '25Δp' });
  }
  pts.push({ x: DELTA_X.atm, iv: atmIv * 100, label: 'ATM' });
  if (rr25d != null && Number.isFinite(rr25d) && bfly25d != null && Number.isFinite(bfly25d)) {
    pts.push({ x: DELTA_X.call25, iv: (atmIv + bfly25d + rr25d / 2) * 100, label: '25Δc' });
  }
  if (has10) {
    pts.push({ x: DELTA_X.call10, iv: (atmIv + bfly10d! + rr10d! / 2) * 100, label: '10Δc' });
  }
  return pts.sort((a, b) => a.x - b.x);
}
