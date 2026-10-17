import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  getColumns: vi.fn(),
  getMeta: vi.fn(() => ({ expiries: ['2026-11-06', '2026-11-27'], instruments: 19, updatedAt: 1 })),
}));

vi.mock('../services.js', () => ({ volHeatmapRuntime: runtime }));

const { volHeatmapRoute } = await import('./vol-heatmap.js');

async function build() {
  const app = Fastify();
  await app.register(volHeatmapRoute, { prefix: '/api' });
  return app;
}

afterEach(() => vi.useRealTimers());

describe('GET /api/vol-heatmap', () => {
  it('merges buffered columns to the requested resolution', async () => {
    vi.useFakeTimers({ now: 10 * 60_000, toFake: ['Date'] });
    runtime.getColumns.mockReturnValue([
      { t: 0, dvol: 0.37, cells: [[148, 100, 0]], trades: [] },
      { t: 15_000, dvol: 0.371, cells: [[148, 50, 20]], trades: [] },
    ]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=btc&hours=1&resolutionSec=60' });

    expect(res.statusCode).toBe(200);
    expect(runtime.getColumns).toHaveBeenCalledWith('BTC', 0);
    expect(res.json()).toMatchObject({
      currency: 'BTC',
      resolutionSec: 60,
      bucketSize: 0.0025,
      meta: { instruments: 19 },
      columns: [{ t: 0, dvol: 0.371, cells: [[148, 75, 10]] }],
    });
  });

  it('re-sends the slot that `since` falls in', async () => {
    vi.useFakeTimers({ now: 10 * 60_000, toFake: ['Date'] });
    runtime.getColumns.mockReturnValue([]);
    const app = await build();
    await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=ETH&resolutionSec=60&since=185000' });
    expect(runtime.getColumns).toHaveBeenLastCalledWith('ETH', 180_000);
  });

  it('rejects unsupported currencies and resolutions', async () => {
    const app = await build();
    expect((await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=SOL' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=BTC&resolutionSec=30' })).statusCode).toBe(400);
  });
});
