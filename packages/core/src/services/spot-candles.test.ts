import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotCandleService, downsampleCandles, spotCandleCacheTtlMs } from './spot-candles.js';

function makeKlinesPayload(closes: number[]): unknown {
  const ticks = closes.map((_, i) => 1_700_000_000_000 + i * 60_000);
  return {
    result: {
      status: 'ok',
      ticks,
      open: closes,
      high: closes,
      low: closes,
      close: closes,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SpotCandleService — stale fallback on upstream failure', () => {
  let svc: SpotCandleService;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    svc = new SpotCandleService();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    svc.dispose();
    vi.unstubAllGlobals();
  });

  it('serves cached candles past TTL when the next upstream fetch fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(makeKlinesPayload([100, 101, 102])))
      .mockRejectedValue(new Error('Deribit 502'));

    // First call populates the cache.
    const first = await svc.getCandles('BTC', 3600, 24);
    expect(first).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Force the cache entry to look expired so the next call must hit the
    // network. Every retry attempt fails — we expect the service to fall back
    // to the cached payload after exhausting the bounded retry budget.
    const cache = (svc as unknown as { cache: Map<string, { fetchedAt: number; candles: unknown[] }> }).cache;
    const key = 'BTC|3600|24';
    const entry = cache.get(key)!;
    cache.set(key, { ...entry, fetchedAt: Date.now() - 120_000 });

    const stale = await svc.getCandles('BTC', 3600, 24);
    expect(stale).toEqual(first);
    // 1 warm fetch + 3 exhausted retry attempts.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('throws when upstream fails and the cache is cold', async () => {
    fetchSpy.mockRejectedValue(new Error('Deribit 502'));

    await expect(svc.getCandles('BTC', 3600, 24)).rejects.toThrow('Deribit 502');
    // Cold cache exhausts the full retry budget before giving up.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('retries a transient network failure then succeeds', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(jsonResponse(makeKlinesPayload([200, 201])));

    const candles = await svc.getCandles('BTC', 3600, 24);
    expect(candles).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx response then succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(makeKlinesPayload([300])));

    const candles = await svc.getCandles('BTC', 3600, 24);
    expect(candles).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a deterministic 4xx', async () => {
    fetchSpy.mockResolvedValue(new Response('bad', { status: 400 }));

    await expect(svc.getCandles('BTC', 3600, 24)).rejects.toThrow('Deribit klines 400');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses shorter cache TTLs for shorter resolutions', () => {
    expect(spotCandleCacheTtlMs(300)).toBe(15_000);
    expect(spotCandleCacheTtlMs(1800)).toBe(30_000);
    expect(spotCandleCacheTtlMs(3600)).toBe(60_000);
    expect(spotCandleCacheTtlMs(14400)).toBe(120_000);
    expect(spotCandleCacheTtlMs(86400)).toBe(300_000);
  });

  it('serves the 4h tier by fetching 1h and downsampling to 4h buckets', async () => {
    const hourMs = 3_600_000;
    const t0 = Math.floor(1_700_000_000_000 / 14_400_000) * 14_400_000; // 4h-grid start
    const ticks = Array.from({ length: 8 }, (_, i) => t0 + i * hourMs);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        result: {
          status: 'ok',
          ticks,
          open: [10, 11, 12, 13, 20, 21, 22, 23],
          high: [15, 16, 17, 18, 25, 26, 27, 28],
          low: [9, 8, 11, 12, 19, 18, 21, 22],
          close: [11, 12, 13, 14, 21, 22, 23, 24],
        },
      }),
    );

    const candles = await svc.getCandles('BTC', 14400, 2);

    // The 4h tier must request Deribit at 1h ('60'), never the rejected '240'.
    const requestedUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain('resolution=60');
    expect(requestedUrl).not.toContain('resolution=240');

    // 8 hourly bars collapse into 2 four-hour buckets on the UTC 4h grid.
    expect(candles).toEqual([
      { timestamp: t0, open: 10, high: 18, low: 8, close: 14 },
      { timestamp: t0 + 4 * hourMs, open: 20, high: 28, low: 18, close: 24 },
    ]);
  });

  it('downsampleCandles buckets by the grid and is order-independent', () => {
    const hourMs = 3_600_000;
    const input = [
      { timestamp: 3 * hourMs, open: 13, high: 18, low: 12, close: 14 },
      { timestamp: 0, open: 10, high: 15, low: 9, close: 11 },
      { timestamp: 1 * hourMs, open: 11, high: 16, low: 8, close: 12 },
    ];
    expect(downsampleCandles(input, 14_400_000)).toEqual([
      { timestamp: 0, open: 10, high: 18, low: 8, close: 14 },
    ]);
  });

  it('downsampleCandles returns empty for empty input', () => {
    expect(downsampleCandles([], 14_400_000)).toEqual([]);
  });
});

describe('SpotCandleService — Hyperliquid (HYPE)', () => {
  let svc: SpotCandleService;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    svc = new SpotCandleService();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    svc.dispose();
    vi.unstubAllGlobals();
  });

  // Hyperliquid sends a flat array with OHLC as strings — mirror that exactly
  // so the test fails if the schema ever stops coercing.
  function hyperliquidResponse(
    rows: Array<{ t: number; o: number; h: number; l: number; c: number }>,
  ): Response {
    const body = rows.map((r) => ({
      t: r.t,
      T: r.t + 3_599_999,
      s: 'HYPE',
      i: '1h',
      o: String(r.o),
      h: String(r.h),
      l: String(r.l),
      c: String(r.c),
      v: '123.4',
      n: 42,
    }));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('coerces Hyperliquid string OHLC into numbers and maps t→timestamp', async () => {
    fetchSpy.mockResolvedValueOnce(
      hyperliquidResponse([
        { t: 1_700_000_000_000, o: 71.1, h: 72.5, l: 70.7, c: 70.9 },
        { t: 1_700_003_600_000, o: 70.9, h: 73.0, l: 70.4, c: 72.2 },
      ]),
    );

    const candles = await svc.getCandles('HYPE', 3600, 24);

    expect(candles).toEqual([
      { timestamp: 1_700_000_000_000, open: 71.1, high: 72.5, low: 70.7, close: 70.9 },
      { timestamp: 1_700_003_600_000, open: 70.9, high: 73.0, low: 70.4, close: 72.2 },
    ]);
    expect(typeof candles[0]!.open).toBe('number');

    // Hits Hyperliquid's POST /info, not Deribit.
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.hyperliquid.xyz/info');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: 'candleSnapshot',
      req: { coin: 'HYPE', interval: '1h' },
    });
  });

  it('requests the native 4h interval for the 14400 tier (no downsampling)', async () => {
    fetchSpy.mockResolvedValueOnce(
      hyperliquidResponse([
        { t: 1_700_000_000_000, o: 10, h: 15, l: 9, c: 11 },
        { t: 1_700_014_400_000, o: 11, h: 16, l: 8, c: 12 },
      ]),
    );

    const candles = await svc.getCandles('HYPE', 14400, 2);

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string).req.interval).toBe('4h');
    // Bars pass through 1:1 — no 4h bucket collapsing like the Deribit path.
    expect(candles).toHaveLength(2);
  });

  it('retries a transient Hyperliquid failure then succeeds', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(
        hyperliquidResponse([{ t: 1_700_000_000_000, o: 1, h: 1, l: 1, c: 1 }]),
      );

    const candles = await svc.getCandles('HYPE', 3600, 24);
    expect(candles).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
