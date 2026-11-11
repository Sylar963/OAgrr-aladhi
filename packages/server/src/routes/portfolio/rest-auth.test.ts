import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

const { storeMock, usersStoreMock, verifyClerkTokenMock, ensureParadexConnectedMock } = vi.hoisted(() => ({
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
  ensureParadexConnectedMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../trading-services.js', async () => {
  const { NoopExchangePortfolioLedgerStore } = await import('@oggregator/db');
  return {
    paperTradingStore: storeMock,
    usersStore: usersStoreMock,
    exchangePortfolioLedgerStore: new NoopExchangePortfolioLedgerStore(),
  };
});

vi.mock('./venue-credentials.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./venue-credentials.js')>()),
  ensureParadexConnected: ensureParadexConnectedMock,
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
    environment: () => null,
  },
  ledgerMatchesSession: () => true,
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
    ensureParadexConnectedMock.mockReset().mockResolvedValue(true);
  });

  it('returns 401 on anonymous GET /portfolio/positions when persistence is enabled', async () => {
    storeMock.enabled = true;
    const res = await app.inject({ method: 'GET', url: '/api/portfolio/positions' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('does not restore private connections before authentication', async () => {
    storeMock.enabled = true;
    const res = await app.inject({ url: '/api/portfolio/positions?source=paradex' });
    expect(res.statusCode).toBe(401);
    expect(ensureParadexConnectedMock).not.toHaveBeenCalled();
  });

  it.each([
    '/api/portfolio/positions?source=paradex',
    '/api/portfolio/paradex/account',
    '/api/portfolio/equity-history?venue=paradex',
  ])('restores the authenticated account before reading %s', async (url) => {
    storeMock.enabled = true;
    verifyClerkTokenMock.mockResolvedValue({ clerkUserId: 'user_carol' });
    usersStoreMock.getByClerkId.mockResolvedValue({ id: 'usr_carol', defaultAccountId: 'acct_carol' });
    ensureParadexConnectedMock.mockRejectedValueOnce(new Error('private upstream detail'));
    const res = await app.inject({ url, headers: { authorization: 'Bearer carol-token' } });
    expect(ensureParadexConnectedMock).toHaveBeenCalledWith('acct_carol');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'venue_connection_unavailable' });
    expect(res.body).not.toContain('private upstream detail');
  });

  it('reports a disconnected Paradex account instead of returning cached positions', async () => {
    storeMock.enabled = true;
    verifyClerkTokenMock.mockResolvedValue({ clerkUserId: 'user_carol' });
    usersStoreMock.getByClerkId.mockResolvedValue({ id: 'usr_carol', defaultAccountId: 'acct_carol' });
    ensureParadexConnectedMock.mockResolvedValueOnce(false);
    const res = await app.inject({
      url: '/api/portfolio/positions?source=paradex',
      headers: { authorization: 'Bearer carol-token' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('venue_not_connected');
  });

  it('returns 401 on anonymous POST /portfolio/venue-credentials/derive/session-key when persistence is enabled', async () => {
    storeMock.enabled = true;
    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolio/venue-credentials/derive/session-key',
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

  it('rejects anonymous access when persistence is disabled without the dev bypass', async () => {
    storeMock.enabled = false;
    vi.stubEnv('AUTH_DEV_BYPASS', '');
    const res = await app.inject({ method: 'GET', url: '/api/portfolio/positions' });
    vi.unstubAllEnvs();
    expect(res.statusCode).toBe(401);
  });

  it('allows anonymous access when persistence is disabled (dev mode)', async () => {
    storeMock.enabled = false;
    const res = await app.inject({ method: 'GET', url: '/api/portfolio/positions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountId: 'paper-default' });
  });
});
