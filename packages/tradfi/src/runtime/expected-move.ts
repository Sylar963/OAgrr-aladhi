import { buildExpectedMoveSession } from '@oggregator/core';
import type { ExpectedMoveResponse } from '@oggregator/protocol';
import type { RawCandle } from '../tastytrade/candle-codec.js';
import type { CandleSource } from './candles.js';

const DAY_MS = 86_400_000;
const nyHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  hourCycle: 'h23',
});
const nyDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function cashSessionTime(date: string, hour: number, minute = 0): number {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const offsetHours = 12 - Number(nyHour.format(noon));
  return noon + (hour - 12 + offsetHours) * 3_600_000 + minute * 60_000;
}

export function buildSpxMoveReport(
  bars: readonly RawCandle[],
  ivBars: readonly RawCandle[],
  spotTail: readonly RawCandle[],
  ivTail: readonly RawCandle[],
  nowMs: number,
): ExpectedMoveResponse {
  const valid = (b: RawCandle) => Number.isFinite(b.time) && b.c > 0 && Number.isFinite(b.c);
  const daily = [...new Map(bars.filter(valid).map((b) => [dayKey(b.time), b])).values()].sort(
    (a, b) => a.time - b.time,
  );
  const ivByDate = new Map(ivBars.filter(valid).map((b) => [dayKey(b.time), b]));
  const todayParts = nyDate.formatToParts(nowMs);
  const part = (name: string) => todayParts.find((p) => p.type === name)?.value ?? '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const recent = (tail: readonly RawCandle[]) =>
    tail
      .filter((b) => valid(b) && b.time <= nowMs && nowMs - b.time <= 120_000)
      .sort((a, b) => a.time - b.time)
      .at(-1);
  const spot = recent(spotTail);
  const iv = recent(ivTail);
  const sessions = daily.flatMap((bar, i) => {
    const date = dayKey(bar.time);
    const startMs = cashSessionTime(date, 9, 30);
    const endMs = cashSessionTime(date, 16);
    if (startMs > nowMs) return [];
    const complete = date < today || nowMs >= endMs + 15 * 60_000;
    const previous = daily[i - 1];
    const opening = previous == null ? null : ivByDate.get(dayKey(previous.time));
    const currentPrice = !complete && spot != null && spot.time >= startMs ? spot : null;
    const session = buildExpectedMoveSession({
      startMs,
      endMs,
      open: bar.o,
      last: currentPrice?.c ?? bar.c,
      high: Math.max(bar.h, currentPrice?.c ?? bar.c),
      low: Math.min(bar.l, currentPrice?.c ?? bar.c),
      priceAsOfMs: complete ? endMs : (currentPrice?.time ?? bar.time),
      openingIv: opening == null ? null : opening.c / 100,
      ivAsOfMs: opening == null ? null : cashSessionTime(dayKey(opening.time), 16, 15),
      complete,
      coverage: complete || currentPrice != null ? 'complete' : 'partial',
      periodsPerYear: 252,
    });
    return session == null ? [] : [session];
  });
  return {
    underlying: 'SPX',
    anchor: 'cash',
    generatedAt: nowMs,
    periodsPerYear: 252,
    index: 'VIX',
    priceSource: 'SPX-cash',
    liveIv: iv == null ? null : iv.c / 100,
    liveIvAsOfMs: iv?.time ?? null,
    current: sessions.find((s) => !s.complete) ?? null,
    history: sessions.filter((s) => s.complete).reverse(),
  };
}

export class SpxMoveSource {
  private cached: { at: number; value: Promise<ExpectedMoveResponse> } | null = null;

  constructor(private readonly client: CandleSource) {}

  get(nowMs = Date.now()): Promise<ExpectedMoveResponse> {
    if (this.cached != null && nowMs - this.cached.at < 60_000) return this.cached.value;
    const value = this.load(nowMs).catch((error: unknown) => {
      if (this.cached?.value === value) this.cached = null;
      throw error;
    });
    this.cached = { at: nowMs, value };
    return value;
  }

  private async load(nowMs: number): Promise<ExpectedMoveResponse> {
    const [daily, iv, spotTail, ivTail] = await Promise.all([
      this.client.getCandles('SPX', 'd', nowMs - 65 * DAY_MS),
      this.client.getCandles('VIX', 'd', nowMs - 65 * DAY_MS),
      this.client.getCandles('SPX', 'm', nowMs - 5 * 60_000),
      this.client.getCandles('VIX', 'm', nowMs - 5 * 60_000),
    ]);
    return buildSpxMoveReport(daily, iv, spotTail, ivTail, Date.now());
  }
}
