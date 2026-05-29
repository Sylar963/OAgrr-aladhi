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
