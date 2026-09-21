import { getClerkToken } from './clerk-token';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function requireClerkToken(): Promise<string> {
  const token = await getClerkToken();
  if (!token) throw new Error('Clerk session token is not available');
  return token;
}

async function authenticatedRequest(
  path: string,
  init: RequestInit = {},
  providedToken?: string,
): Promise<Response> {
  const token = providedToken ?? (await requireClerkToken());
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

export interface SynchronizedAccountSession {
  accountId: string;
  clerkUserId: string;
}

export async function synchronizeAccountSession(
  token?: string,
): Promise<SynchronizedAccountSession> {
  const response = await authenticatedRequest('/paper/auth/sync', { method: 'POST' }, token);
  if (!response.ok) throw new Error(`Account sync failed with HTTP ${response.status}`);
  const payload = (await response.json()) as Partial<SynchronizedAccountSession>;
  if (
    typeof payload.accountId !== 'string' ||
    payload.accountId.length === 0 ||
    typeof payload.clerkUserId !== 'string' ||
    payload.clerkUserId.length === 0
  ) {
    throw new Error('Account sync response is invalid');
  }
  return payload as SynchronizedAccountSession;
}

export async function createWebSocketTicket(): Promise<string> {
  const response = await authenticatedRequest('/paper/auth/ws-ticket', { method: 'POST' });
  if (!response.ok) throw new Error(`WebSocket ticket failed with HTTP ${response.status}`);
  const payload = (await response.json()) as { ticket?: unknown };
  if (typeof payload.ticket !== 'string' || payload.ticket.length === 0) {
    throw new Error('WebSocket ticket response is invalid');
  }
  return payload.ticket;
}

export async function terminateAuthenticatedSession(token?: string): Promise<void> {
  const response = await authenticatedRequest('/paper/auth/session', { method: 'DELETE' }, token);
  if (!response.ok && response.status !== 401) {
    throw new Error(`Session termination failed with HTTP ${response.status}`);
  }
}
