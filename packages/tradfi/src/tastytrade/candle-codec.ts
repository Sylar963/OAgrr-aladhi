import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';

export const CANDLE_CHANNEL = 1; // dedicated channel on the candle connection
export const CANDLE_FIELDS = ['eventType', 'eventSymbol', 'eventFlags', 'time', 'open', 'high', 'low', 'close', 'volume'];

const SNAPSHOT_END = 0x08;
const SNAPSHOT_SNIP = 0x10;

export interface RawCandle { symbol: string; flags: number; time: number; o: number; h: number; l: number; c: number; v: number; }

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

export function parseCandleFrame(frame: unknown): RawCandle[] {
  if (typeof frame !== 'object' || frame == null) return [];
  const f = frame as { type?: unknown; data?: unknown };
  if (f.type !== 'FEED_DATA' || !Array.isArray(f.data) || f.data[0] !== 'Candle') return [];
  const flat = f.data[1];
  if (!Array.isArray(flat)) return [];
  const n = CANDLE_FIELDS.length;
  const out: RawCandle[] = [];
  for (let i = 0; i + n <= flat.length; i += n) {
    const symbol = String(flat[i + 1]); // full candle symbol incl. {=period} — used for exact request routing
    out.push({
      symbol, flags: num(flat[i + 2]), time: num(flat[i + 3]),
      o: num(flat[i + 4]), h: num(flat[i + 5]), l: num(flat[i + 6]), c: num(flat[i + 7]), v: num(flat[i + 8]),
    });
  }
  return out;
}

export function isSnapshotComplete(flags: number): boolean {
  return (flags & (SNAPSHOT_END | SNAPSHOT_SNIP)) !== 0;
}

const INTERVAL_TO_PERIOD: Record<InstrumentCandleInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
};
export function intervalToPeriod(i: InstrumentCandleInterval): string { return INTERVAL_TO_PERIOD[i]; }

const RANGE_TO_MS: Record<InstrumentCandleRange, number> = {
  '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, max: 365 * 86_400_000,
};
export function rangeToFromTimeSec(r: InstrumentCandleRange, nowMs: number): number {
  return Math.floor((nowMs - RANGE_TO_MS[r]) / 1000);
}

export function buildCandleFeedSetup(channel: number) {
  return { type: 'FEED_SETUP', channel, acceptAggregationPeriod: 0.1, acceptDataFormat: 'COMPACT' as const,
    acceptEventFields: { Candle: CANDLE_FIELDS } };
}
export function buildCandleSubscribe(channel: number, symbol: string, fromTime: number) {
  return { type: 'FEED_SUBSCRIPTION', channel, add: [{ type: 'Candle', symbol, fromTime }] };
}
export function buildCandleUnsubscribe(channel: number, symbol: string) {
  return { type: 'FEED_SUBSCRIPTION', channel, remove: [{ type: 'Candle', symbol }] };
}
