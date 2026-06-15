import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const state = { connected: false, positions: [] as Array<{ legId: string }> };

vi.mock('@features/portfolio', () => ({
  usePortfolioPositions: () => ({ data: { positions: state.positions } }),
  usePortfolioMetrics: () => ({ data: { metrics: null, positions: state.positions } }),
  usePortfolioWs: () => ({ connectionState: 'open', lastSeq: 0, lastError: null }),
  venueStatus: vi.fn(async () => ({ venue: 'thalex', connected: state.connected })),
}));

import ThalexLivePanel from './ThalexLivePanel';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ThalexLivePanel', () => {
  afterEach(() => {
    cleanup();
    state.connected = false;
    state.positions = [];
  });

  it('shows a connect prompt and a Trade-on-Thalex note, with no order-entry control', () => {
    render(wrap(<ThalexLivePanel />));
    expect(screen.getByText(/connect your thalex key/i)).toBeDefined();
    expect(screen.getByText(/trade on thalex/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /place order|buy|sell/i })).toBeNull();
  });

  it('renders read-only positions when connected', () => {
    state.connected = true;
    state.positions = [{ legId: 'leg_1' }];
    render(wrap(<ThalexLivePanel />));
    expect(screen.queryByText(/connect your thalex key/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });
});
