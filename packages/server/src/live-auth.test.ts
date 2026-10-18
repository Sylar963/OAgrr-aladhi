import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createLiveTraderGuard,
  type EntitlementReader,
  requireStepUp,
  reverificationErrorBody,
  stepUpMaxMinutes,
} from './live-auth.js';
import type { AuthenticatedUser } from './user-service.js';

const operator: AuthenticatedUser = {
  id: 'usr_1',
  clerkUserId: 'user_1',
  accountId: 'acct_1',
  label: 'Operator',
  factorAgeMinutes: { first: 2, second: 2 },
};

function entitlements(
  row: { status: string; expiresAt: Date | null } | null,
  enabled = true,
): EntitlementReader & { getUserEntitlement: ReturnType<typeof vi.fn> } {
  return { enabled, getUserEntitlement: vi.fn(async () => row) };
}

async function buildApp(options: {
  env?: NodeJS.ProcessEnv;
  user?: AuthenticatedUser | null;
  reader?: EntitlementReader;
  now?: () => number;
}) {
  const env = options.env ?? { LIVE_TRADING_ENABLED: 'true' };
  const app = Fastify({ logger: false });
  const guard = createLiveTraderGuard({
    env,
    authenticate: async () => (options.user === undefined ? operator : options.user),
    entitlements: options.reader ?? entitlements({ status: 'enabled', expiresAt: null }),
    ...(options.now ? { now: options.now } : {}),
  });
  app.get('/live/status', { onRequest: guard }, async () => ({ ok: true }));
  app.post('/live/arm', { onRequest: guard, preHandler: requireStepUp(env) }, async () => ({
    armed: true,
  }));
  await app.ready();
  return app;
}

describe('live trader guard', () => {
  it('hides live routes when the flag is off', async () => {
    const app = await buildApp({ env: {} });
    const res = await app.inject({ method: 'GET', url: '/live/status' });
    expect(res.statusCode).toBe(404);
  });

  it('401s without an authenticated user, whatever AUTH_DEV_BYPASS says', async () => {
    const app = await buildApp({
      env: { LIVE_TRADING_ENABLED: 'true', AUTH_DEV_BYPASS: '1' },
      user: null,
    });
    const res = await app.inject({ method: 'GET', url: '/live/status' });
    expect(res.statusCode).toBe(401);
  });

  it('403s without the live_trading entitlement', async () => {
    const app = await buildApp({ reader: entitlements(null) });
    const res = await app.inject({ method: 'GET', url: '/live/status' });
    expect(res.statusCode).toBe(403);
  });

  it('403s for a revoked or expired entitlement', async () => {
    const revoked = await buildApp({ reader: entitlements({ status: 'revoked', expiresAt: null }) });
    expect((await revoked.inject({ method: 'GET', url: '/live/status' })).statusCode).toBe(403);

    const expired = await buildApp({
      reader: entitlements({ status: 'enabled', expiresAt: new Date(1_000) }),
      now: () => 2_000,
    });
    expect((await expired.inject({ method: 'GET', url: '/live/status' })).statusCode).toBe(403);
  });

  it('403s when persistence is unavailable', async () => {
    const app = await buildApp({ reader: entitlements({ status: 'enabled', expiresAt: null }, false) });
    const res = await app.inject({ method: 'GET', url: '/live/status' });
    expect(res.statusCode).toBe(403);
  });

  it('lets an entitled user through and caches the entitlement read', async () => {
    const reader = entitlements({ status: 'enabled', expiresAt: null });
    const app = await buildApp({ reader });
    expect((await app.inject({ method: 'GET', url: '/live/status' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/live/status' })).statusCode).toBe(200);
    expect(reader.getUserEntitlement).toHaveBeenCalledTimes(1);
    expect(reader.getUserEntitlement).toHaveBeenCalledWith('usr_1', 'live_trading');
  });
});

describe('step-up', () => {
  it.each([
    ['a first factor never verified', { first: null, second: null }],
    ['a stale first factor, even with a fresh second factor', { first: 11, second: 1 }],
  ])('rejects %s with the Clerk reverification body', async (_label, factorAgeMinutes) => {
    const app = await buildApp({ user: { ...operator, factorAgeMinutes } });
    const res = await app.inject({ method: 'POST', url: '/live/arm' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      clerk_error: {
        type: 'forbidden',
        reason: 'reverification-error',
        metadata: { reverification: { level: 'first_factor', afterMinutes: 10 } },
      },
    });
  });

  it('passes with a fresh first factor and no second factor at all (no Clerk MFA)', async () => {
    const app = await buildApp({ user: { ...operator, factorAgeMinutes: { first: 9, second: null } } });
    const res = await app.inject({ method: 'POST', url: '/live/arm' });
    expect(res.statusCode).toBe(200);
  });

  it('clamps the configured window to 1-10 minutes', () => {
    expect(stepUpMaxMinutes({})).toBe(10);
    expect(stepUpMaxMinutes({ LIVE_STEPUP_MAX_MINUTES: '30' })).toBe(10);
    expect(stepUpMaxMinutes({ LIVE_STEPUP_MAX_MINUTES: '0.5' })).toBe(1);
    expect(stepUpMaxMinutes({ LIVE_STEPUP_MAX_MINUTES: 'abc' })).toBe(10);
    expect(stepUpMaxMinutes({ LIVE_STEPUP_MAX_MINUTES: '3' })).toBe(3);
    expect(reverificationErrorBody(3).clerk_error.metadata.reverification.afterMinutes).toBe(3);
  });
});
