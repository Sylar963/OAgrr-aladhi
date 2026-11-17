import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activate: vi.fn(async () => ({})),
  connect: vi.fn(async () => ({})),
  disconnect: vi.fn(async () => ({})),
  slots: [
    {
      environment: 'prod',
      configured: true,
      active: true,
      connected: true,
      account: '0xabc',
      kidHint: null,
    },
    {
      environment: 'test',
      configured: true,
      active: false,
      connected: false,
      account: '0xdef',
      kidHint: null,
    },
  ],
}));

vi.mock('@features/portfolio', () => ({
  activateParadexEnvironment: mocks.activate,
  PORTFOLIO_QKEY: { root: (accountId: string) => ['account', accountId, 'portfolio'] },
  useParadexKeySlots: () => ({
    data: { slots: mocks.slots },
    isError: false,
    refetch: async () => ({ data: { slots: mocks.slots } }),
  }),
}));
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ accountId: 'alice', status: 'ready' }),
}));
vi.mock('@lib/venue-connections-api', () => ({
  connectVenue: mocks.connect,
  disconnectVenue: mocks.disconnect,
}));

import ParadexKeyManager from './ParadexKeyManager';

describe('Paradex saved network controls', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  const setup = () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const changed = vi.fn();
    const error = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ParadexKeyManager onChanged={changed} onError={error} />
      </QueryClientProvider>,
    );
    return { invalidate, changed, error };
  };

  it('activates the saved testnet key and refreshes only the current account cache', async () => {
    const { invalidate } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith('test'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 'alice', 'portfolio'] });
  });

  it('saves a separately selected testnet read-only token and clears it after use', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Testnet' }));
    fireEvent.change(screen.getByLabelText('Read-only token'), {
      target: { value: 'secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and use key' }));
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith('paradex', {
        readonlyToken: 'secret-token',
        env: 'test',
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Read-only token') as HTMLInputElement).value).toBe(''),
    );
  });
});
