import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { thalexMock } = vi.hoisted(() => ({ thalexMock: { getMargin: vi.fn() } }));

vi.mock('../../thalex-position-store.js', () => ({ thalexPositionStore: thalexMock }));
vi.mock('../../user-service.js', () => ({
  getRequestAccountId: (req: { headers: Record<string, string | undefined> }, fallback: string) =>
    req.headers['x-account'] ?? fallback,
}));

import { portfolioVenueMarginRoute } from './venue-margin.js';

describe('GET /portfolio/venue-margin', () => {
  const app = Fastify();

  beforeAll(async () => {
    await app.register(portfolioVenueMarginRoute);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects venues without margin support', async () => {
    const res = await app.inject({ method: 'GET', url: '/portfolio/venue-margin?venue=derive' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when thalex is not signed in', async () => {
    thalexMock.getMargin.mockReturnValueOnce(undefined);
    const res = await app.inject({ method: 'GET', url: '/portfolio/venue-margin?venue=thalex' });
    expect(res.statusCode).toBe(409);
  });

  it('returns 503 before thalex reports a summary', async () => {
    thalexMock.getMargin.mockReturnValueOnce(null);
    const res = await app.inject({ method: 'GET', url: '/portfolio/venue-margin?venue=thalex' });
    expect(res.statusCode).toBe(503);
  });

  it('returns the account initial margin', async () => {
    thalexMock.getMargin.mockReturnValueOnce({
      initialMarginUsd: 400,
      marginUsd: 1_000,
      remainingMarginUsd: 600,
      updatedAt: 5,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/portfolio/venue-margin?venue=thalex',
      headers: { 'x-account': 'acct-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(thalexMock.getMargin).toHaveBeenLastCalledWith('acct-1');
    expect(res.json()).toEqual({
      accountId: 'acct-1',
      venue: 'thalex',
      initialMarginUsd: 400,
      marginUsd: 1_000,
      remainingMarginUsd: 600,
      updatedAt: 5,
    });
  });
});
