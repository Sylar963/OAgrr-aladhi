import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotCandleService, spotCandleCacheTtlMs } from './spot-candles.js';

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
});
