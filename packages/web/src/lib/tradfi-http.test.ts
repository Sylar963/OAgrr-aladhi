import { describe, it, expect, vi, afterEach } from 'vitest';
import { tradfiFetchJson } from './tradfi-http';

afterEach(() => vi.unstubAllGlobals());

describe('tradfiFetchJson', () => {
  it('fetches against the tradfi base and returns json', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await tradfiFetchJson<{ ok: number }>('/underlyings');
    expect(r.ok).toBe(1);
    expect((fetchMock.mock.calls[0]![0] as string)).toContain('/underlyings');
  });

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'err' })));
    await expect(tradfiFetchJson('/chains')).rejects.toThrow(/500/);
  });
});
