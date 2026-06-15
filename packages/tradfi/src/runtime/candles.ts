import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import type { TradfiStore } from './store.js';
import { intervalToPeriod, rangeToFromTimeSec, type RawCandle } from '../tastytrade/candle-codec.js';
import type { OptionRight } from '../tastytrade/instrument.js';

export interface CandleSource {
  getCandles(symbol: string, period: string, fromTimeSec: number): Promise<RawCandle[]>;
}

export interface CandlesQuery {
  underlying: string;
  expiry: string;
  strike: number;
  right: OptionRight;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  nowMs: number;
}

export interface TradfiCandlesResponse {
  symbol: string;
  interval: InstrumentCandleInterval;
  priceCurrency: 'USD';
  candles: { ts: number; o: number; h: number; l: number; c: number; vol: number; synthetic: boolean }[];
  markLine: { ts: number; c: number }[];
}

export async function buildCandlesResponse(
  client: CandleSource,
  store: TradfiStore,
  q: CandlesQuery,
): Promise<TradfiCandlesResponse | null> {
  const inst = store.instrumentsFor(q.underlying, q.expiry)
    .find((i) => i.strike === q.strike && i.right === q.right);
  if (!inst) return null;
  const period = intervalToPeriod(q.interval);
  const fromTime = rangeToFromTimeSec(q.range, q.nowMs);
  const raw = await client.getCandles(inst.streamerSymbol, period, fromTime);
  const candles = raw
    .filter((b) => Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .map((b) => ({ ts: b.time, o: b.o, h: b.h, l: b.l, c: b.c, vol: Number.isFinite(b.v) ? b.v : 0, synthetic: false }));
  return { symbol: inst.streamerSymbol, interval: q.interval, priceCurrency: 'USD', candles, markLine: [] };
}
