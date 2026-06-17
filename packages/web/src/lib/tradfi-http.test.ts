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
