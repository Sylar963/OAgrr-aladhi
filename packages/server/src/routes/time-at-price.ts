import { buildTimeAtPrice, type SpotCandle } from '@oggregator/core';
import {
  TIME_AT_PRICE_LOOKBACK_DAYS,
  TIME_AT_PRICE_RESOLUTION_SEC,
  type TimeAtPriceResponse,
  TimeAtPriceQuerySchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { ResponseCache } from '../response-cache.js';
import { isSpotCandlesReady, spotCandleService } from '../services.js';

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 15 * 60_000;
const VOL_WINDOW_HOURS = 7 * 24;
const HOURS_PER_YEAR = 365 * 24;
const TARGET_LEVELS = 400;
const TARGET_VOL_BINS = 18;
const MAX_LOOKBACK_DAYS = Math.max(...TIME_AT_PRICE_LOOKBACK_DAYS);

// One max-span pull per underlying serves every lookback; the extra week warms the vol window.
const historyCache = new ResponseCache<SpotCandle[]>(CACHE_TTL_MS, 8);
const responseCache = new ResponseCache<TimeAtPriceResponse | null>(CACHE_TTL_MS, 32);

async function compute(underlying: 'BTC' | 'ETH' | 'HYPE', lookbackDays: number) {
  const candles = await historyCache.get(underlying, () =>
    spotCandleService.getCandleHistory(
      underlying,
      TIME_AT_PRICE_RESOLUTION_SEC,
      (MAX_LOOKBACK_DAYS + 7) * DAY_MS,
    ),
  );
  const asOf = Date.now();
  const profile = buildTimeAtPrice(candles, {
    fromTs: asOf - lookbackDays * DAY_MS,
    volWindowBars: VOL_WINDOW_HOURS,
    barsPerYear: HOURS_PER_YEAR,
    targetLevels: TARGET_LEVELS,
    targetVolBins: TARGET_VOL_BINS,
  });
  const last = candles[candles.length - 1];
  if (profile == null || last == null) return null;
  const firstCounted = candles.find((c) => c.timestamp >= asOf - lookbackDays * DAY_MS)!;
  return {
    underlying,
    asOf,
    lookbackDays,
    resolutionSec: TIME_AT_PRICE_RESOLUTION_SEC,
    from: firstCounted.timestamp,
    to: last.timestamp,
    bars: profile.bars,
    spot: last.close,
    binSize: profile.binSize,
    volBinSize: profile.volBinSize,
    volWindowHours: VOL_WINDOW_HOURS,
    levels: profile.levels,
    volByLevel: profile.volByLevel,
    dailyCloses: profile.dailyCloses,
  } satisfies TimeAtPriceResponse;
}

export async function timeAtPriceRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying?: string; lookbackDays?: string } }>(
    '/time-at-price',
    async (req, reply) => {
      if (!isSpotCandlesReady()) {
        return reply.status(503).send({ error: 'Spot candle service not available' });
      }
      const parsed = TimeAtPriceQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid time-at-price query',
          details: parsed.error.flatten(),
        });
      }
      const { underlying, lookbackDays } = parsed.data;
      try {
        const result = await responseCache.get(`${underlying}:${lookbackDays}`, () =>
          compute(underlying, lookbackDays),
        );
        if (result == null) return reply.status(404).send({ error: 'no candle history' });
        return result;
      } catch (err: unknown) {
        req.log.warn({ err: String(err), underlying }, 'time-at-price fetch failed');
        return reply.status(502).send({ error: 'Upstream candle fetch failed' });
      }
    },
  );
}
