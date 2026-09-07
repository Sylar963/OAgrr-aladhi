import type { Time } from 'lightweight-charts';
import type { LiveBar } from './use-tradfi-underlying-candles-live';

export interface HistoricalCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function tsToSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

export function liveBarToCandle(
  bar: Pick<LiveBar, 'ts' | 'o' | 'h' | 'l' | 'c'>,
): { time: Time; open: number; high: number; low: number; close: number } {
  return { time: tsToSec(bar.ts) as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
}

export function mergeLiveBars(
  history: HistoricalCandle[],
  liveBars: LiveBar[],
): HistoricalCandle[] {
  const byTimestamp = new Map(history.map((candle) => [candle.timestamp, candle]));
  for (const bar of liveBars) {
    byTimestamp.set(bar.ts, {
      timestamp: bar.ts,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}
