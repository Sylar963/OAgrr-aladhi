import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from '@lib/http';
import * as tradfiHttp from '@lib/tradfi-http';
import { useSurface } from './queries';

afterEach(() => vi.restoreAllMocks());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useSurface', () => {
  it('reads the TradFi service for the tradfi market', async () => {
    const tradfi = vi.spyOn(tradfiHttp, 'tradfiFetchJson').mockResolvedValue({ underlying: 'SPY' });
    const crypto = vi.spyOn(http, 'fetchJson');
    const { result } = renderHook(() => useSurface('SPY', ['tastytrade'], 'tradfi'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(tradfi).toHaveBeenCalledWith('/surface?underlying=SPY');
    expect(crypto).not.toHaveBeenCalled();
  });

  it('keeps the crypto server request for the crypto market', async () => {
    const crypto = vi.spyOn(http, 'fetchJson').mockResolvedValue({ underlying: 'BTC' });
    const { result } = renderHook(() => useSurface('BTC', ['deribit']), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(crypto).toHaveBeenCalledWith('/surface?underlying=BTC&venues=deribit');
  });
});

describe('useSurface placeholder data', () => {
  it('does not show the previous ticker\'s surface while the new one loads', async () => {
    let resolveQqq: (v: unknown) => void = () => {};
    vi.spyOn(tradfiHttp, 'tradfiFetchJson').mockImplementation(async (path: string) =>
      path.includes('SPY') ? { underlying: 'SPY' } : new Promise((r) => { resolveQqq = r; }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stableWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result, rerender } = renderHook(
      ({ u }: { u: string }) => useSurface(u, ['tastytrade'], 'tradfi'),
      { wrapper: stableWrapper, initialProps: { u: 'SPY' } },
    );
    await waitFor(() => expect(result.current.data?.underlying).toBe('SPY'));
    rerender({ u: 'QQQ' });
    expect(result.current.data).toBeUndefined();
    resolveQqq({ underlying: 'QQQ' });
    await waitFor(() => expect(result.current.data?.underlying).toBe('QQQ'));
  });
});
