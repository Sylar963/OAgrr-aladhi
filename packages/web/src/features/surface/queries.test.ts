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
