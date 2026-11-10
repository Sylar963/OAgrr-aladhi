import type { AlphaEvaluationMarket, SpotCandle, TenorIvSeries } from '@oggregator/core';
import { isSpotCandleUnderlying } from '@oggregator/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { mergeIvSeries } from './iv-baseline-history.js';
import {
  DAILY_SPOT_HISTORY_DAYS,
  isIvHistoryReady,
  isRegimeReady,
  isSpotCandlesReady,
  ivBaselineHistory,
  ivHistoryService,
  regimeService,
  spotCandleService,
} from './services.js';

export async function loadAlphaEvaluationMarket(
  underlying: string,
  log: FastifyBaseLogger,
): Promise<AlphaEvaluationMarket> {
  const ivHistory = isIvHistoryReady() ? ivHistoryService.query(underlying, 90) : null;
  const [candles, stored] = await Promise.all([
    (async (): Promise<SpotCandle[]> => {
      if (!isSpotCandlesReady() || !isSpotCandleUnderlying(underlying)) return [];
      try {
        return await spotCandleService.getCandles(underlying, 86_400, DAILY_SPOT_HISTORY_DAYS);
      } catch (error: unknown) {
        log.warn({ error, underlying }, 'Alpha evaluation price history unavailable');
        return [];
      }
    })(),
    (async (): Promise<TenorIvSeries> => {
      try {
        return await ivBaselineHistory.get(underlying);
      } catch (error: unknown) {
        log.warn({ error, underlying }, 'Alpha evaluation IV baseline unavailable');
        return { '7d': [], '30d': [] };
      }
    })(),
  ]);
  return {
    candles,
    ivHistory,
    baselineIv: {
      '7d': mergeIvSeries(stored['7d'], ivHistory?.tenors['7d'].series ?? []),
      '30d': mergeIvSeries(stored['30d'], ivHistory?.tenors['30d'].series ?? []),
    },
    regime:
      isRegimeReady() && (underlying === 'BTC' || underlying === 'ETH')
        ? regimeService.query(underlying)
        : null,
  };
}
