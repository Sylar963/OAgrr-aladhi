import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { syncResult: null as { accountId: string } | null };

vi.mock('../../user-service.js', () => ({
  syncUser: vi.fn(async () => state.syncResult),
}));

beforeEach(() => {
  vi.resetModules();
  state.syncResult = null;
});

async function buildApp() {
  const { paperAuthRoute } = await import('./auth.js');
  const app = Fastify();
  await app.register(paperAuthRoute, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('POST /api/paper/auth/sync', () => {
  it('returns accountId for a valid token', async () => {
    state.syncResult = { accountId: 'acct_1' };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/paper/auth/sync',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accountId: 'acct_1' });
    await app.close();
  });

  it('401s for a missing/invalid token', async () => {
    state.syncResult = null;
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/paper/auth/sync' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
