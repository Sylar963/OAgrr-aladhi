import type {
  InstrumentCandleInterval,
  InstrumentCandleRange,
  InstrumentCandlesResponse,
} from '@oggregator/protocol';

export const INTERVALS: readonly InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
export const RANGES: readonly InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

export interface Timeframe {
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
}

export function isCandleStateUnavailable(
  state: { status: string; data?: InstrumentCandlesResponse | undefined } | undefined,
): boolean {
  if (!state) return false;
  if (state.status === 'error') return true;
  return state.status === 'success' && (state.data?.candles.length ?? 0) === 0;
}

// Order tried when the user's timeframe has no candles: coarser bars first
// (illiquid strikes often only print on 1h+), then wider windows, and finer
// bars at the original window last for venues missing a coarse resolution.
export function fallbackTimeframes(anchor: Timeframe): Timeframe[] {
  const i0 = INTERVALS.indexOf(anchor.interval);
  const r0 = RANGES.indexOf(anchor.range);
  const out: Timeframe[] = [];
  for (let r = r0; r < RANGES.length; r++) {
    for (let i = i0; i < INTERVALS.length; i++) {
      if (r === r0 && i === i0) continue;
      out.push({ interval: INTERVALS[i]!, range: RANGES[r]! });
    }
  }
  for (let i = i0 - 1; i >= 0; i--) out.push({ interval: INTERVALS[i]!, range: anchor.range });
  return out;
}
