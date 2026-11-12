import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRadarPath } from './queries';
import { radarReport, TEST_NOW } from './test-fixtures';

const api = vi.hoisted(() => ({ spot: vi.fn(), cash: vi.fn() }));
vi.mock('@lib/http', () => ({ fetchJson: api.spot }));
vi.mock('@lib/tradfi-http', () => ({ tradfiFetchJson: api.cash }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW);
  api.spot.mockReset().mockResolvedValue({ candles: [] });
  api.cash.mockReset().mockResolvedValue({ candles: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Radar observed price transport', () => {
  it('uses aggregated spot rather than mixing a perpetual trail with the opening spot', async () => {
    const { result } = renderHook(() => useRadarPath('BTC', radarReport().current), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.spot).toHaveBeenCalledWith(
      expect.stringContaining('/spot-candles?currency=BTC&resolution=300'),
    );
    expect(api.spot.mock.calls[0]?.[0]).not.toContain('source=perp');
    expect(result.current.data?.resolutionMs).toBe(300000);
  });

  it('bounds older crypto history with hourly candles', async () => {
    const session = radarReport().current!;
    const older = { ...session, startMs: session.startMs - 14 * 86400000, complete: true };
    const { result } = renderHook(() => useRadarPath('BTC', older), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.spot).toHaveBeenCalledWith(expect.stringContaining('resolution=3600'));
    const url = new URL(api.spot.mock.calls[0]![0], 'https://example.test');
    expect(Number(url.searchParams.get('buckets'))).toBeLessThanOrEqual(3000);
  });

  it('covers thirty trading sessions without fetching a year of five-minute bars', async () => {
    const session = radarReport().current!;
    const older = { ...session, startMs: session.startMs - 40 * 86400000, complete: true };
    api.cash.mockResolvedValue({
      candles: [
        { ts: older.startMs, o: 100, c: 101, synthetic: false },
        { ts: older.startMs + 3600000, o: 101, c: 102, synthetic: true },
      ],
    });
    const { result } = renderHook(() => useRadarPath('SPX', older), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.cash).toHaveBeenCalledWith(
      '/underlying-candles?underlying=SPX&interval=1h&range=max',
    );
    expect(result.current.data?.candles).toHaveLength(1);
    expect(result.current.data?.resolutionMs).toBe(3600000);
  });

  it('rejects invalid price observations at the HTTP boundary', async () => {
    api.spot.mockResolvedValue({ candles: [{ timestamp: TEST_NOW, open: 100, close: -1 }] });
    const { result } = renderHook(() => useRadarPath('BTC', radarReport().current), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('records the request time so network latency cannot complete a forming candle', async () => {
    api.spot.mockImplementation(async () => {
      vi.mocked(Date.now).mockReturnValue(TEST_NOW + 600000);
      return { candles: [{ timestamp: TEST_NOW, open: 100000, close: 100500 }] };
    });
    const { result } = renderHook(() => useRadarPath('BTC', radarReport().current), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.asOfMs).toBe(TEST_NOW);
  });
});
