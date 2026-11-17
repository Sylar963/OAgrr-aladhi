import Fastify from 'fastify';
import { TimeAtPriceResponseSchema } from '@oggregator/protocol';
import { afterEach, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({ candles: vi.fn() }));
vi.mock('../services.js', () => ({
  isSpotCandlesReady: () => true,
  spotCandleService: { getCandleHistory: sources.candles },
}));
const { timeAtPriceRoute } = await import('./time-at-price.js');
afterEach(() => vi.useRealTimers());

it('serves completed hourly comparisons with bounds from valid counted candles', async () => {
  const hour = 3_600_000;
  const start = Date.UTC(2026, 0, 1);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start + 3.5 * hour);
  sources.candles.mockResolvedValue([
    { timestamp: start - hour, low: 0, high: 101, close: 100 },
    { timestamp: start, low: 100, high: 101, close: 100 },
    { timestamp: start + hour, low: 100, high: 102, close: 101 },
    { timestamp: start + 2 * hour, low: 100, high: 104, close: 103 },
    { timestamp: start + 3 * hour, low: 100, high: 120, close: 110 },
    { timestamp: start + 4 * hour, low: 100, high: 150, close: 130 },
  ]);
  const app = Fastify();
  await app.register(timeAtPriceRoute);
  try {
    const response = await app.inject('/time-at-price?underlying=BTC&lookbackDays=90');
    expect(response.statusCode).toBe(200);
    const result = TimeAtPriceResponseSchema.parse(response.json());
    expect(result.bars).toBe(3);
    expect(result.from).toBe(start);
    expect(result.to).toBe(start + 2 * hour);
    expect(result.spot).toBe(103);
    expect(result.dailyActivity[0]!.bars).toBe(3);
    expect(result.dailyActivity[0]!.hourlyRanges[3]).toBeNull();
    expect(result.hoursByLevel.reduce((sum, level) => sum + level.bars, 0)).toBe(3);
    expect(result.volByLevel).toEqual([]);
  } finally {
    await app.close();
  }
});
