import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchPortfolioAssistantMemory: vi.fn(),
  forgetPortfolioAssistantMemory: vi.fn(),
  forgetPortfolioAssistantMemoryItem: vi.fn(),
}));

vi.mock('./api', () => api);
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', accountId: 'acct-1' }),
}));

import { PortfolioAssistantMemory } from './PortfolioAssistantMemory';

const MEMORY = {
  items: [
    {
      id: 'mem_aaaaaaaaaaaa',
      text: 'Max loss per new trade is $2,000.',
      category: 'risk_budget' as const,
      sourceThreadId: null,
      updatedAt: 1,
    },
    {
      id: 'mem_bbbbbbbbbbbb',
      text: 'Trades on Thalex.',
      category: 'venues' as const,
      sourceThreadId: null,
      updatedAt: 1,
    },
  ],
  updatedAt: 1,
  lastDistilledAt: 1,
};

function renderMemory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<PortfolioAssistantMemory />, { wrapper });
}

beforeEach(() => {
  api.fetchPortfolioAssistantMemory.mockResolvedValue(MEMORY);
  api.forgetPortfolioAssistantMemory.mockResolvedValue(undefined);
  api.forgetPortfolioAssistantMemoryItem.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('PortfolioAssistantMemory', () => {
  it('lists remembered items with their categories', async () => {
    renderMemory();
    expect(await screen.findByText('Max loss per new trade is $2,000.')).toBeTruthy();
    expect(screen.getByText('Trades on Thalex.')).toBeTruthy();
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.getByText('Venues')).toBeTruthy();
  });

  it('forgets a single item and refetches', async () => {
    renderMemory();
    fireEvent.click(await screen.findByRole('button', { name: 'Forget: Trades on Thalex.' }));
    await waitFor(() =>
      expect(api.forgetPortfolioAssistantMemoryItem).toHaveBeenCalledWith('mem_bbbbbbbbbbbb'),
    );
    await waitFor(() => expect(api.fetchPortfolioAssistantMemory).toHaveBeenCalledTimes(2));
    expect(api.forgetPortfolioAssistantMemory).not.toHaveBeenCalled();
  });

  it('asks for confirmation before forgetting everything', async () => {
    renderMemory();
    fireEvent.click(await screen.findByRole('button', { name: 'Forget all' }));
    expect(api.forgetPortfolioAssistantMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget all' }));
    await waitFor(() => expect(api.forgetPortfolioAssistantMemory).toHaveBeenCalledTimes(1));
  });

  it('shows an empty state', async () => {
    api.fetchPortfolioAssistantMemory.mockResolvedValue({
      items: [],
      updatedAt: null,
      lastDistilledAt: null,
    });
    renderMemory();
    expect(await screen.findByText('Nothing remembered yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forget all' })).toBeNull();
  });
});
