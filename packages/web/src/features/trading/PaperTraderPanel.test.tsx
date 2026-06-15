import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const mockUseTrades = vi.fn();

vi.mock('./hooks/queries', () => ({
  useTrades: (...args: unknown[]) => mockUseTrades(...args),
  useTrade: () => ({ data: undefined }),
  useActivity: () => ({ data: { activity: [] } }),
  useAddTradeNote: () => ({ mutate: vi.fn(), isPending: false }),
  useCloseTrade: () => ({ mutate: vi.fn(), isPending: false }),
  useReduceTrade: () => ({ mutate: vi.fn(), isPending: false }),
}));

import PaperTraderPanel from './PaperTraderPanel';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('PaperTraderPanel', () => {
  afterEach(() => {
    cleanup();
    mockUseTrades.mockReset();
  });

  it('renders the paper workspace with no open trades', () => {
    mockUseTrades.mockReturnValue({ data: { trades: [] } });
    render(wrap(<PaperTraderPanel selectedTradeId={null} setSelectedTradeId={vi.fn()} />));
    expect(screen.getByText('Open trades')).toBeDefined();
    expect(screen.getByText('No open trades. Send a strategy from Builder.')).toBeDefined();
  });

  it('auto-selects the first open trade when selectedTradeId is null', () => {
    const firstTradeId = 'trade-abc-1';
    mockUseTrades.mockImplementation((status: string) => {
      if (status === 'open') {
        return {
          data: {
            trades: [
              {
                id: firstTradeId,
                label: 'Test Trade',
                strategyName: 'Straddle',
                netPremiumUsd: -200,
                openLegs: 2,
                totalPnlUsd: 0,
                currentSpotUsd: 65000,
                entrySpotUsd: 65000,
                risk: { delta: 0, gamma: 0, theta: 0, vega: 0 },
              },
            ],
          },
        };
      }
      return { data: { trades: [] } };
    });

    const setSelectedTradeId = vi.fn();
    render(
      wrap(<PaperTraderPanel selectedTradeId={null} setSelectedTradeId={setSelectedTradeId} />),
    );
    expect(setSelectedTradeId).toHaveBeenCalledWith(firstTradeId);
  });
});
