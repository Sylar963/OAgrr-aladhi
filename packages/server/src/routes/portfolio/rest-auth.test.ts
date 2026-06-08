import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

const { storeMock, usersStoreMock, verifyClerkTokenMock } = vi.hoisted(() => ({
  storeMock: {
    enabled: false as boolean,
    ensureAccount: vi.fn().mockResolvedValue(undefined),
  },
  usersStoreMock: {
    enabled: false as boolean,
    getByClerkId: vi.fn(),
    upsertByClerkId: vi.fn(),
  },
  verifyClerkTokenMock: vi.fn(),
}));

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
  usersStore: usersStoreMock,
}));

vi.mock('../../clerk-verifier.js', () => ({
  verifyClerkToken: verifyClerkTokenMock,
}));

vi.mock('../../portfolio-services.js', () => ({
  bootstrapPortfolioForAccount: vi.fn().mockResolvedValue(undefined),
  getOrCreatePortfolioRuntime: vi.fn().mockReturnValue({
    getSnapshot: () => null,
    setForwardDays: () => {},
    subscribe: () => () => {},
  }),
  listPositions: vi.fn().mockReturnValue([]),
  ensureChainForLeg: vi.fn().mockResolvedValue(undefined),
  portfolioStore: { upsert: vi.fn(), remove: vi.fn().mockReturnValue(true) },
  portfolioMarkProvider: { getMark: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../derive-position-store.js', () => ({
  derivePositionStore: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: () => false,
  },
}));

vi.mock('../../thalex-position-store.js', () => ({
  thalexPositionStore: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: () => false,
  },
}));

import { portfolioRoutes } from './index.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(portfolioRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('Portfolio REST auth gate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storeMock.enabled = false;
    usersStoreMock.getByClerkId.mockReset();
    usersStoreMock.upsertByClerkId.mockReset();
    verifyClerkTokenMock.mockReset();
  });

  it('returns 401 on anonymous GET /portfolio/positions when persistence is enabled', async () => {
    storeMock.enabled = true;
    const res = await app.inject({ method: 'GET', url: '/api/portfolio/positions' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('returns 401 on anonymous POST /portfolio/venue-credentials/derive when persistence is enabled', async () => {
    storeMock.enabled = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolio/venue-credentials/derive',
      payload: {
        walletAddress: '0x' + 'a'.repeat(40),
        signerPrivateKey: '0x' + 'b'.repeat(64),
        subaccountId: 1,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows authenticated requests to reach the handler when persistence is enabled', async () => {
    storeMock.enabled = true;
    verifyClerkTokenMock.mockResolvedValue({
      clerkUserId: 'user_carol',
      email: 'carol@example.com',
      displayName: 'carol',
    });
    usersStoreMock.getByClerkId.mockResolvedValue({
      id: 'usr_carol',
      defaultAccountId: 'acct_carol',
      displayName: 'carol',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/portfolio/positions',
      headers: { authorization: 'Bearer carol-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountId: 'acct_carol', positions: [] });
  });

  it('allows anonymous access when persistence is disabled (dev mode)', async () => {
    storeMock.enabled = false;
    const res = await app.inject({ method: 'GET', url: '/api/portfolio/positions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountId: 'paper-default' });
  });
});
