import type { OptionsActivity, TradfiAnalyticsResponse } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TradfiAnalyticsView from './TradfiAnalyticsView';

vi.mock('./queries', () => ({
  useTradfiUnderlyings: () => ({ data: { underlyings: ['SPX', 'SPY'] } }),
}));

const EXPIRIES = ['2026-11-20', '2026-12-18'];
const NOW = Date.now();
const fetchMock = vi.fn<typeof fetch>();

function activity(multiplier = 1): OptionsActivity {
  const call = {
    contracts: multiplier,
    volumeObserved: multiplier,
    oiObserved: multiplier,
    volume: 10 * multiplier,
    openInterest: 50 * multiplier,
    volumeNotionalUsd: 100_000 * multiplier,
    oiNotionalUsd: 500_000 * multiplier,
  };
  return {
    call,
    put: { ...call, volume: 20 * multiplier, volumeNotionalUsd: 200_000 * multiplier },
    putCallVolumeRatio: 2,
    putCallOiRatio: 1,
  };
}

function response(underlying: string, expiry: string | null): TradfiAnalyticsResponse {
  const expiries = expiry ? [expiry] : EXPIRIES;
  return {
    underlying,
    asOf: NOW,
    sessionDate: '2026-11-17',
    lastVolumeAt: NOW,
    lastOiAt: NOW,
    spot: 100,
    streaming: true,
    expiries: EXPIRIES,
    deferredExpiries: [],
    summary: activity(expiries.length),
    byExpiry: expiries.map((e) => ({ expiry: e, dte: 10, ...activity() })),
    byStrike: [{ strike: 100, ...activity(expiries.length) }],
    cells: expiries.map((e) => ({ expiry: e, strike: 100, ...activity() })),
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <TradfiAnalyticsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppStore.setState({ tradfiUnderlying: 'SPX' });
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const underlying = url.searchParams.get('underlying')!;
    const body = url.pathname.endsWith('/parity')
      ? {
          underlying,
          expiry: url.searchParams.get('expiry'),
          asOf: NOW,
          streaming: true,
          deferred: false,
          europeanConsistency: underlying === 'SPX',
          maxQuoteAgeMs: 1_200_000,
          maxQuoteSkewMs: 30_000,
          rows: [],
        }
      : response(underlying, url.searchParams.get('expiry'));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  useAppStore.setState({ tradfiUnderlying: '' });
});

it('renders session analytics and explains the non-circular pricing benchmark', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Options analytics' })).not.toBeNull();
  expect(screen.getByText(/^Volume session: 2026-11-17/)).not.toBeNull();
  expect(
    await screen.findByText(
      /Each interior strike is compared with interpolated neighboring strikes, excluding itself/,
    ),
  ).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Strike × expiry' })).not.toBeNull();
  expect(screen.getByText(/Independent-reference parity is unavailable/)).not.toBeNull();
});

it('filters the request and pricing expiry when selecting a tenor, and switches display units', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Options analytics' });
  fireEvent.change(screen.getByLabelText('Expiry', { exact: true }), {
    target: { value: EXPIRIES[1] },
  });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/analytics?underlying=SPX&expiry=2026-12-18'),
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Pricing expiry') as HTMLSelectElement).value).toBe(EXPIRIES[1]),
  );
  fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'usd' } });
  expect(screen.getByText(/USD notional = contracts × multiplier/)).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Measure'), { target: { value: 'oi' } });
  expect((screen.getByLabelText('Measure') as HTMLSelectElement).value).toBe('oi');
});

it('clears the previous ticker and expiry instead of showing them under the new ticker', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Options analytics' });
  fireEvent.change(screen.getByLabelText('Expiry', { exact: true }), {
    target: { value: EXPIRIES[1] },
  });
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('expiry=2026-12-18'))).toBe(
      true,
    ),
  );
  useAppStore.getState().setTradfiUnderlying('SPY');
  await screen.findByText('SPY / TRADFI');
  expect((screen.getByLabelText('Expiry', { exact: true }) as HTMLSelectElement).value).toBe('');
  expect(screen.queryByText('SPX / TRADFI')).toBeNull();
  expect(await screen.findByText(/early exercise is not modeled/)).not.toBeNull();
});

it('reports API failures without rendering sample or previous data', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
  mount();
  expect(await screen.findByText(/TradFi API error: 500/)).not.toBeNull();
  expect(screen.queryByRole('heading', { name: 'Activity by tenor' })).toBeNull();
});
