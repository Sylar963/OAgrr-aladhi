import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/queries', () => ({
  FUNDED_QKEY: {
    templates: ['funded', 'templates'],
    runs: ['funded', 'runs'],
    run: ['funded', 'run'],
  },
  useFundedTemplates: () => ({
    data: {
      templates: [
        {
          id: 'tmpl_1',
          name: 'Test 1000',
          routeType: 'test',
          testDepositMinUsd: 100,
          testProfitTargetPct: 0.1,
          testMaxDrawdownPct: 0.3,
          fundedAbc: 1000,
          abcFloorPct: 0.8,
          profitSplitPct: 0.8,
          settlementCadence: 'daily',
          maxRunsPerUser: 3,
        },
      ],
    },
  }),
  useFundedRuns: () => ({ data: { runs: [] } }),
  useFundedRun: () => ({ data: null }),
  useStartRun: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawRun: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FundedView } from './FundedView';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('FundedView', () => {
  afterEach(() => cleanup());

  it('renders the available templates', () => {
    render(wrap(<FundedView />));
    expect(screen.getAllByText('Test 1000').length).toBeGreaterThan(0);
  });

  it('renders a start control', () => {
    render(wrap(<FundedView />));
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
