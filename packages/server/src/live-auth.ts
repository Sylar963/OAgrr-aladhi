import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from './user-service.js';

export const LIVE_TRADING_FEATURE_KEY = 'live_trading';
const DEFAULT_STEP_UP_MAX_MINUTES = 10;
const ENTITLEMENT_CACHE_MS = 5 * 60_000;

export interface EntitlementReader {
  readonly enabled: boolean;
  getUserEntitlement(
    userId: string,
    featureKey: string,
  ): Promise<{ status: string; expiresAt: Date | null } | null>;
}

export interface LiveAuthDependencies {
  env: NodeJS.ProcessEnv;
  authenticate(request: FastifyRequest): Promise<AuthenticatedUser | null>;
  entitlements: EntitlementReader;
  now?: () => number;
}

export function liveTradingEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['LIVE_TRADING_ENABLED'] === 'true';
}

export function stepUpMaxMinutes(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env['LIVE_STEPUP_MAX_MINUTES']);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STEP_UP_MAX_MINUTES;
  return Math.min(10, Math.max(1, Math.floor(parsed)));
}

/** Body Clerk's `useReverification()` recognises; copied from `@clerk/shared/authorization-errors`. */
export function reverificationErrorBody(afterMinutes: number) {
  return {
    clerk_error: {
      type: 'forbidden',
      reason: 'reverification-error',
      metadata: { reverification: { level: 'second_factor', afterMinutes } },
    },
  } as const;
}

export function hasFreshSecondFactor(user: AuthenticatedUser, maxMinutes: number): boolean {
  const age = user.factorAgeMinutes?.second;
  return age != null && age <= maxMinutes;
}

/**
 * Guard for every /api/live route. Never honours AUTH_DEV_BYPASS: live routes need a real Clerk
 * identity, the live_trading entitlement, and the global flag, whatever else is configured.
 */
export function createLiveTraderGuard(deps: LiveAuthDependencies) {
  const now = deps.now ?? Date.now;
  // Entitlement reads are cached so status polling doesn't keep the serverless DB awake.
  const cache = new Map<string, { active: boolean; checkedAt: number }>();

  async function entitled(userId: string): Promise<boolean> {
    const cached = cache.get(userId);
    if (cached && now() - cached.checkedAt < ENTITLEMENT_CACHE_MS) return cached.active;
    const row = await deps.entitlements.getUserEntitlement(userId, LIVE_TRADING_FEATURE_KEY);
    const active =
      row?.status === 'enabled' && (row.expiresAt == null || row.expiresAt.getTime() > now());
    cache.set(userId, { active, checkedAt: now() });
    return active;
  }

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!liveTradingEnabled(deps.env)) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }
    const user = await deps.authenticate(request);
    if (!user) {
      reply.status(401).send({ error: 'unauthorized' });
      return;
    }
    if (!deps.entitlements.enabled || !(await entitled(user.id))) {
      reply.status(403).send({ error: 'live_trading_not_entitled' });
      return;
    }
    request.user = user;
  };
}

/** Runs after the live guard. Fails with Clerk's reverification body so the web app can prompt. */
export function requireStepUp(env: NodeJS.ProcessEnv) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const maxMinutes = stepUpMaxMinutes(env);
    if (!request.user || !hasFreshSecondFactor(request.user, maxMinutes)) {
      reply.status(403).send(reverificationErrorBody(maxMinutes));
    }
  };
}
