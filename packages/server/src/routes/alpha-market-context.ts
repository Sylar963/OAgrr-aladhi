import type { SpotCandle, VolRichness } from '@oggregator/core';
import {
  AlphaMarketContextQuerySchema,
  isSpotCandleUnderlying,
  type AlphaMarketContextResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { buildAlphaMarketContext } from '../alpha-market-context.js';
import {
  DAILY_SPOT_HISTORY_DAYS,
  isIvHistoryReady,
  isRegimeReady,
  isSpotCandlesReady,
  ivHistoryService,
  regimeService,
  spotCandleService,
  spotService,
  volRichnessSource,
} from '../services.js';

export async function alphaMarketContextRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying?: string } }>(
    '/alpha/market-context',
    async (
      req,
      reply,
    ): Promise<AlphaMarketContextResponse | { error: string; details?: unknown }> => {
      const parsed = AlphaMarketContextQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid Alpha market context query',
          details: parsed.error.flatten(),
        });
      }

      const { underlying, ...horizon } = parsed.data;
      const ivHistory = isIvHistoryReady() ? ivHistoryService.query(underlying, 90) : null;
      let candles: SpotCandle[] = [];
      let hourlyCandles: SpotCandle[] = [];
      if (isSpotCandlesReady() && isSpotCandleUnderlying(underlying)) {
        const [daily, hourly] = await Promise.allSettled([
          spotCandleService.getCandles(underlying, 86_400, DAILY_SPOT_HISTORY_DAYS),
          spotCandleService.getCandles(underlying, 3_600, 240),
        ]);
        if (daily.status === 'fulfilled') candles = daily.value;
        else
          req.log.warn(
            { error: daily.reason, underlying },
            'Alpha market context spot history unavailable',
          );
        if (hourly.status === 'fulfilled') hourlyCandles = hourly.value;
        else
          req.log.warn(
            { error: hourly.reason, underlying },
            'Alpha hourly context unavailable; using completed daily history',
          );
      }
      const regime =
        isRegimeReady() && (underlying === 'BTC' || underlying === 'ETH')
          ? regimeService.query(underlying)
          : null;

      let richness: VolRichness | null = null;
      try {
        richness = await volRichnessSource.get(underlying, req.log);
      } catch (error: unknown) {
        req.log.warn({ error, underlying }, 'Alpha market context vol richness unavailable');
      }

      return buildAlphaMarketContext({
        underlying,
        nowMs: Date.now(),
        spotPrice: spotService.getSnapshot(underlying)?.lastPrice ?? candles.at(-1)?.close ?? null,
        ivHistory,
        candles,
        regime,
        richness,
        hourlyCandles,
        horizon,
      });
    },
  );
}
