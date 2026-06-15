import { describe, expect, it, vi } from 'vitest';
import { OAuth2TokenManager } from './auth.js';

function fakeFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

const cfg = {
  baseUrl: 'https://api.tastyworks.com',
  clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh',
};

describe('OAuth2TokenManager', () => {
  it('fetches and caches an access token', async () => {
    const fetchImpl = fakeFetch({ access_token: 'AT1', token_type: 'Bearer', expires_in: 900 });
    const mgr = new OAuth2TokenManager(cfg, fetchImpl);
    expect(await mgr.getAccessToken()).toBe('AT1');
    expect(await mgr.getAccessToken()).toBe('AT1');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached
  });

  it('refreshes when near expiry', async () => {
    const fetchImpl = fakeFetch({ access_token: 'AT2', token_type: 'Bearer', expires_in: 30 });
    const mgr = new OAuth2TokenManager(cfg, fetchImpl);
    await mgr.getAccessToken();
    await mgr.getAccessToken(); // 30s < 60s skew -> refetch
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws on non-ok response', async () => {
    const mgr = new OAuth2TokenManager(cfg, fakeFetch({ error: 'invalid_grant' }, false));
    await expect(mgr.getAccessToken()).rejects.toThrow(/oauth/i);
  });

  it('deduplicates concurrent calls into one fetch', async () => {
    const fetchImpl = fakeFetch({ access_token: 'AT3', token_type: 'Bearer', expires_in: 900 });
    const mgr = new OAuth2TokenManager(cfg, fetchImpl);
    const [a, b] = await Promise.all([mgr.getAccessToken(), mgr.getAccessToken()]);
    expect(a).toBe('AT3');
    expect(b).toBe('AT3');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
