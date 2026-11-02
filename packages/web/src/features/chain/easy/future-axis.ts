import { pickCandleSpec, type Leg } from '@features/architect';

export type EasyTimeframe = 'auto' | '15m' | '1h' | '4h' | '1d';

export interface EasyCandleSpec {
  resolutionSec: number;
  buckets: number;
  refetchIntervalMs: number;
  label: string;
}

export const TIMEFRAMES: { id: EasyTimeframe; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
];

const FIXED: Record<Exclude<EasyTimeframe, 'auto'>, EasyCandleSpec> = {
  '15m': { resolutionSec: 900, buckets: 192, refetchIntervalMs: 15_000, label: '15m' },
  '1h': { resolutionSec: 3600, buckets: 168, refetchIntervalMs: 60_000, label: '1H' },
  '4h': { resolutionSec: 14400, buckets: 180, refetchIntervalMs: 120_000, label: '4H' },
  '1d': { resolutionSec: 86400, buckets: 180, refetchIntervalMs: 300_000, label: '1D' },
};

export function easyCandleSpec(timeframe: EasyTimeframe, legs: Leg[]): EasyCandleSpec {
  if (timeframe !== 'auto') return FIXED[timeframe];
  const spec = pickCandleSpec(legs);
  return {
    resolutionSec: spec.resolutionSec,
    buckets: spec.buckets,
    refetchIntervalMs: spec.refetchIntervalMs,
    label: spec.intervalLabel,
  };
}

// A live bar can only land on a time point that exists, so the next few stay on the bar grid until
// the following refetch rebuilds the axis.
const LIVE_BARS_ON_GRID = 4;

/**
 * Empty time points from the last candle to the deadline, so the chart's time
 * axis reaches expiry. Long tenors at fine resolution are thinned to
 * `maxPoints`, which compresses the future part of the axis.
 */
export function futureTimes(
  lastSec: number,
  deadlineSec: number,
  resolutionSec: number,
  maxPoints = 1500,
): number[] {
  if (!(deadlineSec > lastSec) || resolutionSec <= 0) return [];
  const bars = Math.ceil((deadlineSec - lastSec) / resolutionSec);
  const step = resolutionSec * Math.max(1, Math.ceil(bars / (maxPoints - LIVE_BARS_ON_GRID)));
  const out: number[] = [];
  let t = lastSec + resolutionSec;
  for (let i = 0; i < LIVE_BARS_ON_GRID && t < deadlineSec; i++, t += resolutionSec) out.push(t);
  if (step > resolutionSec) t = lastSec + resolutionSec * LIVE_BARS_ON_GRID + step;
  for (; t < deadlineSec; t += step) out.push(t);
  out.push(deadlineSec);
  return out;
}
