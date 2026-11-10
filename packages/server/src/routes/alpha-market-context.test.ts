import Fastify from 'fastify';
import { AlphaMarketContextResponseSchema } from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({
  candles: vi.fn(),
  richness: vi.fn(),
  iv: vi.fn(),
  regime: vi.fn(),
}));
vi.mock('../services.js', () => ({
  DAILY_SPOT_HISTORY_DAYS: 730,
  isIvHistoryReady: () => true,
  isRegimeReady: () => true,
  isSpotCandlesReady: () => true,
  ivHistoryService: { query: sources.iv },
  regimeService: { query: sources.regime },
  spotCandleService: { getCandles: sources.candles },
  spotService: { getSnapshot: () => ({ lastPrice: 75000 }) },
  volRichnessSource: { get: sources.richness },
}));
const { alphaMarketContextRoute } = await import('./alpha-market-context.js');

beforeEach(() => {
  sources.candles.mockResolvedValue([]);
  sources.iv.mockReturnValue(null);
  sources.regime.mockReturnValue(null);
  sources.richness.mockResolvedValue(null);
});
afterEach(() => vi.resetAllMocks());

describe('automatic market context endpoint', () => {
  it('rejects invalid observations before fetching data', async () => {
    const app = Fastify();
    await app.register(alphaMarketContextRoute);
    const response = await app.inject('/alpha/market-context?underlying=BTC&selectedIv=NaN');
    expect(response.statusCode).toBe(400);
    expect(sources.candles).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns a selected-horizon automatic assessment without a scenario or candidate', async () => {
    const app = Fastify();
    await app.register(alphaMarketContextRoute);
    const response = await app.inject(
      `/alpha/market-context?underlying=BTC&expiryTs=${Date.now() + 3 * 86400000}&selectedIv=0.4&ivAsOfMs=${Date.now()}`,
    );
    expect(response.statusCode).toBe(200);
    const result = AlphaMarketContextResponseSchema.parse(response.json());
    expect(result.automatic?.horizonSource).toBe('selected-expiry');
    expect(result.automatic?.horizonDays).toBeCloseTo(3, 3);
    expect(result.automatic?.pricing.atmIv).toBe(0.4);
    expect(result.automatic?.assessments['call-credit'].verdict).toBe('unavailable');
    expect(sources.candles).toHaveBeenCalledWith('BTC', 86400, 730);
    expect(sources.candles).toHaveBeenCalledWith('BTC', 3600, 240);
    await app.close();
  });

  it('retains daily context when the independent hourly history request fails', async () => {
    sources.candles.mockImplementation(async (_underlying: string, step: number) => {
      if (step === 3600) throw new Error('hourly unavailable');
      return [];
    });
    const app = Fastify();
    await app.register(alphaMarketContextRoute);
    const response = await app.inject('/alpha/market-context?underlying=BTC&horizonDays=30');
    expect(response.statusCode).toBe(200);
    expect(AlphaMarketContextResponseSchema.parse(response.json()).automatic?.horizonDays).toBe(30);
    await app.close();
  });
});
