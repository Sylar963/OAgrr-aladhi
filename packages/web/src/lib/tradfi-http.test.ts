import { describe, it, expect, vi, afterEach } from 'vitest';
import { tradfiFetchJson, tradfiWsUrl } from './tradfi-http';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('tradfiFetchJson', () => {
  it('fetches against the tradfi base and returns json', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await tradfiFetchJson<{ ok: number }>('/underlyings');
    expect(r.ok).toBe(1);
    expect(((fetchMock.mock.calls as unknown as [string[]])[0]![0])).toContain('/underlyings');
  });

  it('retries a warming-up 503 until the service is ready', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'catalog not loaded' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
      vi.stubGlobal('fetch', fetchMock);
      const pending = tradfiFetchJson<{ ok: number }>('/surface?underlying=SPY');
      await vi.advanceTimersByTimeAsync(1500);
      expect((await pending).ok).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast on a 503 that is not a warm-up state', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 503, json: async () => ({ error: 'no market data yet' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(tradfiFetchJson('/chains?underlying=SPY&expiry=2026-10-16')).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'err' })));
    await expect(tradfiFetchJson('/chains')).rejects.toThrow(/500/);
  });
});

describe('tradfiWsUrl', () => {
  it('derives a ws URL from the default relative base against the current host', () => {
    vi.stubEnv('VITE_TRADFI_API_BASE', '');
    vi.stubEnv('VITE_TRADFI_WS_URL', '');
    expect(tradfiWsUrl('/ws/underlying-candles?underlying=SPX&interval=5m')).toBe(
      `ws://${window.location.host}/tradfi-api/ws/underlying-candles?underlying=SPX&interval=5m`,
    );
  });

  it('uses wss for an absolute https base and preserves the path + query', () => {
    vi.stubEnv('VITE_TRADFI_WS_URL', '');
    vi.stubEnv('VITE_TRADFI_API_BASE', 'https://tradfi.example.com');
    expect(tradfiWsUrl('/ws/underlying-candles?underlying=SPX&interval=5m')).toBe(
      'wss://tradfi.example.com/ws/underlying-candles?underlying=SPX&interval=5m',
    );
  });

  it('honors an explicit VITE_TRADFI_WS_URL override', () => {
    vi.stubEnv('VITE_TRADFI_WS_URL', 'wss://ws.example.com/');
    expect(tradfiWsUrl('/ws/underlying-candles?underlying=SPX')).toBe(
      'wss://ws.example.com/ws/underlying-candles?underlying=SPX',
    );
  });
});
