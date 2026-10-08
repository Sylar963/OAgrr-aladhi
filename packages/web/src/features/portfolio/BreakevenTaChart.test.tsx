import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const series = {
  setData: vi.fn(),
  createPriceLine: vi.fn((options: { price: number }) => options),
  removePriceLine: vi.fn(),
  applyOptions: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: {},
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  createChart: () => ({ addSeries: () => series, remove: () => {}, timeScale: () => ({ fitContent: () => {} }) }),
}));

const SPOT = { BTC: 80_000, ETH: 2_000 } as const;
const fetchJson = vi.fn(async (path: string) => {
  const url = new URL(path, 'http://x');
  const coin = (url.searchParams.get('currency') ?? url.searchParams.get('underlying')) as keyof typeof SPOT;
  const spot = SPOT[coin];
  if (url.pathname === '/expiries') return { expiries: ['2026-10-23', '2026-11-06'] };
  if (url.pathname === '/spot-candles') {
    return { currency: coin, resolution: 3600, count: 1, candles: [{ timestamp: 1, open: spot, high: spot, low: spot, close: spot }] };
  }
  const quote = (mid: number) => ({ venues: { deribit: { mid } }, bestIv: null, bestVenue: null });
  return {
    underlying: coin,
    expiry: url.searchParams.get('expiry'),
    expiryTs: null,
    dte: 15,
    stats: { indexPriceUsd: spot, forwardPriceUsd: null, atmStrike: spot },
    strikes: [0.75, 1, 1.25].map((m) => ({ strike: spot * m, call: quote(spot * 0.02), put: quote(spot * 0.02) })),
    gex: [],
  };
});

vi.mock('@lib/http', () => ({ fetchJson: (path: string) => fetchJson(path) }));

const { default: BreakevenTaChart } = await import('./BreakevenTaChart');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

function lastCandleClose(): number | undefined {
  const calls = series.setData.mock.calls as unknown as Array<[Array<{ close: number }>]>;
  return calls.at(-1)?.[0][0]?.close;
}

describe('BreakevenTaChart', () => {
  it('preloads both underlyings so a switch never shows the other coin', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-08T08:00:00Z'), toFake: ['Date'] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (underlying: 'BTC' | 'ETH') => (
      <QueryClientProvider client={client}>
        <BreakevenTaChart underlying={underlying} onUnderlyingChange={() => {}} portfolioUnderlying={null} portfolioBreakEvensUsd={[]} />
      </QueryClientProvider>
    );
    const { rerender } = render(view('BTC'));

    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(lastCandleClose()).toBe(80_000));
    const fetchesBeforeSwitch = fetchJson.mock.calls.length;
    expect(fetchJson.mock.calls.some(([p]) => p.includes('/chains?underlying=ETH'))).toBe(true);

    act(() => rerender(view('ETH')));

    expect(lastCandleClose()).toBe(2_000);
    const prices = series.createPriceLine.mock.calls.slice(-4).map(([o]) => o.price);
    expect(Math.max(...prices)).toBeLessThan(5_000);
    expect(fetchJson.mock.calls.length).toBe(fetchesBeforeSwitch);
    vi.useRealTimers();
  });
});
