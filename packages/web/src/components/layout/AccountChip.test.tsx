import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const accountSession = {
  status: 'signed_out' as 'signed_out' | 'loading' | 'ready',
  userId: null as string | null,
  accountId: null as string | null,
  error: null,
  endSession: vi.fn(async () => {}),
};

interface FakeClerkUser {
  primaryEmailAddress: { emailAddress: string } | null;
  username?: string | null;
  update?: (params: { username: string }) => Promise<unknown>;
}

const clerkUser = {
  user: null as FakeClerkUser | null,
};

vi.mock('@clerk/react', () => ({
  useUser: () => clerkUser,
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
    clerkUser.user = null;
    localStorage.clear();
    useAppStore.getState().clearAccountSession();
  });

  it('shows sign-in without loading venue configuration when signed out', () => {
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByTestId('sign-in-button')).toBeDefined();
    expect(screen.queryByText('Venue connections')).toBeNull();
  });

  it('shows account controls only after the account is ready', () => {
    accountSession.status = 'ready';
    accountSession.accountId = 'acct_1';
    accountSession.userId = 'user_1';
    useAppStore.getState().activateAccountSession('acct_1', ['derive']);

    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /acct acct_1/i }));

    expect(screen.getByText('Venue connections')).toBeDefined();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined();
    expect(screen.getByText('Derive')).toBeDefined();
  });

  it('labels the chip with the signed-in email', () => {
    accountSession.status = 'ready';
    accountSession.accountId = 'acct_1';
    accountSession.userId = 'user_1';
    clerkUser.user = { primaryEmailAddress: { emailAddress: 'trader@example.com' } };
    useAppStore.getState().activateAccountSession('acct_1', []);

    render(wrap(<AccountChip />));

    expect(screen.getByRole('button', { name: /trader@example\.com/ })).toBeDefined();
    expect(screen.queryByText(/acct acct_1/)).toBeNull();
  });

  it('saves the chip name as the Clerk username', async () => {
    accountSession.status = 'ready';
    accountSession.accountId = 'acct_1';
    accountSession.userId = 'user_1';
    const update = vi.fn(async ({ username }: { username: string }) => {
      if (clerkUser.user) clerkUser.user.username = username;
    });
    clerkUser.user = {
      primaryEmailAddress: { emailAddress: 'trader@example.com' },
      username: null,
      update,
    };
    localStorage.setItem('accountDisplayName:user_1', 'Roberto');
    useAppStore.getState().activateAccountSession('acct_1', []);

    const view = render(wrap(<AccountChip />));
    expect(screen.getByRole('button', { name: /roberto/i })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /change username/i }));
    const input = screen.getByRole('textbox', { name: /account username/i }) as HTMLInputElement;
    expect(input.value).toBe('Roberto');
    fireEvent.change(input, { target: { value: 'roberto_trades' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(update).toHaveBeenCalledWith({ username: 'roberto_trades' }));
    view.rerender(wrap(<AccountChip />));
    expect(await screen.findByRole('button', { name: /roberto_trades/i })).toBeDefined();
    expect(localStorage.getItem('accountDisplayName:user_1')).toBeNull();
  });

  it('keeps the editor open with the Clerk error when the username is rejected', async () => {
    accountSession.status = 'ready';
    accountSession.accountId = 'acct_1';
    accountSession.userId = 'user_1';
    clerkUser.user = {
      primaryEmailAddress: { emailAddress: 'trader@example.com' },
      username: null,
      update: vi.fn(async () => {
        throw {
          errors: [{ code: 'form_identifier_exists', longMessage: 'That username is taken.' }],
        };
      }),
    };
    useAppStore.getState().activateAccountSession('acct_1', []);

    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /change username/i }));
    const input = screen.getByRole('textbox', { name: /account username/i });
    fireEvent.change(input, { target: { value: 'taken' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect((await screen.findByRole('alert')).textContent).toBe('That username is taken.');
    expect(screen.getByRole('textbox', { name: /account username/i })).toBeDefined();
  });

  it('does not expose venue controls while an account is loading', () => {
    accountSession.status = 'loading';
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /account loading/i }));
    expect(screen.queryByText('Venue connections')).toBeNull();
  });

  it('"Take the tour" starts the tour and closes the menu', () => {
    useAppStore.setState({ tourActive: false, tourStep: 0 });
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(screen.getByText('Take the tour'));
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(screen.queryByText('Take the tour')).toBeNull();
  });

  it('"Keyboard shortcuts" calls onOpenShortcuts and closes the menu', () => {
    const onOpenShortcuts = vi.fn();
    render(wrap(<AccountChip onOpenShortcuts={onOpenShortcuts} />));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(screen.getByText(/Keyboard shortcuts/));
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Keyboard shortcuts/)).toBeNull();
  });
});
