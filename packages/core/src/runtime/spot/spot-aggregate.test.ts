import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateBars,
  AggregatedSpotRuntime,
  applyTick,
  mergeFormingBar,
  scaleBar,
  type SpotStreamTransport,
  type VenueBar,
  weightedMedian,
} from './spot-aggregate.js';
import type { SpotStreamEvent, SpotVenue } from './spot-venues.js';

const MINUTE = 60_000;
const NOW = 1_793_643_000_000 + 30_000;
const BUCKET = Math.floor(NOW / MINUTE) * MINUTE;

type Row = [timestamp: number, price: number, volume: number];

function venueOf(url: string): SpotVenue {
  if (url.includes('deribit')) return 'deribit';
  return url.includes('binance') ? 'binance' : 'bybit';
}

function bodyFor(url: string, rows: readonly Row[]): unknown {
  switch (venueOf(url)) {
    case 'deribit':
      return {
        result: {
          status: 'ok',
          ticks: rows.map((r) => r[0]),
          open: rows.map((r) => r[1]),
          high: rows.map((r) => r[1]),
          low: rows.map((r) => r[1]),
          close: rows.map((r) => r[1]),
          volume: rows.map((r) => r[2]),
        },
      };
    case 'binance':
      return rows.map(([ts, p, v]) => [ts, String(p), String(p), String(p), String(p), String(v)]);
    case 'bybit':
      return { retCode: 0, result: { list: rows.map(([ts, p, v]) => [ts, p, p, p, p, v, 0].map(String)) } };
  }
}

type RowsFor = (url: string) => readonly Row[] | Error;

function fakeFetch(rowsFor: RowsFor) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const rows = rowsFor(url);
    if (rows instanceof Error) throw rows;
    return new Response(JSON.stringify(bodyFor(url, rows)));
  }) as unknown as typeof fetch;
}

class FakeTransport implements SpotStreamTransport {
  added: string[] = [];
  removed: string[] = [];
  disposed = false;

  constructor(readonly emit: (events: SpotStreamEvent[]) => void) {}

  add(topics: string[]): void {
    this.added.push(...topics);
  }

  remove(topics: string[]): void {
    this.removed.push(...topics);
  }

  dispose(): void {
    this.disposed = true;
  }
}

function buildRuntime(rowsFor: RowsFor) {
  const transports = new Map<SpotVenue, FakeTransport>();
  const fetchImpl = fakeFetch(rowsFor);
  const runtime = new AggregatedSpotRuntime({
    now: () => Date.now(),
    fetchImpl,
    flushIntervalMs: 250,
    createTransport: (venue, onEvents) => {
      const transport = new FakeTransport(onEvents);
      transports.set(venue, transport);
      return transport;
    },
  });
  return { runtime, transports, fetchImpl };
}

const isUsdtRate = (url: string) => url.includes('USDCUSDT');
const isDeribit = (url: string) => url.includes('deribit');
const isBinance = (url: string) => url.includes('binance') && !isUsdtRate(url);
const isBybit = (url: string) => url.includes('bybit');
const urlsOf = (fetchImpl: typeof fetch) => vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url));

// Response bodies resolve on real macrotasks, so fake timers alone don't drain a load.
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (ms > 0) await vi.advanceTimersByTimeAsync(ms);
}

describe('AggregatedSpotRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function candles(runtime: AggregatedSpotRuntime, buckets = 2) {
    const pending = runtime.getCandles('BTC', 60, buckets);
    await settle();
    return pending;
  }

  describe('price', () => {
    it('converts USDT pairs to USD with the inverse of USDCUSDT', async () => {
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return [[BUCKET, 1 / 0.998, 100]];
        if (isDeribit(url)) return [[BUCKET, 998, 1]];
        return [[BUCKET, 1000, 1]];
      });

      const { candles: result } = await candles(runtime);
      expect(result).toHaveLength(1);
      expect(result[0]!.close).toBeCloseTo(998);
      runtime.dispose();
    });

    it('takes the Binance price when it sits between the other venues', async () => {
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return [[BUCKET, 1, 100]];
        if (isDeribit(url)) return [[BUCKET, 90, 1]];
        return isBinance(url) ? [[BUCKET, 100, 1]] : [[BUCKET, 120, 1]];
      });

      expect((await candles(runtime)).candles[0]!.close).toBe(100);
      runtime.dispose();
    });

    it('moves halfway to the nearest venue when Binance is the outlier', async () => {
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return [[BUCKET, 1, 100]];
        if (isDeribit(url)) return [[BUCKET, 100, 1]];
        return isBinance(url) ? [[BUCKET, 90, 1]] : [[BUCKET, 102, 1]];
      });

      expect((await candles(runtime)).candles[0]!.close).toBe(95);
      runtime.dispose();
    });

    it('sums base volume across venues', async () => {
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return [[BUCKET, 1, 100]];
        if (isDeribit(url)) return [[BUCKET, 90, 2]];
        return isBinance(url) ? [[BUCKET, 100, 3]] : new Error('down');
      });

      expect((await candles(runtime)).candles[0]).toMatchObject({ close: 100, volume: 5, venues: 2 });
      runtime.dispose();
    });

    it('leaves USDT venues out when no rate is known instead of assuming a dollar', async () => {
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return new Error('rate down');
        return isDeribit(url) ? [[BUCKET, 998, 1]] : [[BUCKET, 1000, 1]];
      });

      const { candles: result, sources } = await candles(runtime);
      expect(result[0]).toMatchObject({ close: 998, venues: 1 });
      expect(sources).toEqual(['deribit']);
      runtime.dispose();
    });

    it('drops zero-volume bars, where Deribit repeats a stale last trade', async () => {
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return [[BUCKET, 1, 100]];
        if (isDeribit(url)) return [[BUCKET, 77250, 0]];
        return isBinance(url) ? [[BUCKET, 77094, 1]] : new Error('down');
      });

      const { candles: result, sources } = await candles(runtime);
      expect(result[0]!.close).toBe(77094);
      expect(sources).toEqual(['binance']);
      runtime.dispose();
    });

    it('builds Deribit daily bars from 1h so they share the UTC day with other venues', async () => {
      const day = Math.floor(NOW / 86_400_000) * 86_400_000;
      const { runtime } = buildRuntime((url) => {
        if (isUsdtRate(url)) return [[day, 1, 100]];
        if (!isDeribit(url)) return new Error('down');
        expect(url).toContain('resolution=60');
        return [
          [day, 100, 1],
          [day + 3_600_000, 110, 2],
        ];
      });
      const pending = runtime.getCandles('BTC', 86400, 2);
      await settle();
      expect((await pending).candles).toEqual([
        { timestamp: day, open: 100, high: 110, low: 100, close: 110, volume: 3, venues: 1 },
      ]);
      runtime.dispose();
    });

    it('returns no candles rather than inventing them when everything fails', async () => {
      const { runtime } = buildRuntime(() => new Error('down'));
      const pending = runtime.getCandles('BTC', 60, 2);
      await settle();
      // Deribit's fetch retries before giving up.
      await vi.advanceTimersByTimeAsync(1_000);
      await settle();
      await expect(pending).resolves.toEqual({ candles: [], sources: [] });
      runtime.dispose();
    });
  });

  describe('history loading', () => {
    it('does not refetch inside the cache window', async () => {
      const { runtime, fetchImpl } = buildRuntime(() => [[BUCKET, 100, 1]]);
      await candles(runtime);
      const calls = urlsOf(fetchImpl).length;
      await candles(runtime);
      expect(urlsOf(fetchImpl).length).toBe(calls);
      runtime.dispose();
    });

    it('answers at the deadline with what arrived while a slow venue keeps loading', async () => {
      let release: () => void = () => {};
      const stalled = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (isBybit(url)) await stalled;
        return new Response(JSON.stringify(bodyFor(url, [[BUCKET, 100, 1]])));
      }) as unknown as typeof fetch;
      const runtime = new AggregatedSpotRuntime({
        fetchImpl,
        createTransport: (_venue, onEvents) => new FakeTransport(onEvents),
      });

      const first = runtime.getCandles('BTC', 60, 2);
      await settle();
      await vi.advanceTimersByTimeAsync(2_500);
      expect((await first).sources).not.toContain('bybit');

      release();
      await settle();
      expect((await candles(runtime)).sources).toContain('bybit');
      runtime.dispose();
    });

    // Regression: a failure partway through a first load left the tail start at 0, and the retry
    // walked page by page back to 1970.
    it('resumes a failed multi-page load without walking back past what was asked for', async () => {
      const buckets = 2500;
      let binancePages = 0;
      const { runtime, fetchImpl } = buildRuntime((url) => {
        if (!isBinance(url)) return [[BUCKET, 100, 1]];
        binancePages += 1;
        return binancePages === 2 ? new Error('429') : [[BUCKET, 100, 1]];
      });

      const first = runtime.getCandles('BTC', 60, buckets);
      await settle();
      await vi.advanceTimersByTimeAsync(2_500);
      await first;
      expect(binancePages).toBe(2);

      vi.setSystemTime(NOW + 31_000);
      const second = runtime.getCandles('BTC', 60, buckets);
      await settle();
      await vi.advanceTimersByTimeAsync(2_500);
      await second;

      const earliestAllowed = NOW - 60_000 * (buckets + 2);
      const starts = urlsOf(fetchImpl)
        .filter((url) => isBinance(url))
        .map((url) => Number(new URL(url).searchParams.get('startTime')));
      expect(Math.min(...starts)).toBeGreaterThanOrEqual(earliestAllowed);
      expect(binancePages).toBeLessThan(10);
      runtime.dispose();
    });

    // Regression: the live socket's small seed load made a full history request return about 4 bars.
    it('waits out a narrower load in flight and still loads the full range', async () => {
      const old = BUCKET - 100 * MINUTE;
      const { runtime } = buildRuntime((url) => {
        const start = new URL(url).searchParams.get('startTime') ?? new URL(url).searchParams.get('start') ?? new URL(url).searchParams.get('start_timestamp');
        const rows: Row[] = [[BUCKET, 100, 1]];
        if (Number(start) <= old) rows.push([old, 100, 1]);
        return rows;
      });

      runtime.subscribe('BTC', 60, vi.fn());
      const pending = runtime.getCandles('BTC', 60, 200);
      await settle();
      const { candles: result } = await pending;
      expect(result.map((candle) => candle.timestamp)).toContain(old);
      runtime.dispose();
    });

    // Regression: judged by arrival, a partial bar overwrote the complete live bar as it closed.
    it('does not let a response sent before the close overwrite the finished live bar', async () => {
      let answer: (() => void) | null = null;
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (isBinance(url) && answer === null && Date.now() > NOW) {
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
          return new Response(JSON.stringify(bodyFor(url, [[BUCKET, 90, 1]])));
        }
        return new Response(JSON.stringify(bodyFor(url, isUsdtRate(url) ? [[BUCKET, 1, 100]] : [])));
      }) as unknown as typeof fetch;
      const transports = new Map<SpotVenue, FakeTransport>();
      const runtime = new AggregatedSpotRuntime({
        fetchImpl,
        createTransport: (venue, onEvents) => {
          const transport = new FakeTransport(onEvents);
          transports.set(venue, transport);
          return transport;
        },
      });
      runtime.subscribe('BTC', 60, vi.fn());
      await settle();
      transports.get('binance')!.emit([
        { kind: 'bar', symbol: 'BTCUSDT', resolutionSec: 60, bar: { timestamp: BUCKET, open: 100, high: 110, low: 100, close: 105, volume: 9 } },
      ]);

      vi.setSystemTime(BUCKET + MINUTE - 100);
      const refresh = runtime.getCandles('BTC', 60, 2);
      await settle();
      vi.setSystemTime(BUCKET + MINUTE + 200);
      answer!();
      await settle();
      await refresh;

      const after = await runtime.getCandles('BTC', 60, 3);
      expect(after.candles.find((c) => c.timestamp === BUCKET)).toMatchObject({ high: 110, close: 105, volume: 9 });
      runtime.dispose();
    });
  });

  describe('live', () => {
    const quietHistory: RowsFor = (url) => (isUsdtRate(url) ? [[BUCKET, 1, 100]] : []);
    const binanceBar = (close: number, volume = 1, timestamp = BUCKET): SpotStreamEvent => ({
      kind: 'bar',
      symbol: 'BTCUSDT',
      resolutionSec: 60,
      bar: { timestamp, open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume },
    });

    it('subscribes each venue, including the USDT rate, and throttles pushes', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const received: { close: number; volume: number }[] = [];
      runtime.subscribe('BTC', 60, (candle) => received.push(candle));
      await settle();

      expect(transports.get('binance')!.added).toEqual(['btcusdt@kline_1m', 'usdcusdt@kline_1m']);
      expect(transports.get('bybit')!.added).toEqual(['kline.1.BTCUSDT']);
      expect(transports.get('deribit')!.added).toEqual(['ticker.BTC_USDC.agg2']);

      transports.get('binance')!.emit([binanceBar(100, 2)]);
      transports.get('binance')!.emit([binanceBar(101, 3)]);
      expect(received).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(250);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ close: 101, volume: 3 });
      runtime.dispose();
    });

    it('builds Deribit bars from book mids on the subscribed resolution', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const received: { open: number; close: number }[] = [];
      runtime.subscribe('BTC', 60, (candle) => received.push(candle));
      await settle();

      transports.get('deribit')!.emit([
        { kind: 'tick', symbol: 'BTC_USDC', timestamp: BUCKET + 1000, price: 100, size: 0 },
        { kind: 'tick', symbol: 'BTC_USDC', timestamp: BUCKET + 2000, price: 102, size: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(250);
      expect(received.at(-1)).toMatchObject({ open: 100, close: 102 });
      runtime.dispose();
    });

    it('rolls Deribit up to 4h from its 1h ticks', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const received: { close: number }[] = [];
      runtime.subscribe('BTC', 14400, (candle) => received.push(candle));
      await settle();

      expect(transports.get('binance')!.added).toContain('btcusdt@kline_4h');
      transports.get('deribit')!.emit([{ kind: 'tick', symbol: 'BTC_USDC', timestamp: NOW, price: 500, size: 0 }]);
      await vi.advanceTimersByTimeAsync(250);
      expect(received.at(-1)).toMatchObject({ close: 500 });
      runtime.dispose();
    });

    it('sends nothing when the aggregate did not change', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const listener = vi.fn();
      runtime.subscribe('BTC', 60, listener);
      await settle();

      transports.get('binance')!.emit([binanceBar(100)]);
      await vi.advanceTimersByTimeAsync(250);
      const calls = listener.mock.calls.length;
      transports.get('binance')!.emit([binanceBar(100)]);
      await vi.advanceTimersByTimeAsync(250);
      expect(listener.mock.calls.length).toBe(calls);
      runtime.dispose();
    });

    it('ignores a zero-volume stream bar, like history does', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const listener = vi.fn();
      runtime.subscribe('BTC', 60, listener);
      await settle();

      transports.get('binance')!.emit([binanceBar(100, 0)]);
      await vi.advanceTimersByTimeAsync(250);
      expect(listener).not.toHaveBeenCalled();
      runtime.dispose();
    });

    // Regression: pushes began from whatever had streamed so far, collapsing the forming candle.
    it('holds pushes until the forming bar history and USDT rate are in', async () => {
      let release: () => void = () => {};
      const stalled = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transports = new Map<SpotVenue, FakeTransport>();
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        await stalled;
        return new Response(JSON.stringify(bodyFor(url, [[BUCKET, isUsdtRate(url) ? 1 : 100, 5]])));
      }) as unknown as typeof fetch;
      const runtime = new AggregatedSpotRuntime({
        fetchImpl,
        createTransport: (venue, onEvents) => {
          const transport = new FakeTransport(onEvents);
          transports.set(venue, transport);
          return transport;
        },
      });
      const received: { volume: number }[] = [];
      runtime.subscribe('BTC', 60, (candle) => received.push(candle));
      await settle();

      transports.get('deribit')!.emit([{ kind: 'tick', symbol: 'BTC_USDC', timestamp: NOW, price: 100, size: 0 }]);
      await vi.advanceTimersByTimeAsync(250);
      expect(received).toHaveLength(0);

      release();
      await settle(250);
      expect(received.at(-1)).toMatchObject({ volume: 15 });
      runtime.dispose();
    });

    // Regression: a viewer joining an unchanged market got nothing until the price moved.
    it('gives a viewer joining an existing subscription the current candle straight away', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      runtime.subscribe('BTC', 60, vi.fn());
      await settle();
      transports.get('binance')!.emit([binanceBar(101)]);
      await vi.advanceTimersByTimeAsync(250);

      const late = vi.fn();
      runtime.subscribe('BTC', 60, late);
      await vi.advanceTimersByTimeAsync(250);
      expect(late).toHaveBeenCalledWith(expect.objectContaining({ timestamp: BUCKET, close: 101 }));
      runtime.dispose();
    });

    it('shares venue topics between subscribers and releases them after the linger', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const stopFirst = runtime.subscribe('BTC', 60, vi.fn());
      const stopSecond = runtime.subscribe('BTC', 60, vi.fn());
      const stopOther = runtime.subscribe('BTC_USDC', 60, vi.fn());
      await settle();
      const bybit = transports.get('bybit')!;
      expect(bybit.added).toEqual(['kline.1.BTCUSDT']);

      stopFirst();
      stopSecond();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bybit.removed).toEqual([]);

      stopOther();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(bybit.removed).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(bybit.removed).toEqual(['kline.1.BTCUSDT']);
      runtime.dispose();
    });

    it('keeps the streams when a viewer returns inside the linger', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const stop = runtime.subscribe('BTC', 60, vi.fn());
      await settle();
      stop();
      await vi.advanceTimersByTimeAsync(30_000);
      runtime.subscribe('BTC', 60, vi.fn());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transports.get('bybit')!.removed).toEqual([]);
      runtime.dispose();
    });

    it('disposes every transport', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      runtime.subscribe('BTC', 60, vi.fn());
      await settle();
      runtime.dispose();
      expect([...transports.values()].every((transport) => transport.disposed)).toBe(true);
    });
  });
});

const bar = (open: number, high: number, low: number, close: number, volume = 1): VenueBar => ({
  timestamp: 0,
  open,
  high,
  low,
  close,
  volume,
});

describe('weightedMedian', () => {
  it('takes the middle value', () => {
    const entries = [1, 2, 3].map((value) => ({ value, weight: 1 }));
    expect(weightedMedian(entries)).toBe(2);
  });

  it('averages the neighbours when the weight splits evenly', () => {
    const entries = [1, 3].map((value) => ({ value, weight: 1 }));
    expect(weightedMedian(entries)).toBe(2);
  });

  it('lets a double-weighted entry pull the result', () => {
    expect(
      weightedMedian([
        { value: 1, weight: 1 },
        { value: 2, weight: 2 },
        { value: 3, weight: 1 },
        { value: 4, weight: 1 },
      ]),
    ).toBe(2);
  });
});

describe('aggregateBars', () => {
  it('sums volume and counts venues', () => {
    const candle = aggregateBars(1000, [
      { bar: bar(100, 110, 90, 105, 2), weight: 1 },
      { bar: bar(101, 111, 91, 106, 3), weight: 1 },
      { bar: bar(102, 112, 92, 107, 5), weight: 1 },
    ]);
    expect(candle).toEqual({
      timestamp: 1000,
      open: 101,
      high: 111,
      low: 91,
      close: 106,
      volume: 10,
      venues: 3,
    });
  });

  it('ignores a single venue printing a bad wick', () => {
    const candle = aggregateBars(0, [
      { bar: bar(100, 101, 99, 100), weight: 1 },
      { bar: bar(100, 101, 99, 100), weight: 1 },
      { bar: bar(100, 9000, 1, 100), weight: 1 },
    ]);
    expect(candle?.high).toBe(101);
    expect(candle?.low).toBe(99);
  });

  it('keeps a valid candle however the venues disagree', () => {
    const candle = aggregateBars(0, [
      { bar: bar(100, 120, 95, 96), weight: 2 },
      { bar: bar(110, 111, 104, 105), weight: 1 },
      { bar: bar(90, 130, 89, 129), weight: 1 },
      { bar: bar(105, 106, 80, 81), weight: 1 },
    ])!;
    expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
    expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
  });

  it('returns null with no venues', () => {
    expect(aggregateBars(0, [])).toBeNull();
  });
});

describe('scaleBar', () => {
  it('converts prices and leaves base volume alone', () => {
    expect(scaleBar(bar(100, 200, 50, 150, 7), 0.5)).toEqual({
      timestamp: 0,
      open: 50,
      high: 100,
      low: 25,
      close: 75,
      volume: 7,
    });
  });
});

describe('applyTick', () => {
  it('starts a bar from the first tick, then extends it', () => {
    const first = applyTick(undefined, 60_000, 100, 1);
    expect(first).toEqual({ timestamp: 60_000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
    expect(applyTick(first, 60_000, 90, 2)).toEqual({
      timestamp: 60_000,
      open: 100,
      high: 100,
      low: 90,
      close: 90,
      volume: 3,
    });
  });
});

describe('mergeFormingBar', () => {
  it('takes the true open and range from REST but keeps the live close', () => {
    expect(mergeFormingBar(bar(105, 106, 104, 105.5, 1), bar(100, 107, 99, 103, 9))).toEqual({
      timestamp: 0,
      open: 100,
      high: 107,
      low: 99,
      close: 105.5,
      volume: 9,
    });
  });
});
