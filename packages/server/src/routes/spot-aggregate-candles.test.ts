import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCandles = vi.fn();
vi.mock('../services.js', () => ({ aggregatedSpotRuntime: { getCandles } }));

const { aggregatedSpotCandlesRoute } = await import('./spot-aggregate-candles.js');

const CANDLE = { timestamp: 60_000, open: 1, high: 2, low: 1, close: 2, volume: 3, venues: 7 };

async function request(query: string) {
  const app = Fastify();
  await app.register(aggregatedSpotCandlesRoute, { prefix: '/api' });
  return app.inject({ method: 'GET', url: `/api/spot-aggregate-candles?${query}` });
}

describe('GET /api/spot-aggregate-candles', () => {
  beforeEach(() => {
    getCandles.mockReset();
    getCandles.mockResolvedValue({ candles: [CANDLE], sources: ['deribit'] });
  });

  it('returns candles and the venues behind them', async () => {
    const response = await request('currency=btc&resolution=300&buckets=10');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currency: 'BTC',
      resolution: 300,
      count: 1,
      candles: [CANDLE],
      sources: ['deribit'],
    });
    expect(getCandles).toHaveBeenCalledWith('BTC', 300, 10);
  });

  it('rejects tickers without real spot rather than serving perps', async () => {
    const response = await request('currency=META&resolution=300&buckets=10');
    expect(response.statusCode).toBe(400);
    expect(getCandles).not.toHaveBeenCalled();
  });

  it.each(['resolution=7&buckets=10', 'resolution=300&buckets=0', 'resolution=300&buckets=3001', 'buckets=10'])(
    'rejects %s',
    async (query) => {
      const response = await request(`currency=BTC&${query}`);
      expect(response.statusCode).toBe(400);
    },
  );

  it('reports failure when no venue has candles', async () => {
    getCandles.mockResolvedValue({ candles: [], sources: [] });
    const response = await request('currency=BTC&resolution=300&buckets=10');
    expect(response.statusCode).toBe(502);
  });
});
