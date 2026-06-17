import type { Time } from 'lightweight-charts';
import type { LiveBar } from './use-tradfi-underlying-candles-live';

export function tsToSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

export function liveBarToCandle(
  bar: Pick<LiveBar, 'ts' | 'o' | 'h' | 'l' | 'c'>,
): { time: Time; open: number; high: number; low: number; close: number } {
  return { time: tsToSec(bar.ts) as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
}
