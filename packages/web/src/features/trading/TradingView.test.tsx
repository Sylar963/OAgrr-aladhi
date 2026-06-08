import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./PaperTraderPanel', () => ({ default: () => <div data-testid="paper-panel" /> }));
vi.mock('@features/funded', () => ({
  ChallengePanel: () => <div data-testid="challenge-panel" />,
  useFundedRuns: () => ({ data: { runs: [] }, isLoading: false, isError: false }),
  useFundedRun: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock('./ThalexLivePanel', () => ({ default: () => <div data-testid="thalex-panel" /> }));
vi.mock('@features/portfolio', () => ({ venueStatus: vi.fn(async () => ({ connected: false })) }));
vi.mock('./hooks/usePaperWs', () => ({ usePaperWs: () => 'live' }));
vi.mock('./hooks/queries', () => ({
  usePaperAccount: () => ({ data: { isInitialized: true, label: 'P', initialCashUsd: 1000 } }),
  useOverview: () => ({ data: undefined }),
  useInitPaperAccount: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useAppStore } from '@stores/app-store';
import TradingView from './TradingView';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('TradingView shell', () => {
  afterEach(() => {
    cleanup();
    useAppStore.setState({ activeContext: { kind: 'paper' } });
  });

  it('renders the paper panel for the paper context', () => {
    useAppStore.setState({ activeContext: { kind: 'paper' } });
    render(wrap(<TradingView />));
    expect(screen.getByTestId('paper-panel')).toBeDefined();
  });

  it('renders the challenge panel for the challenge context', () => {
    useAppStore.setState({ activeContext: { kind: 'challenge', runId: 'run_1' } });
    render(wrap(<TradingView />));
    expect(screen.getByTestId('challenge-panel')).toBeDefined();
  });

  it('renders the thalex panel for the thalex context', () => {
    useAppStore.setState({ activeContext: { kind: 'thalex' } });
    render(wrap(<TradingView />));
    expect(screen.getByTestId('thalex-panel')).toBeDefined();
  });
});
