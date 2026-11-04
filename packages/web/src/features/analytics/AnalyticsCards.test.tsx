import { setTestMarket } from '@/test/market-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchJson = vi.fn();
vi.mock('@lib/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/http')>()),
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));
vi.mock('./OiSummary', () => ({ default: () => <div>oi summary</div> }));
vi.mock('./VenueShare', () => ({ default: () => <div>venue share</div> }));

const { OiSummaryWidget, VenueShareWidget } = await import('./AnalyticsCards');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('analytics card widgets', () => {
  afterEach(() => {
    cleanup();
    fetchJson.mockReset();
  });

  it('share one all-expiries request however many cards are open', async () => {
    fetchJson.mockImplementation(async (path: string) =>
      path.startsWith('/expiries') ? { expiries: ['2026-03-27'] } : { strikes: [], stats: {} },
    );
    setTestMarket({ underlying: 'BTC', activeVenues: ['deribit'] });

    render(
      <>
        <OiSummaryWidget />
        <VenueShareWidget />
      </>,
      { wrapper },
    );

    await waitFor(() => expect(screen.getByText('oi summary')).toBeDefined());
    expect(screen.getByText('venue share')).toBeDefined();
    const chainCalls = fetchJson.mock.calls.filter(([path]) => String(path).startsWith('/chains'));
    expect(chainCalls).toHaveLength(1);
  });
});
