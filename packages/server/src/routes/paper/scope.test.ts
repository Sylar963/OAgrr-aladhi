import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeMock, usersStoreMock, fundedStoreMock, verifyClerkTokenMock } = vi.hoisted(() => ({
  storeMock: { enabled: false as boolean },
  usersStoreMock: { getByClerkId: vi.fn(), upsertByClerkId: vi.fn() },
  fundedStoreMock: { enabled: true as boolean, listRunsForUser: vi.fn() },
  verifyClerkTokenMock: vi.fn(),
}));

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
  usersStore: usersStoreMock,
  positionRepository: { listPositions: vi.fn().mockResolvedValue([]) },
  quoteProvider: { getMark: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../clerk-verifier.js', () => ({ verifyClerkToken: verifyClerkTokenMock }));

vi.mock('../../funded-services.js', () => ({ fundedStore: fundedStoreMock }));

import { requireUser } from '../../user-service.js';
import { paperPositionsRoute } from './positions.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', requireUser());
  await app.register(paperPositionsRoute, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('Paper account scoping', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storeMock.enabled = false;
    fundedStoreMock.enabled = true;
    usersStoreMock.getByClerkId.mockReset();
    usersStoreMock.upsertByClerkId.mockReset();
    fundedStoreMock.listRunsForUser.mockReset();
    verifyClerkTokenMock.mockReset();
  });

  function authAs(userId: string, accountId: string): void {
    verifyClerkTokenMock.mockResolvedValue({
      clerkUserId: 'clerk_1',
      email: 'a@b.co',
      displayName: 'A',
    });
    usersStoreMock.getByClerkId.mockResolvedValue({
      id: userId,
      defaultAccountId: accountId,
      displayName: 'A',
    });
  }

  it('returns 403 for a foreign accountId not owned by the user', async () => {
    storeMock.enabled = true;
    authAs('u1', 'acct_default');
    fundedStoreMock.listRunsForUser.mockResolvedValue([
      { paperAccountId: 'acct_run1', userId: 'u1' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/paper/positions?accountId=acct_foreign',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });

  it('returns 200 for the user own funded-run account', async () => {
    storeMock.enabled = true;
    authAs('u1', 'acct_default');
    fundedStoreMock.listRunsForUser.mockResolvedValue([
      { paperAccountId: 'acct_run1', userId: 'u1' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/paper/positions?accountId=acct_run1',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ positions: [] });
  });

  it('returns 200 and resolves the user default when no accountId is requested', async () => {
    storeMock.enabled = true;
    authAs('u1', 'acct_default');
    const res = await app.inject({
      method: 'GET',
      url: '/api/paper/positions',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ positions: [] });
  });
});
