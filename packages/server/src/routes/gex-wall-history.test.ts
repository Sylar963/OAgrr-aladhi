import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../services.js', () => ({
  gexWallHistoryService: { query: queryMock },
}));

import { gexWallHistoryRoute } from './gex-wall-history.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(gexWallHistoryRoute);
  await app.ready();
  return app;
}

describe('GET /gex-wall-history', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation((underlying: string) => ({
      underlying,
      resolutionSec: 900,
      points: [{ ts: 900_000, spot: 61_800, callWall: 70_000, putWall: 57_500, gammaFlip: null }],
    }));
  });

  it('returns the in-memory series with a default 30-day window', async () => {
    const res = await app.inject({ method: 'GET', url: '/gex-wall-history?underlying=btc' });
    expect(res.statusCode).toBe(200);
    expect(queryMock).toHaveBeenCalledWith('BTC', 30);
    expect(res.json()).toEqual({
      underlying: 'BTC',
      resolutionSec: 900,
      points: [{ ts: 900_000, spot: 61_800, callWall: 70_000, putWall: 57_500, gammaFlip: null }],
    });
  });

  it('passes an explicit day window through', async () => {
    const res = await app.inject({ method: 'GET', url: '/gex-wall-history?underlying=ETH&days=90' });
    expect(res.statusCode).toBe(200);
    expect(queryMock).toHaveBeenCalledWith('ETH', 90);
  });

  it.each([
    '/gex-wall-history',
    '/gex-wall-history?underlying=BTC&days=0',
    '/gex-wall-history?underlying=BTC&days=91',
    '/gex-wall-history?underlying=BTC&days=abc',
  ])('rejects invalid query %s', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
