import Fastify from 'fastify';
import { BotMarketResponseSchema } from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), fetch: vi.fn() }));
vi.mock('../chain-engines.js', () => ({ chainEngines: { acquire: mocks.acquire } }));
vi.mock('../services.js', () => ({
  newsService: null,
  newsDelivery: { cursor: 'abc:0', oldestCursor: null, size: 0 },
}));
import { botRoute } from './bot.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
beforeEach(() => {
  mocks.acquire.mockReset();
  mocks.release.mockReset();
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue({
    underlying: 'BTC',
    expiry: '2026-11-27',
    expiryTs: Date.now() + 86400000,
    dte: 1,
    stats: {
      forwardPriceUsd: null,
      indexPriceUsd: null,
      basisPct: null,
      atmStrike: null,
      atmIv: null,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    strikes: [],
    gex: [],
  });
  mocks.acquire.mockResolvedValue({
    release: mocks.release,
    runtime: {
      fetchSnapshotData: mocks.fetch,
      getHealth: () => [],
      getHealthDetails: () => [],
      getFailedVenues: () => [{ venue: 'okx', reason: 'not available' }],
    },
  });
});
async function app() {
  const app = Fastify();
  apps.push(app);
  await app.register(botRoute);
  return app;
}

describe('bot API contract', () => {
  it('returns schemas and explicitly unavailable capabilities', async () => {
    const server = await app();
    const schemas = await server.inject('/bot/schema');
    expect(schemas.statusCode).toBe(200);
    expect(schemas.json()).toMatchObject({
      market: { type: 'object' },
      newsEvents: { type: 'object' },
    });
    const status = await server.inject('/bot/status');
    expect(status.json()).toMatchObject({
      news: { health: null, classificationIsSentiment: false },
      capabilities: { macroCalendar: false, verifiedAccountFees: false },
    });
  });

  it('rejects bad venue and date requests before acquiring feeds', async () => {
    const server = await app();
    expect(
      (await server.inject('/bot/market?underlying=BTC&expiry=2026-02-31&venues=okx')).statusCode,
    ).toBe(400);
    expect(
      (await server.inject('/bot/market?underlying=BTC&expiry=2026-11-27&venues=unknown'))
        .statusCode,
    ).toBe(400);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it('does not mark missing markets ready and releases the shared runtime', async () => {
    const server = await app();
    const response = await server.inject('/bot/market?underlying=BTC&expiry=2026-11-27&venues=okx');
    const data = BotMarketResponseSchema.parse(response.json());
    expect(response.headers['cache-control']).toBe('no-store');
    expect(data.dataReady).toBe(false);
    expect(data.venues[0]).toMatchObject({ venue: 'okx', eligibleQuotes: 0 });
    expect(data.failedVenues[0]?.reason).toBe('not available');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('releases the runtime on source failure', async () => {
    mocks.fetch.mockRejectedValue(new Error('venue timeout'));
    const response = await (await app()).inject(
      '/bot/market?underlying=BTC&expiry=2026-11-27&venues=okx',
    );
    expect(response.statusCode).toBe(500);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
