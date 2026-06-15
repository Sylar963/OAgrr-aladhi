import type { PaperAccountRow } from '@oggregator/db';
import { DEFAULT_ACCOUNT_ID, DEFAULT_INITIAL_CASH_USD } from '@oggregator/trading';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyClerkToken } from './clerk-verifier.js';
import { fundedStore } from './funded-services.js';
import { paperTradingStore, usersStore } from './trading-services.js';

export interface AuthenticatedUser {
  id: string;
  accountId: string;
  label: string;
}

/** Extract the raw Clerk JWT from `Authorization: Bearer <jwt>`, or null. */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers['authorization'];
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * Resolve a Clerk JWT to a linked user + paper account, lazily upserting the
 * `users` row and ensuring its paper account exists. Returns null when the
 * token is missing/invalid. Only meaningful when the DB is enabled.
 */
export async function getUserByToken(token: string | null): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const identity = await verifyClerkToken(token);
  if (!identity) return null;

  const existing = await usersStore.getByClerkId(identity.clerkUserId);
  if (existing?.defaultAccountId) {
    return {
      id: existing.id,
      accountId: existing.defaultAccountId,
      label: existing.displayName ?? identity.email ?? identity.clerkUserId,
    };
  }

  // First sign-in: create a paper account, then link it on the user row.
  const accountId = `acct_${crypto.randomUUID()}`;
  const account: PaperAccountRow = {
    id: accountId,
    label: `${identity.displayName ?? identity.email ?? 'Trader'}'s Account`,
    initialCashUsd: DEFAULT_INITIAL_CASH_USD,
    createdAt: new Date(),
  };
  await paperTradingStore.ensureAccount(account);

  const user = await usersStore.upsertByClerkId({
    clerkUserId: identity.clerkUserId,
    email: identity.email,
    displayName: identity.displayName,
    accountId,
  });
  if (!user?.defaultAccountId) return null;

  return {
    id: user.id,
    accountId: user.defaultAccountId,
    label: user.displayName ?? identity.email ?? identity.clerkUserId,
  };
}

/** Called by POST /api/paper/auth/sync once after sign-in. */
export async function syncUser(token: string | null): Promise<{ accountId: string } | null> {
  const user = await getUserByToken(token);
  if (!user) return null;
  return { accountId: user.accountId };
}

export async function authenticateUser(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  return getUserByToken(bearerToken(request));
}

export function requireUser() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.url.startsWith('/api/paper/auth/')) {
      return;
    }
    if (!paperTradingStore.enabled) {
      return;
    }
    const user = await authenticateUser(request, reply);
    if (!user) {
      reply
        .status(401)
        .send({ error: 'unauthorized', message: 'Invalid or missing Authorization bearer token' });
      return;
    }
    request.user = user;
  };
}

export function getRequestAccountId(req: FastifyRequest, fallback: string): string {
  if (paperTradingStore.enabled) {
    if (!req.user) {
      throw new Error('getRequestAccountId called without authenticated user');
    }
    return req.user.accountId;
  }
  return req.user?.accountId ?? fallback;
}

export class AccountScopeError extends Error {
  readonly statusCode = 403;
  constructor(message = 'Account not authorized for this user') {
    super(message);
    this.name = 'AccountScopeError';
  }
}

/**
 * Resolve + authorize the account a paper request targets.
 * Allowed iff: no scope requested (→ user default / DEFAULT_ACCOUNT_ID),
 * the user's own default account, OR a paper_account_id of one of THEIR funded_runs.
 * Any other requested account → 403.
 */
export async function authorizeAccountScope(
  req: FastifyRequest,
  requested?: string | null,
): Promise<string> {
  if (!paperTradingStore.enabled) {
    return req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
  }
  if (!req.user) {
    throw new Error('authorizeAccountScope called without authenticated user');
  }
  const defaultId = req.user.accountId;
  if (!requested || requested === defaultId) {
    return defaultId;
  }
  if (fundedStore.enabled) {
    const runs = await fundedStore.listRunsForUser(req.user.id);
    if (runs.some((r) => r.paperAccountId === requested)) {
      return requested;
    }
  }
  throw new AccountScopeError();
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
