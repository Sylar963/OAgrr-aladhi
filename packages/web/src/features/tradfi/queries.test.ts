import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as http from '@lib/tradfi-http';
import { tradfiKeys, fetchTradfiChain, useTradfiAllExpiriesGex } from './queries';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

function makeWrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useTradfiAllExpiriesGex', () => {
  it('fetches the aggregated payload', async () => {
    vi.spyOn(http, 'tradfiFetchJson').mockResolvedValue({
      underlying: 'SPX', expiries: ['2026-06-18'], spotPrice: 5000,
      gex: [{ strike: 5000, gexUsdMillions: 12 }],
    });
    const { result } = renderHook(() => useTradfiAllExpiriesGex('SPX'), { wrapper: makeWrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.gex[0]?.gexUsdMillions).toBe(12);
  });
});
