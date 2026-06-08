import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('./hooks/queries', () => ({
  useTrades: () => ({ data: { trades: [] } }),
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
  afterEach(() => cleanup());

  it('renders the paper workspace with no open trades', () => {
    render(wrap(<PaperTraderPanel selectedTradeId={null} setSelectedTradeId={vi.fn()} />));
    expect(screen.getByText('Open trades')).toBeDefined();
    expect(screen.getByText('No open trades. Send a strategy from Builder.')).toBeDefined();
  });
});
