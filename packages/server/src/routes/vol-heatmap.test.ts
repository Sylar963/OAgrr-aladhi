import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  getColumns: vi.fn(),
  getMeta: vi.fn(() => ({ expiries: ['2026-11-06', '2026-11-27'], instruments: 19, updatedAt: 1 })),
}));

vi.mock('../services.js', () => ({ volHeatmapRuntime: runtime }));

const { autoResolutionSec, volHeatmapRoute } = await import('./vol-heatmap.js');

const HOUR = 3_600_000;

async function build() {
  const app = Fastify();
  await app.register(volHeatmapRoute, { prefix: '/api' });
  return app;
}

const column = (t: number, bid: number) => ({
  t,
  dvol: 0.37,
  cells: [[148, bid, 0]],
  adjCells: [[147, bid, 0]],
  atmMid: 0.37,
  trades: [],
});

afterEach(() => vi.useRealTimers());

describe('autoResolutionSec', () => {
  it('uses the finest resolution that keeps the span under 480 columns', () => {
    expect(autoResolutionSec(20 * 60_000)).toBe(15);
    expect(autoResolutionSec(2 * HOUR)).toBe(15);
    expect(autoResolutionSec(3 * HOUR)).toBe(60);
    expect(autoResolutionSec(24 * HOUR)).toBe(300);
  });
});

describe('GET /api/vol-heatmap', () => {
  it('merges buffered columns to an explicit resolution', async () => {
    vi.useFakeTimers({ now: 10 * 60_000, toFake: ['Date'] });
    runtime.getColumns.mockReturnValue([column(0, 100), column(15_000, 50)]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=btc&hours=1&resolutionSec=60' });

    expect(res.statusCode).toBe(200);
    expect(runtime.getColumns).toHaveBeenCalledWith('BTC', 10 * 60_000 - HOUR);
    expect(res.json()).toMatchObject({
      currency: 'BTC',
      resolutionSec: 60,
      bucketSize: 0.0025,
      meta: { instruments: 19 },
      columns: [{ t: 0, cells: [[148, 75, 0]] }],
    });
  });

  it('picks the resolution from the buffered span when none is requested', async () => {
    vi.useFakeTimers({ now: 5 * HOUR, toFake: ['Date'] });
    runtime.getColumns.mockReturnValue([column(5 * HOUR - 30 * 60_000, 10), column(5 * HOUR - 15_000, 20)]);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=BTC&hours=6' });
    expect(res.json()).toMatchObject({ resolutionSec: 15 });
    expect(res.json().columns).toHaveLength(2);
  });

  it('re-sends only the slot that `since` falls in onward', async () => {
    vi.useFakeTimers({ now: 10 * 60_000, toFake: ['Date'] });
    runtime.getColumns.mockReturnValue([column(120_000, 1), column(180_000, 2), column(195_000, 4)]);
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vol-heatmap?currency=ETH&resolutionSec=60&since=185000',
    });
    expect(res.json().columns).toEqual([
      { t: 180_000, dvol: 0.37, cells: [[148, 3, 0]], adjCells: [[147, 3, 0]], atmMid: 0.37, trades: [] },
    ]);
  });

  it('rejects unsupported currencies and resolutions', async () => {
    const app = await build();
    expect((await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=SOL' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/vol-heatmap?currency=BTC&resolutionSec=30' })).statusCode).toBe(400);
  });
});
