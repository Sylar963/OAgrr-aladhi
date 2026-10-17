import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VenueId } from '../types/common.js';
import { ReferenceMarkHistoryBuffer } from './__fixtures__/mark-history-buffer.reference.js';
import { MarkHistoryBuffer, mergeBaseBuckets } from './mark-history-buffer.js';

const MIN = 60_000;
// Aligned to a 1-hour boundary so 1m / 5m / 15m / 1h assertions all line up.
const BASE_TS = Math.floor(1_700_000_000_000 / (60 * MIN)) * (60 * MIN);

describe('MarkHistoryBuffer', () => {
  let buf: MarkHistoryBuffer;

  beforeEach(() => {
    buf = new MarkHistoryBuffer({ retentionMs: 60 * MIN });
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS + 5 * MIN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('buckets mark ticks into the correct 1m slot and tracks OHLC', () => {
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 10_000, 100);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 20_000, 110);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 30_000, 90);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 50_000, 105);
    buf.recordMark('derive', 'HYPE-X', BASE_TS + 70_000, 120);

    const candles = buf.getMarkCandles('derive', 'HYPE-X', MIN, 10 * MIN);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 110, l: 90, c: 105, vol: 0 });
    expect(candles[1]).toMatchObject({ ts: BASE_TS + MIN, o: 120, h: 120, l: 120, c: 120, vol: 0 });
  });

  it('aggregates trade ticks with summed volume', () => {
    buf.recordTrade('derive', 'HYPE-X', BASE_TS + 10_000, 100, 5);
    buf.recordTrade('derive', 'HYPE-X', BASE_TS + 30_000, 110, 3);
    buf.recordTrade('derive', 'HYPE-X', BASE_TS + 50_000, 95, 2);

    const candles = buf.getTradeCandles('derive', 'HYPE-X', MIN, 10 * MIN);
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 110, l: 95, c: 95, vol: 10 });
  });

  it('isolates streams between mark and trade', () => {
    buf.recordMark('derive', 'A', BASE_TS, 100);
    buf.recordTrade('derive', 'A', BASE_TS, 200, 1);

    const mark = buf.getMarkCandles('derive', 'A', MIN, 10 * MIN);
    const trade = buf.getTradeCandles('derive', 'A', MIN, 10 * MIN);
    expect(mark[0]?.c).toBe(100);
    expect(trade[0]?.c).toBe(200);
  });

  it('isolates instruments and venues', () => {
    buf.recordMark('derive', 'A', BASE_TS, 1);
    buf.recordMark('derive', 'B', BASE_TS, 2);
    buf.recordMark('deribit', 'A', BASE_TS, 3);

    expect(buf.getMarkCandles('derive', 'A', MIN, 10 * MIN)[0]?.c).toBe(1);
    expect(buf.getMarkCandles('derive', 'B', MIN, 10 * MIN)[0]?.c).toBe(2);
    expect(buf.getMarkCandles('deribit', 'A', MIN, 10 * MIN)[0]?.c).toBe(3);
  });

  it('filters by the requested range', () => {
    buf.recordMark('derive', 'A', BASE_TS, 1);
    buf.recordMark('derive', 'A', BASE_TS + 4 * MIN, 2);

    vi.setSystemTime(BASE_TS + 4 * MIN + 30_000);
    const recent = buf.getMarkCandles('derive', 'A', MIN, 2 * MIN);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.c).toBe(2);
  });

  it('re-buckets to a coarser interval', () => {
    for (let i = 0; i < 10; i++) {
      buf.recordMark('derive', 'A', BASE_TS + i * MIN, 100 + i);
    }
    const five = buf.getMarkCandles('derive', 'A', 5 * MIN, 60 * MIN);
    expect(five).toHaveLength(2);
    expect(five[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 104, l: 100, c: 104 });
    expect(five[1]).toMatchObject({ ts: BASE_TS + 5 * MIN, o: 105, h: 109, l: 105, c: 109 });
  });

  it('drops stale buckets past the retention window once a sweep fires', () => {
    const buffer = new MarkHistoryBuffer({ retentionMs: 5 * MIN });
    for (let i = 0; i < 255; i++) {
      buffer.recordMark('derive', 'A', BASE_TS + i * 1000, 100);
    }
    // Lands 100 minutes later: cutoff = ts - retentionMs is past every earlier bucket.
    buffer.recordMark('derive', 'A', BASE_TS + 100 * MIN, 999);
    expect(buffer.stats().markBuckets).toBe(1);
  });

  it('rolls buckets older than the fine window into coarse candles', () => {
    const buffer = new MarkHistoryBuffer({ fineRetentionMs: 60 * MIN, coarseBucketMs: 60 * MIN });
    for (let i = 0; i < 180; i++) {
      buffer.recordMark('derive', 'A', BASE_TS + i * MIN, 100 + i);
    }
    vi.setSystemTime(BASE_TS + 180 * MIN);
    buffer.recordMark('derive', 'A', BASE_TS + 180 * MIN, 500);

    // Sweep at t=180m: hours [0,60) and [60,120) are rolled up, [120,181) stay at 1m.
    expect(buffer.stats().markBuckets).toBe(2 + 61);
    const candles = buffer.getMarkCandles('derive', 'A', MIN, 240 * MIN);
    expect(candles[0]).toMatchObject({ ts: BASE_TS, o: 100, h: 159, l: 100, c: 159 });
    expect(candles[1]).toMatchObject({ ts: BASE_TS + 60 * MIN, o: 160, h: 219, l: 160, c: 219 });
    expect(candles[2]).toMatchObject({ ts: BASE_TS + 120 * MIN, c: 220 });

    const hourly = buffer.getMarkCandles('derive', 'A', 60 * MIN, 240 * MIN);
    expect(hourly.map((c) => c.c)).toEqual([159, 219, 279, 500]);
  });

  it('evicts the oldest buckets across instruments once the global cap is exceeded', () => {
    const buffer = new MarkHistoryBuffer({ maxBuckets: 100, fineRetentionMs: 24 * 60 * MIN });
    for (let i = 0; i < 60; i++) {
      buffer.recordMark('derive', 'A', BASE_TS + i * MIN, 100);
      buffer.recordMark('derive', 'B', BASE_TS + i * MIN, 100);
    }
    buffer.recordMark('derive', 'A', BASE_TS + 60 * MIN, 100);

    const { markBuckets } = buffer.stats();
    expect(markBuckets).toBeLessThanOrEqual(100);
    vi.setSystemTime(BASE_TS + 61 * MIN);
    const a = buffer.getMarkCandles('derive', 'A', MIN, 120 * MIN);
    expect(a.at(-1)?.ts).toBe(BASE_TS + 60 * MIN);
    expect(a[0]!.ts).toBeGreaterThan(BASE_TS);
  });

  it('sweeps at most once per sweep interval regardless of write volume', () => {
    const buffer = new MarkHistoryBuffer({ retentionMs: MIN, sweepIntervalMs: 10 * MIN });
    buffer.recordMark('derive', 'A', BASE_TS, 100);
    for (let i = 1; i <= 1000; i++) buffer.recordMark('derive', 'B', BASE_TS + 5 * MIN, 100);
    expect(buffer.hasMark('derive', 'A')).toBe(true);
    buffer.recordMark('derive', 'B', BASE_TS + 10 * MIN, 100);
    expect(buffer.hasMark('derive', 'A')).toBe(false);
  });

  it('rejects non-finite or non-positive prices', () => {
    buf.recordMark('derive', 'A', BASE_TS, Number.NaN);
    buf.recordMark('derive', 'A', BASE_TS, 0);
    buf.recordMark('derive', 'A', BASE_TS, -1);
    buf.recordTrade('derive', 'A', BASE_TS, Number.NaN, 1);
    expect(buf.hasMark('derive', 'A')).toBe(false);
    expect(buf.hasTrade('derive', 'A')).toBe(false);
  });

  it('returns empty arrays for unknown instruments', () => {
    expect(buf.getMarkCandles('derive', 'never-seen', MIN, MIN)).toEqual([]);
    expect(buf.getTradeCandles('derive', 'never-seen', MIN, MIN)).toEqual([]);
  });
});

describe('mergeBaseBuckets', () => {
  it('rolls 1m candles into a 5m candle with correct OHLCV', () => {
    const minutes = [100, 110, 90, 95, 105].map((c, i) => ({
      ts: i * MIN,
      o: c - 1,
      h: c + 2,
      l: c - 3,
      c,
      vol: i,
    }));
    const out = mergeBaseBuckets(minutes, 5 * MIN);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ts: 0,
      o: 99,
      h: 112,
      l: 87,
      c: 105,
      vol: 0 + 1 + 2 + 3 + 4,
    });
  });

  it('keeps base candles unchanged when interval equals base', () => {
    const minutes = [
      { ts: 0, o: 1, h: 1, l: 1, c: 1, vol: 1 },
      { ts: MIN, o: 2, h: 2, l: 2, c: 2, vol: 2 },
    ];
    const out = mergeBaseBuckets(minutes, MIN);
    expect(out).toEqual(minutes);
  });
});

describe('MarkHistoryBuffer packed storage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches the Map-based reference for an in-order workload with rolling, expiry, and eviction', () => {
    vi.useFakeTimers();
    let seed = 0x51ed;
    const rand = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return seed / 4294967296;
    };
    const options = {
      retentionMs: 6 * 60 * MIN,
      fineRetentionMs: 30 * MIN,
      coarseBucketMs: 15 * MIN,
      maxBuckets: 900,
      sweepIntervalMs: 3 * MIN,
    };
    const packed = new MarkHistoryBuffer(options);
    const reference = new ReferenceMarkHistoryBuffer(options);
    const venues: VenueId[] = ['deribit', 'derive', 'gateio'];
    const symbols = Array.from({ length: 14 }, (_, i) => `SYM-${i}`);
    let now = BASE_TS;
    let price = 100;

    for (let step = 0; step < 12_000; step++) {
      now += Math.floor(rand() * 4_000);
      price = Math.max(1, price + (rand() - 0.5) * 2);
      const venue = venues[Math.floor(rand() * venues.length)]!;
      // Fewer symbols trade late in the run so instruments age out and are deleted.
      const symbol = symbols[Math.floor(rand() * (step > 9_000 ? 4 : symbols.length))]!;
      // Same-bucket late ticks keep both implementations' bucket order identical.
      const ts = rand() < 0.1 ? Math.floor(now / MIN) * MIN + Math.floor(rand() * (now % MIN)) : now;
      if (rand() < 0.75) {
        packed.recordMark(venue, symbol, ts, price);
        reference.recordMark(venue, symbol, ts, price);
      } else {
        const size = rand() < 0.2 ? 0 : rand() * 3;
        packed.recordTrade(venue, symbol, ts, price, size);
        reference.recordTrade(venue, symbol, ts, price, size);
      }

      if (step % 400 === 399) {
        vi.setSystemTime(now);
        expect(packed.stats()).toEqual(reference.stats());
        for (const v of venues) {
          for (const sym of symbols) {
            for (const interval of [MIN, 15 * MIN]) {
              expect(packed.getMarkCandles(v, sym, interval, 8 * 60 * MIN)).toEqual(
                reference.getMarkCandles(v, sym, interval, 8 * 60 * MIN),
              );
              expect(packed.getTradeCandles(v, sym, interval, 8 * 60 * MIN)).toEqual(
                reference.getTradeCandles(v, sym, interval, 8 * 60 * MIN),
              );
            }
            expect(packed.hasMark(v, sym)).toBe(reference.hasMark(v, sym));
          }
        }
      }
    }
    expect(packed.stats().markBuckets).toBeGreaterThan(0);
  });

  it('places a late tick that opens an older bucket in time order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS + 10 * MIN);
    const buf = new MarkHistoryBuffer({ retentionMs: 60 * MIN });
    buf.recordMark('deribit', 'X', BASE_TS + 5 * MIN, 50);
    buf.recordMark('deribit', 'X', BASE_TS + 7 * MIN, 70);
    buf.recordMark('deribit', 'X', BASE_TS + 1 * MIN + 10, 10);
    buf.recordMark('deribit', 'X', BASE_TS + 6 * MIN, 60);
    buf.recordMark('deribit', 'X', BASE_TS + 6 * MIN + 5, 65);
    const candles = buf.getMarkCandles('deribit', 'X', MIN, 60 * MIN);
    expect(candles.map((c) => [c.ts - BASE_TS, c.o, c.h, c.l, c.c])).toEqual([
      [1 * MIN, 10, 10, 10, 10],
      [5 * MIN, 50, 50, 50, 50],
      [6 * MIN, 60, 65, 60, 65],
      [7 * MIN, 70, 70, 70, 70],
    ]);
  });

  it('keeps per-series memory bounded as old buckets expire', () => {
    vi.useFakeTimers();
    const buf = new MarkHistoryBuffer({
      retentionMs: 30 * MIN,
      fineRetentionMs: 30 * MIN,
      sweepIntervalMs: MIN,
    });
    for (let i = 0; i < 50_000; i++) buf.recordMark('deribit', 'X', BASE_TS + i * MIN, 100 + (i % 7));
    vi.setSystemTime(BASE_TS + 50_000 * MIN);
    expect(buf.stats().markBuckets).toBeLessThanOrEqual(32);
    expect(buf.getMarkCandles('deribit', 'X', MIN, 10 * MIN).length).toBeGreaterThan(0);
  });
});
