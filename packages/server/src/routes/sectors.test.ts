import {
  CryptoSectorCorrelationResponseSchema,
  CryptoSectorsResponseSchema,
} from '@oggregator/protocol';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const { getSnapshot, getCandles } = vi.hoisted(() => ({ getSnapshot: vi.fn(), getCandles: vi.fn() }));

vi.mock('@oggregator/core', () => ({
  getAllAdapters: vi.fn(() => [
    { venue: 'deribit', listUnderlyings: vi.fn(async () => ['BTC', 'ETH']) },
    { venue: 'paradex', listUnderlyings: vi.fn(async () => ['BTC', 'XAU']) },
  ]),
}));
vi.mock('../services.js', () => ({
  perpTickerService: { getSnapshot },
  perpCandleService: { getCandles },
}));

import { sectorsRoute } from './sectors.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(sectorsRoute);
  await app.ready();
  return app;
}

describe('GET /sectors', () => {
  it('returns 503 until Bybit tickers have loaded once', async () => {
    getSnapshot.mockRejectedValueOnce(new Error('HTTP 503'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/sectors' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('serves a schema-valid board with RWA priced from Bybit', async () => {
    getSnapshot.mockResolvedValueOnce({
      fetchedAt: 1,
      tickers: new Map([
        ['BTCUSDT', { symbol: 'BTCUSDT', lastPrice: 70_000, change24hPct: 0.01 }],
        ['XAUUSDT', { symbol: 'XAUUSDT', lastPrice: 4_180, change24hPct: 0.004 }],
      ]),
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/sectors' });
    expect(res.statusCode).toBe(200);
    const body = CryptoSectorsResponseSchema.parse(res.json());
    expect(body.venueCount).toBe(2);
    const rwa = body.baskets.find((b) => b.id === 'rwa')!;
    expect(rwa.members[0]).toMatchObject({ symbol: 'XAU', last: 4_180, optionVenues: ['paradex'] });
    expect(body.baskets.find((b) => b.id === 'majors')!.members[0]!.optionVenues).toEqual([
      'deribit',
      'paradex',
    ]);
    await app.close();
  });
});

describe('GET /sectors/correlation', () => {
  const BAR = 300_000;
  const last = 1_792_718_400_000;
  const flat = new Map([
    ['BTCUSDT', [{ start: last - BAR, close: 1, volume: 1 }, { start: last, close: 1, volume: 1 }]],
  ]);

  it('returns 503 until any Bybit candles have loaded', async () => {
    getCandles.mockResolvedValueOnce({ barMs: BAR, lastClosedStart: last, series: new Map() });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/sectors/correlation' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('computes once per closed bar', async () => {
    getCandles.mockResolvedValue({ barMs: BAR, lastClosedStart: last, series: flat });
    const app = await buildApp();
    const first = await app.inject({ method: 'GET', url: '/sectors/correlation' });
    expect(first.statusCode).toBe(200);
    const body = CryptoSectorCorrelationResponseSchema.parse(first.json());
    expect(body.sectorIds).toContain('majors');
    expect(body.asOf).toBe(last + BAR);
    const second = await app.inject({ method: 'GET', url: '/sectors/correlation' });
    expect(second.body).toBe(first.body);
    expect(getCandles.mock.calls[0]![0]).toContain('BTCUSDT');
    await app.close();
  });
});
