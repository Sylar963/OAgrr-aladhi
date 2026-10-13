import { describe, expect, it, vi } from 'vitest';
import { PerpTickerRuntime } from './perp-tickers.js';

function okResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

const payload = {
  retCode: 0,
  result: {
    list: [
      { symbol: 'BTCUSDT', lastPrice: '70000', price24hPcnt: '-0.012' },
      { symbol: 'XAUUSDT', lastPrice: '4180.5', price24hPcnt: '0.003' },
      { symbol: 'DEADUSDT', lastPrice: '0', price24hPcnt: '0' },
    ],
  },
};

describe('PerpTickerRuntime', () => {
  it('fetches every linear ticker in one request and caches within maxAge', async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => okResponse(payload));
    const runtime = new PerpTickerRuntime({ fetchImpl, maxAgeMs: 10_000, now: () => now });

    const [a, b] = await Promise.all([runtime.getSnapshot(), runtime.getSnapshot()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('category=linear');
    expect(a).toBe(b);
    expect(a.tickers.get('XAUUSDT')).toEqual({ symbol: 'XAUUSDT', lastPrice: 4180.5, change24hPct: 0.003 });
    expect(a.tickers.has('DEADUSDT')).toBe(false);

    now += 5_000;
    await runtime.getSnapshot();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 6_000;
    await runtime.getSnapshot();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serves the last good snapshot when a refresh fails, and throws when it never succeeded', async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(payload))
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const runtime = new PerpTickerRuntime({ fetchImpl, maxAgeMs: 1, now: () => now });

    const first = await runtime.getSnapshot();
    now += 10;
    expect(await runtime.getSnapshot()).toBe(first);

    const cold = new PerpTickerRuntime({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 503 }) as Response),
    });
    await expect(cold.getSnapshot()).rejects.toThrow('HTTP 503');
  });
});
