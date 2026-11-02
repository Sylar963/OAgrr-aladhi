import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const aggregated = vi.fn();
const perp = vi.fn();
vi.mock('../services.js', () => ({
  aggregatedSpotRuntime: { getCandles: aggregated },
  isSpotCandlesReady: () => true,
  spotCandleService: { getCandles: perp },
}));

const { spotCandlesRoute } = await import('./spot-candles.js');

const CANDLE = { timestamp: 60_000, open: 1, high: 2, low: 1, close: 2, volume: 3, venues: 3 };

async function request(query: string) {
  const app = Fastify();
  await app.register(spotCandlesRoute, { prefix: '/api' });
  return app.inject({ method: 'GET', url: `/api/spot-candles?${query}` });
}

describe('GET /api/spot-candles', () => {
  beforeEach(() => {
    aggregated.mockReset();
    perp.mockReset();
    aggregated.mockResolvedValue({ candles: [CANDLE], sources: ['binance'] });
    perp.mockResolvedValue([CANDLE]);
  });

  it('serves crypto tickers from the spot aggregate', async () => {
    const response = await request('currency=btc&resolution=300&buckets=10');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currency: 'BTC',
      resolution: 300,
      count: 1,
      candles: [CANDLE],
      sources: ['binance'],
    });
    expect(aggregated).toHaveBeenCalledWith('BTC', 300, 10);
    expect(perp).not.toHaveBeenCalled();
  });

  it('serves the perp when asked', async () => {
    await request('currency=BTC&resolution=300&buckets=10&source=perp');
    expect(perp).toHaveBeenCalledWith('BTC', 300, 10);
    expect(aggregated).not.toHaveBeenCalled();
  });

  it('keeps tickers without aggregated spot on the existing candles', async () => {
    await request('currency=META&resolution=300&buckets=10');
    expect(perp).toHaveBeenCalledWith('META', 300, 10);
    expect(aggregated).not.toHaveBeenCalled();
  });

  it.each(['currency=NOPE&resolution=300', 'currency=BTC&resolution=7'])('rejects %s', async (query) => {
    expect((await request(query)).statusCode).toBe(400);
  });

  it('reports failure rather than falling back to the perp when no venue has candles', async () => {
    aggregated.mockResolvedValue({ candles: [], sources: [] });
    const response = await request('currency=BTC&resolution=300&buckets=10');
    expect(response.statusCode).toBe(502);
    expect(perp).not.toHaveBeenCalled();
  });
});
