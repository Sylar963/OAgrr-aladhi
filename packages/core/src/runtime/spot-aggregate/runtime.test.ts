import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AggregatedSpotRuntime, type SpotStreamTransport } from './runtime.js';
import type { SpotStreamEvent, SpotVenue } from './venues.js';

const MINUTE = 60_000;
const NOW = 1_793_643_000_000 + 30_000;
const BUCKET = Math.floor(NOW / MINUTE) * MINUTE;

type Row = [timestamp: number, price: number, volume: number];

function venueOf(url: string): SpotVenue {
  if (url.includes('deribit')) return 'deribit';
  if (url.includes('binance')) return 'binance';
  if (url.includes('bybit')) return 'bybit';
  if (url.includes('okx')) return 'okx';
  if (url.includes('gateio')) return 'gateio';
  if (url.includes('coinbase')) return 'coinbase';
  return 'hyperliquid';
}

function bodyFor(url: string, rows: readonly Row[]): unknown {
  const seconds = (ts: number) => Math.floor(ts / 1000);
  switch (venueOf(url)) {
    case 'deribit':
      return {
        result: {
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
    case 'okx':
      return { code: '0', data: rows.map(([ts, p, v]) => [ts, p, p, p, p, v].map(String)) };
    case 'gateio':
      return rows.map(([ts, p, v]) => [seconds(ts), 0, p, p, p, p, v, 'false'].map(String));
    case 'coinbase':
      return rows.map(([ts, p, v]) => [seconds(ts), p, p, p, p, v]);
    case 'hyperliquid':
      return rows.map(([ts, p, v]) => ({
        t: ts,
        s: '@142',
        i: '1m',
        o: String(p),
        h: String(p),
        l: String(p),
        c: String(p),
        v: String(v),
      }));
  }
}

function fakeFetch(rowsFor: (url: string) => readonly Row[] | Error) {
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

function buildRuntime(rowsFor: (url: string) => readonly Row[] | Error) {
  const transports = new Map<SpotVenue, FakeTransport>();
  const runtime = new AggregatedSpotRuntime({
    now: () => Date.now(),
    fetchImpl: fakeFetch(rowsFor),
    flushIntervalMs: 250,
    createTransport: (venue, onEvents) => {
      const transport = new FakeTransport(onEvents);
      transports.set(venue, transport);
      return transport;
    },
  });
  return { runtime, transports };
}

const isUsdtRate = (url: string) => url.includes('USDT-USD');
const isDeribit = (url: string) => url.includes('deribit');

describe('AggregatedSpotRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function candles(runtime: AggregatedSpotRuntime) {
    const pending = runtime.getCandles('BTC', 60, 2);
    await vi.advanceTimersByTimeAsync(0);
    return pending;
  }

  it('converts USDT pairs to USD before taking the median', async () => {
    const { runtime } = buildRuntime((url) => {
      if (isUsdtRate(url)) return [[BUCKET, 0.998, 100]];
      if (url.includes('BTC-USD/') || isDeribit(url) || url.includes('hyperliquid')) return [[BUCKET, 998, 1]];
      return [[BUCKET, 1000, 1]];
    });

    const { candles: result } = await candles(runtime);
    expect(result).toHaveLength(1);
    expect(result[0]!.close).toBeCloseTo(998);
    runtime.dispose();
  });

  it('leaves USDT venues out when no rate is known instead of assuming a dollar', async () => {
    const { runtime } = buildRuntime((url) => {
      if (isUsdtRate(url)) return new Error('rate down');
      if (url.includes('BTC-USD/') || isDeribit(url) || url.includes('hyperliquid')) return [[BUCKET, 998, 1]];
      return [[BUCKET, 1000, 1]];
    });

    const { candles: result, sources } = await candles(runtime);
    expect(result[0]!.close).toBe(998);
    expect(result[0]!.venues).toBe(3);
    expect(sources.sort()).toEqual(['coinbase', 'deribit', 'hyperliquid']);
    runtime.dispose();
  });

  it('sums base volume across venues and counts Binance double only in the median', async () => {
    const { runtime } = buildRuntime((url) => {
      if (isUsdtRate(url)) return [[BUCKET, 1, 100]];
      if (isDeribit(url)) return [[BUCKET, 90, 2]];
      if (url.includes('binance')) return [[BUCKET, 100, 3]];
      return new Error('down');
    });

    const { candles: result } = await candles(runtime);
    expect(result[0]).toMatchObject({ close: 100, volume: 5, venues: 2 });
    runtime.dispose();
  });

  it('drops zero-volume bars, where Deribit repeats a stale last trade', async () => {
    const { runtime } = buildRuntime((url) => {
      if (isUsdtRate(url)) return [[BUCKET, 1, 100]];
      if (isDeribit(url)) return [[BUCKET, 77250, 0]];
      if (url.includes('binance')) return [[BUCKET, 77094, 1]];
      return new Error('down');
    });

    const { candles: result, sources } = await candles(runtime);
    expect(result[0]!.close).toBe(77094);
    expect(sources).toEqual(['binance']);
    runtime.dispose();
  });

  it('survives every other venue failing', async () => {
    const { runtime } = buildRuntime((url) => (isDeribit(url) ? [[BUCKET, 77000, 1]] : new Error('down')));

    const { candles: result, sources } = await candles(runtime);
    expect(result[0]!.close).toBe(77000);
    expect(sources).toEqual(['deribit']);
    runtime.dispose();
  });

  it('returns no candles rather than inventing them when everything fails', async () => {
    const { runtime } = buildRuntime(() => new Error('down'));
    await expect(candles(runtime)).resolves.toEqual({ candles: [], sources: [] });
    runtime.dispose();
  });

  it('answers after the deadline with what has arrived while slow venues keep loading', async () => {
    let release: () => void = () => {};
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('binance')) await stalled;
      const rows: Row[] = isUsdtRate(url) ? [[BUCKET, 1, 100]] : [[BUCKET, url.includes('binance') ? 200 : 100, 1]];
      return new Response(JSON.stringify(bodyFor(url, rows)));
    }) as unknown as typeof fetch;
    const runtime = new AggregatedSpotRuntime({
      fetchImpl,
      createTransport: (_venue, onEvents) => new FakeTransport(onEvents),
    });

    const pending = runtime.getCandles('KAS', 60, 2);
    const first = runtime.getCandles('BTC', 60, 2);
    await vi.advanceTimersByTimeAsync(6_000);
    const { sources } = await first;
    await pending;
    expect(sources).not.toContain('binance');
    release();
    await vi.advanceTimersByTimeAsync(0);
    const { sources: later } = await candles(runtime);
    expect(later).toContain('binance');
    runtime.dispose();
  });

  it('keeps every Gate page inside its point cap, counting both ends', async () => {
    const fetchImpl = fakeFetch(() => []);
    const runtime = new AggregatedSpotRuntime({
      fetchImpl,
      createTransport: (_venue, onEvents) => new FakeTransport(onEvents),
    });
    const pending = runtime.getCandles('BTC', 1800, 2500);
    await vi.advanceTimersByTimeAsync(2_500);
    await pending;
    const pages = vi
      .mocked(fetchImpl)
      .mock.calls.map(([url]) => new URL(String(url)))
      .filter((url) => url.hostname.includes('gateio'))
      .map((url) => (Number(url.searchParams.get('to')) - Number(url.searchParams.get('from'))) / 1800);
    expect(pages.length).toBeGreaterThan(1);
    expect(Math.max(...pages) + 1).toBeLessThanOrEqual(1000);
    runtime.dispose();
  });

  it('builds Deribit daily bars from 1h so they share the UTC day with other venues', async () => {
    const day = Math.floor(NOW / 86_400_000) * 86_400_000;
    const { runtime } = buildRuntime((url) => {
      if (isUsdtRate(url)) return [[day, 1, 100]];
      if (isDeribit(url)) {
        expect(url).toContain('resolution=60');
        return [
          [day, 100, 1],
          [day + 3_600_000, 110, 2],
        ];
      }
      return new Error('down');
    });
    const pending = runtime.getCandles('BTC', 86400, 2);
    await vi.advanceTimersByTimeAsync(0);
    const { candles: result } = await pending;
    expect(result).toEqual([{ timestamp: day, open: 100, high: 110, low: 100, close: 110, volume: 3, venues: 1 }]);
    runtime.dispose();
  });

  it('does not refetch inside the cache window', async () => {
    const fetchImpl = fakeFetch(() => [[BUCKET, 100, 1]]);
    const runtime = new AggregatedSpotRuntime({
      fetchImpl,
      createTransport: (_venue, onEvents) => new FakeTransport(onEvents),
    });
    await candles(runtime);
    const calls = vi.mocked(fetchImpl).mock.calls.length;
    await candles(runtime);
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(calls);
    runtime.dispose();
  });

  describe('live', () => {
    const quietHistory = (url: string): readonly Row[] => (isUsdtRate(url) ? [[BUCKET, 1, 100]] : []);

    it('subscribes every venue and pushes throttled aggregated candles', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const received: { close: number; volume: number }[] = [];
      runtime.subscribe('BTC', 60, (candle) => received.push(candle));
      await vi.advanceTimersByTimeAsync(0);

      expect(transports.get('binance')!.added).toEqual(['btcusdt@kline_1m']);
      expect(transports.get('deribit')!.added).toEqual(['ticker.BTC_USDC.agg2']);
      expect(transports.get('coinbase')!.added).toEqual(['BTC-USD', 'USDT-USD']);

      transports.get('binance')!.emit([
        { kind: 'bar', symbol: 'BTCUSDT', resolutionSec: 60, bar: { timestamp: BUCKET, open: 100, high: 100, low: 100, close: 100, volume: 2 } },
      ]);
      transports.get('binance')!.emit([
        { kind: 'bar', symbol: 'BTCUSDT', resolutionSec: 60, bar: { timestamp: BUCKET, open: 100, high: 101, low: 100, close: 101, volume: 3 } },
      ]);
      expect(received).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(250);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ close: 101, volume: 3 });
      runtime.dispose();
    });

    it('builds trade-driven bars from ticks on the subscribed resolution', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const received: { open: number; close: number; volume: number }[] = [];
      runtime.subscribe('BTC', 60, (candle) => received.push(candle));
      await vi.advanceTimersByTimeAsync(0);

      transports.get('coinbase')!.emit([
        { kind: 'tick', symbol: 'BTC-USD', timestamp: BUCKET + 1000, price: 100, size: 1 },
        { kind: 'tick', symbol: 'BTC-USD', timestamp: BUCKET + 2000, price: 102, size: 2 },
      ]);
      await vi.advanceTimersByTimeAsync(250);
      expect(received.at(-1)).toMatchObject({ open: 100, close: 102, volume: 3 });
      runtime.dispose();
    });

    it('rolls up to 4h from 1h ticks on venues with no native 4h bar', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const received: { close: number }[] = [];
      runtime.subscribe('BTC', 14400, (candle) => received.push(candle));
      await vi.advanceTimersByTimeAsync(0);

      expect(transports.get('okx')!.added).toEqual(['candle4H|BTC-USDT']);
      transports.get('deribit')!.emit([
        { kind: 'tick', symbol: 'BTC_USDC', timestamp: NOW, price: 500, size: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(250);
      expect(received.at(-1)).toMatchObject({ close: 500 });
      runtime.dispose();
    });

    it('sends nothing when the aggregate did not change', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const listener = vi.fn();
      runtime.subscribe('BTC', 60, listener);
      await vi.advanceTimersByTimeAsync(0);

      const frame: SpotStreamEvent = {
        kind: 'bar',
        symbol: 'BTCUSDT',
        resolutionSec: 60,
        bar: { timestamp: BUCKET, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      };
      transports.get('binance')!.emit([frame]);
      await vi.advanceTimersByTimeAsync(250);
      const calls = listener.mock.calls.length;
      transports.get('binance')!.emit([frame]);
      await vi.advanceTimersByTimeAsync(250);
      expect(listener.mock.calls.length).toBe(calls);
      runtime.dispose();
    });

    it('shares venue topics between subscribers and releases them after the linger', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const stopFirst = runtime.subscribe('BTC', 60, vi.fn());
      const stopSecond = runtime.subscribe('BTC', 60, vi.fn());
      const stopOther = runtime.subscribe('BTC_USDC', 60, vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      const binance = transports.get('binance')!;
      expect(binance.added).toEqual(['btcusdt@kline_1m']);

      stopFirst();
      stopSecond();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(binance.removed).toEqual([]);

      stopOther();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(binance.removed).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(binance.removed).toEqual(['btcusdt@kline_1m']);
      runtime.dispose();
    });

    it('keeps the streams when a viewer returns inside the linger', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      const stop = runtime.subscribe('BTC', 60, vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      stop();
      await vi.advanceTimersByTimeAsync(30_000);
      runtime.subscribe('BTC', 60, vi.fn());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transports.get('binance')!.removed).toEqual([]);
      runtime.dispose();
    });

    it('disposes every transport', async () => {
      const { runtime, transports } = buildRuntime(quietHistory);
      runtime.subscribe('BTC', 60, vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      runtime.dispose();
      expect([...transports.values()].every((transport) => transport.disposed)).toBe(true);
    });
  });
});
