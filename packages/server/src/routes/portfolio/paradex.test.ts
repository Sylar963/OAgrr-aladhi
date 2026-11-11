import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParadexAuthError } from '@oggregator/core';

const { store } = vi.hoisted(() => ({
  store: {
    retain: vi.fn(),
    release: vi.fn(),
    fetchAccountSummary: vi.fn(),
    fetchOpenRfqs: vi.fn(),
  },
}));
vi.mock('../../paradex-position-store.js', () => ({ paradexPositionStore: store }));
vi.mock('../../user-service.js', () => ({
  getRequestAccountId: (req: { headers: Record<string, string | undefined> }, fallback: string) =>
    req.headers['x-account'] ?? fallback,
}));
import { portfolioParadexRoutes } from './paradex.js';

const summary = {
  venueAccount: '0x123456789abcdef',
  equityUsd: 2000,
  freeCollateralUsd: 1500,
  initialMarginUsd: 500,
  maintenanceMarginUsd: 250,
  settlementAsset: 'USDC',
  updatedAt: 1,
  fetchedAt: 2,
};

describe('Paradex portfolio reads', () => {
  const app = Fastify();
  beforeAll(async () => {
    await app.register(portfolioParadexRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('scopes account summary and connection leases to the authenticated account', async () => {
    store.fetchAccountSummary.mockResolvedValue(summary);
    const res = await app.inject({
      url: '/portfolio/paradex/account',
      headers: { 'x-account': 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...summary, accountId: 'alice', venue: 'paradex' });
    expect(store.fetchAccountSummary).toHaveBeenCalledWith('alice');
    expect(store.retain).toHaveBeenCalledWith('alice');
    expect(store.release).toHaveBeenCalledWith('alice');
  });

  it('returns connection guidance for disconnected accounts', async () => {
    store.fetchAccountSummary.mockResolvedValue(null);
    const res = await app.inject({ url: '/portfolio/paradex/account' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('venue_not_connected');
  });

  it('passes opaque cursors and preserves empty RFQ pages', async () => {
    store.fetchOpenRfqs.mockResolvedValue({ rfqs: [], next: 'next', fetchedAt: 2 });
    const res = await app.inject({
      url: '/portfolio/paradex/rfqs?underlying=BTC&cursor=a%2B%3D',
      headers: { 'x-account': 'bob' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.fetchOpenRfqs).toHaveBeenCalledWith('bob', 'BTC', 'a+=');
    expect(res.json()).toMatchObject({ accountId: 'bob', rfqs: [], next: 'next' });
  });

  it('rejects invalid underlyings before accessing a private client', async () => {
    const res = await app.inject({ url: '/portfolio/paradex/rfqs?underlying=BTC%2Faccount' });
    expect(res.statusCode).toBe(400);
    expect(store.fetchOpenRfqs).not.toHaveBeenCalled();
  });

  it.each([
    ['account', 'fetchAccountSummary'],
    ['rfqs?underlying=BTC', 'fetchOpenRfqs'],
  ] as const)('reports rejected credentials on %s and releases the connection', async (path, method) => {
    store[method].mockRejectedValue(new ParadexAuthError(403));
    const res = await app.inject({
      url: `/portfolio/paradex/${path}`,
      headers: { 'x-account': 'alice' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('venue_auth_rejected');
    expect(store.release).toHaveBeenCalledWith('alice');
  });

  it('surfaces upstream failures without leaking exception details', async () => {
    store.fetchOpenRfqs.mockRejectedValue(new Error('private detail'));
    const res = await app.inject({ url: '/portfolio/paradex/rfqs?underlying=ETH' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('private detail');
  });
});
