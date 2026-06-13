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
    if (point.atmIv == null) continue;
    const dist = Math.abs(point.ts - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return best != null && bestDist <= tolerance ? best : null;
}

export interface SkewDistribution {
  bins: { x: number; density: number }[];
  nowValue: number;
  percentile: number | null;
  sigma: number | null;
  zone: SkewZone | null;
  mean: number;
  stddev: number;
  rangeLo: number;
  rangeHi: number;
  min: number;
  max: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function gaussianKde(
  values: number[],
  lo: number,
  hi: number,
  samples = 32,
): { x: number; density: number }[] {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance) || 1;
  const bw = Math.max(1.06 * sd * n ** -0.2, (hi - lo) / 64 || 1e-6);
  const span = hi - lo || 1;
  const out: { x: number; density: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const x = lo + (span * i) / (samples - 1);
    let density = 0;
    for (const v of values) {
      const u = (x - v) / bw;
      density += Math.exp(-0.5 * u * u);
    }
    out.push({ x, density: density / (n * bw * Math.sqrt(2 * Math.PI)) });
  }
  return out;
}

export function buildDistribution(
  series: IvHistoryPoint[],
  key: SkewMetricKey,
): SkewDistribution | null {
  const values = series
    .map((p) => p[key])
    .filter((v): v is number => v != null && Number.isFinite(v))
    .map((v) => v * 100);
  if (values.length < 2) return null;

  const nowValue = values[values.length - 1]!;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const sigma = stddev > 0 ? (nowValue - mean) / stddev : null;
  const leq = values.filter((v) => v <= nowValue).length;
  const percentile = (leq / values.length) * 100;

  let rangeLo = Math.min(quantile(sorted, 0.02), nowValue);
  let rangeHi = Math.max(quantile(sorted, 0.98), nowValue);
  if (rangeHi - rangeLo < 1e-6) {
    rangeLo -= 1;
    rangeHi += 1;
  }

  return {
    bins: gaussianKde(values, rangeLo, rangeHi),
    nowValue,
    percentile,
    sigma,
    zone: zoneFor(sigma, 'zscore'),
    mean,
    stddev,
    rangeLo,
    rangeHi,
    min,
    max,
  };
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
