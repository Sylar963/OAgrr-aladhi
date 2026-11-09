import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({
  store: {
    retain: vi.fn(),
    release: vi.fn(),
    fetchAccountEquity: vi.fn(),
    environment: vi.fn(),
  },
}));
vi.mock('../../thalex-position-store.js', () => ({ thalexPositionStore: store }));
vi.mock('../../user-service.js', () => ({
  getRequestAccountId: (req: { headers: Record<string, string | undefined> }, fallback: string) =>
    req.headers['x-account'] ?? fallback,
}));
import { portfolioThalexAccountRoute } from './thalex-account.js';

const summary = {
  equityUsd: 2400,
  cash: [{ asset: 'USDT', balance: 2000, valueUsd: 2000 }],
  marginUsd: 2350,
  requiredMarginUsd: 2450,
  remainingMarginUsd: -100,
  updatedAt: 1000,
};

describe('GET /portfolio/thalex/account', () => {
  const app = Fastify();
  beforeAll(async () => {
    await app.register(portfolioThalexAccountRoute);
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    store.fetchAccountEquity.mockResolvedValue(summary);
    store.environment.mockReturnValue('prod');
  });

  it('returns current equity separately from margin and ignores account overrides', async () => {
    const res = await app.inject({
      url: '/portfolio/thalex/account?accountId=bob',
      headers: { 'x-account': 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accountId: 'alice',
      venue: 'thalex',
      environment: 'prod',
      equityUsd: 2400,
      freeMarginUsd: -100,
      initialMarginUsd: 2450,
      unpricedAssets: [],
      updatedAt: 1000,
    });
    expect(store.fetchAccountEquity).toHaveBeenCalledWith('alice');
    expect(store.retain).toHaveBeenCalledWith('alice');
    expect(store.release).toHaveBeenCalledWith('alice');
  });

  it('preserves zero equity and missing margins on testnet', async () => {
    store.environment.mockReturnValue('test');
    store.fetchAccountEquity.mockResolvedValue({
      ...summary,
      equityUsd: 0,
      remainingMarginUsd: null,
      requiredMarginUsd: null,
    });
    const res = await app.inject({ url: '/portfolio/thalex/account' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      environment: 'test',
      equityUsd: 0,
      freeMarginUsd: null,
      initialMarginUsd: null,
    });
  });

  it('identifies assets excluded from equity because their price is missing', async () => {
    store.fetchAccountEquity.mockResolvedValue({
      ...summary,
      cash: [
        ...summary.cash,
        { asset: 'XYZ', balance: 10, valueUsd: null },
        { asset: 'EMPTY', balance: 0, valueUsd: null },
      ],
    });
    const res = await app.inject({ url: '/portfolio/thalex/account' });
    expect(res.json().unpricedAssets).toEqual(['XYZ']);
  });

  it('returns connection guidance and releases the lease if disconnected', async () => {
    store.fetchAccountEquity.mockResolvedValue(null);
    const res = await app.inject({
      url: '/portfolio/thalex/account',
      headers: { 'x-account': 'alice' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('venue_not_connected');
    expect(store.release).toHaveBeenCalledWith('alice');
  });

  it('does not expose upstream errors or return cached equity as a fresh read', async () => {
    store.fetchAccountEquity.mockRejectedValue(new Error('private upstream details'));
    const res = await app.inject({
      url: '/portfolio/thalex/account',
      headers: { 'x-account': 'alice' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('private upstream details');
    expect(store.release).toHaveBeenCalledWith('alice');
  });
});
