import { describe, it, expect, vi, afterEach } from 'vitest';
import { tradfiKeys, fetchTradfiChain } from './queries';

afterEach(() => vi.unstubAllGlobals());

describe('tradfi queries', () => {
  it('builds stable query keys', () => {
    expect(tradfiKeys.chain('AAPL', '2026-06-17')).toEqual(['tradfi-chain', 'AAPL', '2026-06-17']);
  });

  it('fetchTradfiChain calls /chains with underlying+expiry', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ underlying: 'AAPL' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchTradfiChain('AAPL', '2026-06-17');
    const url = (fetchMock.mock.calls as unknown as [string[]])[0]![0];
    expect(url).toContain('/chains?underlying=AAPL&expiry=2026-06-17');
  });
});
