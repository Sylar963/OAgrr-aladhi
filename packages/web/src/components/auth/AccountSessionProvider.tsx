import { SignInButton, useAuth } from '@clerk/react';
import {
  listVenueConnections,
  migrateLegacyBrowserVenueCredentials,
  restoreVenueConnections,
} from '@lib/venue-connections-api';
import { synchronizeAccountSession, terminateAuthenticatedSession } from '@lib/account-session-api';
import { setClerkTokenGetter } from '@lib/clerk-token';
import { useAppStore } from '@stores/app-store';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type AccountSessionStatus = 'loading' | 'signed_out' | 'syncing' | 'ready' | 'error';

interface AccountSession {
  status: AccountSessionStatus;
  userId: string | null;
  accountId: string | null;
  error: string | null;
  retryAccountLoad: () => void;
  endSession: () => Promise<void>;
}

const AccountSessionContext = createContext<AccountSession | null>(null);

export function AccountSessionProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, signOut, userId } = useAuth();
  const queryClient = useQueryClient();
  const activateAccountSession = useAppStore((state) => state.activateAccountSession);
  const clearAccountSession = useAppStore((state) => state.clearAccountSession);
  const [status, setStatus] = useState<AccountSessionStatus>('loading');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const clearAccountData = useCallback(() => {
    clearAccountSession();
    setAccountId(null);
    setResolvedUserId(null);
    void queryClient.cancelQueries();
    queryClient.removeQueries({ queryKey: ['account'] });
    queryClient.removeQueries({ queryKey: ['paper'] });
    queryClient.removeQueries({ queryKey: ['portfolio'] });
    queryClient.removeQueries({ queryKey: ['funded'] });
  }, [clearAccountSession, queryClient]);

  useEffect(() => {
    setClerkTokenGetter(() => getToken());
    return () => setClerkTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded) {
      setStatus('loading');
      return () => {
        cancelled = true;
      };
    }

    if (!isSignedIn || !userId) {
      clearAccountData();
      setError(null);
      setStatus('signed_out');
      return () => {
        cancelled = true;
      };
    }

    clearAccountData();
    setStatus('syncing');
    setError(null);

    void (async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        if (!token) throw new Error('Clerk session token is not available');
        const synchronized = await synchronizeAccountSession(token);
        if (cancelled) return;
        if (synchronized.clerkUserId !== userId) {
          throw new Error('Clerk user changed while the account was loading');
        }
        await migrateLegacyBrowserVenueCredentials(synchronized.accountId, token);
        if (cancelled) return;
        const connections = await listVenueConnections(token);
        if (cancelled) return;
        activateAccountSession(
          synchronized.accountId,
          connections.map((connection) => connection.venue),
        );
        setAccountId(synchronized.accountId);
        setResolvedUserId(userId);
        await restoreVenueConnections(token);
        if (cancelled) return;
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        clearAccountData();
        setError(caught instanceof Error ? caught.message : 'Account synchronization failed');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activateAccountSession,
    clearAccountData,
    getToken,
    isLoaded,
    isSignedIn,
    loadAttempt,
    userId,
  ]);

  const retryAccountLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const endSession = useCallback(async () => {
    setStatus('syncing');
    const token = await getToken().catch(() => null);
    if (token) await terminateAuthenticatedSession(token).catch(() => {});
    clearAccountData();
    await signOut();
  }, [clearAccountData, getToken, signOut]);

  const exposedStatus: AccountSessionStatus =
    status === 'ready' && resolvedUserId !== userId ? 'syncing' : status;

  const value = useMemo<AccountSession>(
    () => ({
      status: exposedStatus,
      userId: userId ?? null,
      accountId,
      error,
      retryAccountLoad,
      endSession,
    }),
    [accountId, endSession, error, exposedStatus, retryAccountLoad, userId],
  );

  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}

export function useAccountSession(): AccountSession {
  const session = useContext(AccountSessionContext);
  if (session == null) {
    throw new Error('useAccountSession must be used inside AccountSessionProvider');
  }
  return session;
}

export function AccountAccessBoundary({ children }: { children: ReactNode }) {
  const session = useAccountSession();

  if (session.status === 'ready') return children;

  if (session.status === 'signed_out') {
    return (
      <div role="status">
        <p>Sign in to load an account.</p>
        <SignInButton mode="modal">
          <button type="button">Sign in</button>
        </SignInButton>
      </div>
    );
  }

  if (session.status === 'error') {
    return (
      <div role="alert">
        <p>Account unavailable: {session.error}</p>
        <button type="button" onClick={session.retryAccountLoad}>
          Try again
        </button>
      </div>
    );
  }

  return <div role="status">Loading account…</div>;
}
