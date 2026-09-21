import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clerkState = {
  isLoaded: false,
  isSignedIn: false,
  userId: null as string | null,
};

const mocks = vi.hoisted(() => ({
  synchronizeAccountSession: vi.fn(),
  terminateAuthenticatedSession: vi.fn(),
  listVenueConnections: vi.fn(),
  restoreVenueConnections: vi.fn(),
  migrateLegacyBrowserVenueCredentials: vi.fn(),
  signOut: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  SignInButton: ({ children }: { children?: ReactElement }) => children ?? null,
  useAuth: () => ({
    getToken: mocks.getToken,
    isLoaded: clerkState.isLoaded,
    isSignedIn: clerkState.isSignedIn,
    signOut: mocks.signOut,
    userId: clerkState.userId,
  }),
}));

vi.mock('@lib/account-session-api', () => ({
  synchronizeAccountSession: mocks.synchronizeAccountSession,
  terminateAuthenticatedSession: mocks.terminateAuthenticatedSession,
}));

vi.mock('@lib/venue-connections-api', () => ({
  listVenueConnections: mocks.listVenueConnections,
  restoreVenueConnections: mocks.restoreVenueConnections,
  migrateLegacyBrowserVenueCredentials: mocks.migrateLegacyBrowserVenueCredentials,
}));

import { useAppStore } from '@stores/app-store';
import {
  AccountAccessBoundary,
  AccountSessionProvider,
  useAccountSession,
} from './AccountSessionProvider';

function AccountSessionProbe() {
  const session = useAccountSession();
  return (
    <div>
      <span>{session.status}</span>
      <span>{session.accountId ?? 'no-account'}</span>
    </div>
  );
}

function wrap(ui: ReactElement, queryClient = new QueryClient()) {
  return (
    <QueryClientProvider client={queryClient}>
      <AccountSessionProvider>{ui}</AccountSessionProvider>
    </QueryClientProvider>
  );
}

describe('AccountSessionProvider', () => {
  beforeEach(() => {
    clerkState.isLoaded = false;
    clerkState.isSignedIn = false;
    clerkState.userId = null;
    mocks.synchronizeAccountSession.mockReset();
    mocks.terminateAuthenticatedSession.mockReset();
    mocks.listVenueConnections.mockReset();
    mocks.restoreVenueConnections.mockReset();
    mocks.migrateLegacyBrowserVenueCredentials.mockReset();
    mocks.signOut.mockReset();
    mocks.getToken.mockReset();
    mocks.getToken.mockResolvedValue('token');
    mocks.listVenueConnections.mockResolvedValue([]);
    mocks.restoreVenueConnections.mockResolvedValue([]);
    mocks.migrateLegacyBrowserVenueCredentials.mockResolvedValue(undefined);
    useAppStore.getState().clearAccountSession();
    localStorage.setItem(
      'venueCreds_derive',
      JSON.stringify({ venue: 'derive', fields: { privateKeyPem: 'legacy-secret' } }),
    );
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('does not load credentials or synchronize while Clerk is loading', () => {
    render(wrap(<AccountSessionProbe />));

    expect(screen.getByText('loading')).toBeDefined();
    expect(mocks.synchronizeAccountSession).not.toHaveBeenCalled();
    expect(mocks.listVenueConnections).not.toHaveBeenCalled();
    expect(mocks.restoreVenueConnections).not.toHaveBeenCalled();
    expect(mocks.migrateLegacyBrowserVenueCredentials).not.toHaveBeenCalled();
    expect(useAppStore.getState().configuredVenueIds).toEqual([]);
  });

  it('becomes ready only after account sync and server-side credential restore', async () => {
    clerkState.isLoaded = true;
    clerkState.isSignedIn = true;
    clerkState.userId = 'user_1';
    mocks.synchronizeAccountSession.mockResolvedValue({
      accountId: 'acct_1',
      clerkUserId: 'user_1',
    });
    mocks.listVenueConnections.mockResolvedValue([
      { venue: 'derive', configured: true, connected: false },
    ]);

    render(wrap(<AccountSessionProbe />));

    await waitFor(() => expect(screen.getByText('ready')).toBeDefined());
    expect(screen.getByText('acct_1')).toBeDefined();
    expect(mocks.migrateLegacyBrowserVenueCredentials).toHaveBeenCalledWith('acct_1', 'token');
    expect(mocks.restoreVenueConnections).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().configuredVenueIds).toEqual(['derive']);
  });

  it('blocks account children immediately when the Clerk user changes', async () => {
    clerkState.isLoaded = true;
    clerkState.isSignedIn = true;
    clerkState.userId = 'user_1';
    mocks.synchronizeAccountSession.mockResolvedValue({
      accountId: 'acct_1',
      clerkUserId: 'user_1',
    });

    const { rerender } = render(
      wrap(
        <AccountAccessBoundary>
          <div>private-account-content</div>
        </AccountAccessBoundary>,
      ),
    );
    await waitFor(() => expect(screen.getByText('private-account-content')).toBeDefined());

    clerkState.userId = 'user_2';
    mocks.synchronizeAccountSession.mockReturnValue(new Promise(() => {}));
    rerender(
      wrap(
        <AccountAccessBoundary>
          <div>private-account-content</div>
        </AccountAccessBoundary>,
      ),
    );

    expect(screen.queryByText('private-account-content')).toBeNull();
    expect(screen.getByText('Loading account…')).toBeDefined();
  });
  it('rejects a synchronized account belonging to a different Clerk user', async () => {
    clerkState.isLoaded = true;
    clerkState.isSignedIn = true;
    clerkState.userId = 'user_1';
    mocks.synchronizeAccountSession.mockResolvedValue({
      accountId: 'acct_2',
      clerkUserId: 'user_2',
    });

    render(wrap(<AccountSessionProbe />));

    await waitFor(() => expect(screen.getByText('error')).toBeDefined());
    expect(mocks.migrateLegacyBrowserVenueCredentials).not.toHaveBeenCalled();
    expect(mocks.listVenueConnections).not.toHaveBeenCalled();
    expect(useAppStore.getState().accountId).toBeNull();
  });
});
