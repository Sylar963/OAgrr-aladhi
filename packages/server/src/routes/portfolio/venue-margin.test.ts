import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { thalexMock } = vi.hoisted(() => ({ thalexMock: { getMargin: vi.fn() } }));
const { paradexMock } = vi.hoisted(() => ({
  paradexMock: {
    retain: vi.fn(),
    release: vi.fn(),
    fetchAccountSummary: vi.fn(),
  },
}));

vi.mock('../../thalex-position-store.js', () => ({ thalexPositionStore: thalexMock }));
vi.mock('../../paradex-position-store.js', () => ({ paradexPositionStore: paradexMock }));
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

  it('returns Paradex reported maintenance margin without applying the Thalex ratio', async () => {
    paradexMock.fetchAccountSummary.mockResolvedValueOnce({
      equityUsd: 1000,
      initialMarginUsd: 400,
      freeCollateralUsd: 600,
      maintenanceMarginUsd: 180,
      fetchedAt: 5,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/portfolio/venue-margin?venue=paradex',
      headers: { 'x-account': 'acct-p' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      venue: 'paradex',
      marginUsd: 1000,
      maintenanceMarginUsd: 180,
    });
    expect(paradexMock.fetchAccountSummary).toHaveBeenCalledWith('acct-p');
    expect(paradexMock.release).toHaveBeenCalledWith('acct-p');
  });

  it('withholds missing Paradex margin instead of inventing a zero', async () => {
    paradexMock.fetchAccountSummary.mockResolvedValueOnce({
      equityUsd: 1000,
      initialMarginUsd: null,
      freeCollateralUsd: null,
    });
    const res = await app.inject({ method: 'GET', url: '/portfolio/venue-margin?venue=paradex' });
    expect(res.statusCode).toBe(503);
  });
});
