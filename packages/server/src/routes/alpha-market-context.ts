import type { SpotCandle, SpotCandleCurrency } from '@oggregator/core';
import {
  AlphaMarketContextQuerySchema,
  type AlphaMarketContextResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { buildAlphaMarketContext } from '../alpha-market-context.js';
import {
  isIvHistoryReady,
  isRegimeReady,
  isSpotCandlesReady,
  ivHistoryService,
  regimeService,
  spotCandleService,
  spotService,
} from '../services.js';

const SPOT_HISTORY_UNDERLYINGS = new Set<SpotCandleCurrency>(['BTC', 'ETH', 'HYPE']);

export async function alphaMarketContextRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying?: string } }>(
    '/alpha/market-context',
    async (req, reply): Promise<AlphaMarketContextResponse | { error: string; details?: unknown }> => {
      const parsed = AlphaMarketContextQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid Alpha market context query',
          details: parsed.error.flatten(),
        });
      }

      const { underlying } = parsed.data;
      const ivHistory = isIvHistoryReady() ? ivHistoryService.query(underlying, 90) : null;
      let candles: SpotCandle[] = [];
      if (isSpotCandlesReady() && SPOT_HISTORY_UNDERLYINGS.has(underlying as SpotCandleCurrency)) {
        try {
          candles = await spotCandleService.getCandles(
            underlying as SpotCandleCurrency,
            86_400,
            200,
          );
        } catch (error: unknown) {
          req.log.warn({ error, underlying }, 'Alpha market context spot history unavailable');
        }
      }
      const regime =
        isRegimeReady() && (underlying === 'BTC' || underlying === 'ETH')
          ? regimeService.query(underlying)
          : null;

      return buildAlphaMarketContext({
        underlying,
        nowMs: Date.now(),
        spotPrice: spotService.getSnapshot(underlying)?.lastPrice ?? candles.at(-1)?.close ?? null,
        ivHistory,
        candles,
        regime,
      });
    },
  );
}
