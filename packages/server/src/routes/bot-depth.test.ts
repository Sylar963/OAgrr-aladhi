import Fastify from 'fastify';
import { PublicDepthError } from '@oggregator/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), snapshot: vi.fn() }));
vi.mock('../chain-engines.js', () => ({ chainEngines: { acquire: mocks.acquire } }));
import { botDepthRoute } from './bot-depth.js';
const apps: ReturnType<typeof Fastify>[] = [];
const url =
  '/bot/depth?venue=okx&underlying=BTC&expiry=2026-11-27&instrument=BTC-USD-261127-56000-C';
beforeEach(() => {
  mocks.release.mockReset();
  mocks.acquire.mockReset();
  mocks.snapshot.mockReset();
  mocks.snapshot.mockResolvedValue({ dataReady: true, reasons: [] });
  mocks.acquire.mockResolvedValue({
    release: mocks.release,
    runtime: {
      getHealthDetails: () => [
        {
          venue: 'okx',
          underlying: 'BTC',
          state: 'connected',
          transport: null,
          exchange: null,
          activity: { lastDataAt: 1, ageMs: 0, staleAfterMs: 180000 },
        },
      ],
      fetchSnapshotData: async () => ({
        strikes: [
          {
            call: {
              venues: {
                okx: {
                  execution: { exchangeSymbol: 'BTC-USD-261127-56000-C' },
                  underlyingPriceUsd: 56000,
                  asOfMs: 1,
                },
              },
            },
            put: { venues: {} },
          },
        ],
      }),
    },
  });
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
async function app() {
  const server = Fastify();
  apps.push(server);
  await server.register(botDepthRoute, { runtime: { snapshot: mocks.snapshot } });
  return server;
}
describe('public bot depth route', () => {
  it('resolves the exact canonical instrument and releases its runtime', async () => {
    const response = await (await app()).inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mocks.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ venue: 'okx', access: 'api' }),
      expect.objectContaining({ underlyingPriceUsd: 56000 }),
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rejects invalid and unlisted symbols without making a provider request', async () => {
    const server = await app();
    expect((await server.inject(url + '&levels=500')).statusCode).toBe(400);
    expect((await server.inject(url.replace('56000-C', '99999-C'))).statusCode).toBe(404);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it.each([
    ['capacity', 429],
    ['upstream-http', 503],
    ['unsupported-access', 400],
  ] as const)('maps %s to %s', async (reason, status) => {
    mocks.snapshot.mockRejectedValue(new PublicDepthError(reason));
    const response = await (await app()).inject(url);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: 'public_depth_unavailable', reason });
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
