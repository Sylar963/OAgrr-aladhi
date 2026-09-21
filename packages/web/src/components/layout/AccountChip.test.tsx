import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const accountSession = {
  status: 'signed_out' as 'signed_out' | 'loading' | 'ready',
  userId: null as string | null,
  accountId: null as string | null,
  error: null,
  endSession: vi.fn(async () => {}),
};

vi.mock('@clerk/react', () => ({
  SignInButton: ({ children }: { children?: ReactElement }) => (
    <div data-testid="sign-in-button">{children ?? 'Sign in'}</div>
  ),
}));

vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => accountSession,
}));

vi.mock('@lib/venue-connections-api', () => ({
  connectVenue: vi.fn(),
  disconnectVenue: vi.fn(),
}));

import { useAppStore } from '@stores/app-store';
import AccountChip from './AccountChip';

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe('AccountChip', () => {
  afterEach(() => {
    cleanup();
    accountSession.status = 'signed_out';
    accountSession.accountId = null;
    accountSession.userId = null;
    useAppStore.getState().clearAccountSession();
  });

  it('shows sign-in without loading venue configuration when signed out', () => {
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByTestId('sign-in-button')).toBeDefined();
    expect(screen.queryByText('Venue API keys')).toBeNull();
  });

  it('shows account controls only after the account is ready', () => {
    accountSession.status = 'ready';
    accountSession.accountId = 'acct_1';
    accountSession.userId = 'user_1';
    useAppStore.getState().activateAccountSession('acct_1', ['derive']);

    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /acct acct_1/i }));

    expect(screen.getByText('Venue API keys')).toBeDefined();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined();
    expect(screen.getByText('Derive')).toBeDefined();
  });

  it('does not expose venue controls while an account is loading', () => {
    accountSession.status = 'loading';
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /account loading/i }));
    expect(screen.queryByText('Venue API keys')).toBeNull();
  });
});
