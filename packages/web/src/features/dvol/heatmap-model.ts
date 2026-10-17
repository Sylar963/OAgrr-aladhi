import type { VolHeatmapColumn } from '@oggregator/protocol';

export type HeatSide = 'all' | 'bids' | 'asks';

export const HEATMAP_WINDOWS = [
  { hours: 1, resolutionSec: 15, label: '1H' },
  { hours: 6, resolutionSec: 60, label: '6H' },
  { hours: 24, resolutionSec: 300, label: '24H' },
] as const;

export type HeatmapWindow = (typeof HEATMAP_WINDOWS)[number];

/** Replaces the re-sent tail of `prev` with `next` and drops columns older than `windowStart`. */
export function mergeHeatmapTail(
  prev: readonly VolHeatmapColumn[],
  next: readonly VolHeatmapColumn[],
  windowStart: number,
): VolHeatmapColumn[] {
  const firstNew = next[0]?.t ?? Infinity;
  return [...prev.filter((c) => c.t < firstNew), ...next].filter((c) => c.t >= windowStart);
}

export function cellValue(bid: number, ask: number, side: HeatSide): number {
  return side === 'bids' ? bid : side === 'asks' ? ask : bid + ask;
}

/** Colour-scale ceiling: a high percentile, so one outsized level doesn't wash out the rest. */
export function heatScaleMax(columns: readonly VolHeatmapColumn[], side: HeatSide, percentile = 0.99): number {
  const values: number[] = [];
  for (const column of columns) {
    for (const [, bid, ask] of column.cells) {
      const v = cellValue(bid, ask, side);
      if (v > 0) values.push(v);
    }
  }
  if (values.length === 0) return 1;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(percentile * values.length))]!;
}

/**
 * Vega-weighted IV range holding the middle `1 − 2·tail` of resting vega, in percent. Feeds the
 * price-scale autoscale so stale lowball bids at 6 vol don't flatten the interesting band.
 */
export function weightedIvRange(
  cells: VolHeatmapColumn['cells'],
  bucketPct: number,
  tail = 0.03,
): { low: number; high: number } | null {
  let total = 0;
  for (const [, bid, ask] of cells) total += bid + ask;
  if (total <= 0) return null;
  let acc = 0;
  let low: number | null = null;
  let high: number | null = null;
  for (const [bucket, bid, ask] of cells) {
    acc += bid + ask;
    if (low == null && acc >= total * tail) low = bucket * bucketPct;
    if (high == null && acc >= total * (1 - tail)) high = bucket * bucketPct;
  }
  return low != null && high != null ? { low, high } : null;
}

const STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [8, 20, 48]],
  [0.3, [21, 101, 192]],
  [0.55, [38, 198, 218]],
  [0.8, [255, 213, 79]],
  [1, [255, 255, 255]],
];
// Below 1, so thin levels stay visible without the dense core band saturating to white.
const GAMMA = 0.75;

/** Dark blue → cyan → yellow → white. */
export function heatColor(ratio: number): string | null {
  const r = Math.min(1, Math.max(0, ratio));
  const t = r ** GAMMA;
  if (t < 0.03) return null;
  let i = 1;
  while (i < STOPS.length - 1 && STOPS[i]![0] < t) i++;
  const [t0, c0] = STOPS[i - 1]!;
  const [t1, c1] = STOPS[i]!;
  const f = (t - t0) / (t1 - t0);
  const ch = (k: 0 | 1 | 2) => Math.round(c0[k] + (c1[k] - c0[k]) * f);
  const alpha = (0.35 + 0.65 * t).toFixed(2);
  return `rgba(${ch(0)}, ${ch(1)}, ${ch(2)}, ${alpha})`;
}

/** Largest resting level per side in a column, as `[ivPct, vega]`. */
export function walls(column: VolHeatmapColumn | undefined, bucketPct: number) {
  let bid: [number, number] | null = null;
  let ask: [number, number] | null = null;
  for (const [bucket, b, a] of column?.cells ?? []) {
    if (b > (bid?.[1] ?? 0)) bid = [bucket * bucketPct, b];
    if (a > (ask?.[1] ?? 0)) ask = [bucket * bucketPct, a];
  }
  return { bid, ask };
}

export function fmtVega(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  return `$${Math.round(usd)}`;
}
