import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpotCandleRange } from './chart-queries';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@lib/http', () => ({ fetchJson }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FLOW historical candle query', () => {
  it('requests the candle covering the start of an unaligned custom range', async () => {
    fetchJson.mockResolvedValue({ currency: 'BTC', resolution: 900, count: 0, candles: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useSpotCandleRange({
          underlying: 'BTC',
          resolution: 900,
          range: { start: '2026-11-18T00:02:00.000Z', end: '2026-11-18T00:04:00.000Z' },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URLSearchParams(String(fetchJson.mock.calls[0]?.[0]).split('?')[1]);
    expect(params.get('start')).toBe('2026-11-18T00:00:00.000Z');
    expect(params.get('end')).toBe('2026-11-18T00:04:00.000Z');
    client.clear();
  });
});
