import { logger, type SpotCandleResolutionSec } from '@oggregator/core';
import { NoopThesisStore, PostgresThesisStore, type ThesisStore } from '@oggregator/db';
import { isSpotCandleUnderlying, type PortfolioSource } from '@oggregator/protocol';

import { getAllExpiriesGex } from './gex-all-expiries.js';
import {
  ensureChainsForBook,
  getChainStats,
  isPositionSourceLive,
  listPositions,
  portfolioMarkProvider,
  subscribePositionStores,
} from './portfolio-services.js';
import { dvolService, spotCandleService, spotService } from './services.js';
import { ThesisService } from './thesis-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVALUATE_INTERVAL_MS = 5 * 60 * 1000;
const BOOK_SOURCES: readonly PortfolioSource[] = ['thalex', 'derive', 'paradex', 'manual'];

const store: ThesisStore = process.env['DATABASE_URL']
  ? PostgresThesisStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopThesisStore();

export const thesisService = new ThesisService({
  store,
  cachePath: process.env['THESIS_CACHE_PATH'] ?? '.cache/theses.ndjson',
  flushIntervalMs: DAY_MS,
  evaluateIntervalMs: EVALUATE_INTERVAL_MS,
  bookSources: BOOK_SOURCES,
  log: logger,
  market: {
    spotUsd: (underlying) => spotService.getSnapshot(underlying)?.lastPrice ?? null,
    candles: async (underlying, resolutionSec, buckets) => {
      if (!isSpotCandleUnderlying(underlying)) return [];
      const candles = await spotCandleService.getCandles(
        underlying,
        resolutionSec as SpotCandleResolutionSec,
        buckets,
      );
      return candles.map((candle) => ({ timestamp: candle.timestamp, close: candle.close }));
    },
    chainStats: async (underlying, expiry) => {
      const stats = await getChainStats(underlying, expiry);
      return stats == null ? null : { atmIv: stats.atmIv, skew25d: stats.skew25d };
    },
    dvol: (underlying) => dvolService.getSnapshot(underlying)?.current ?? null,
    netGexUsdMillions: async (underlying) => {
      const gex = await getAllExpiriesGex(underlying);
      return gex.gexProfile.find((point) => Math.abs(point.movePct) < 1e-9)?.gexUsdMillions ?? null;
    },
  },
  book: {
    heldBook: async (accountId, source, underlying) => {
      if (!isPositionSourceLive(accountId, source)) return { live: false, legs: [] };
      const legs = listPositions(accountId, source).filter((leg) => leg.underlying === underlying);
      await ensureChainsForBook(legs);
      return { live: true, legs: legs.map((leg) => ({ leg, mark: portfolioMarkProvider(leg) })) };
    },
    subscribe: subscribePositionStores,
  },
});

export async function disposeThesisServices(): Promise<void> {
  thesisService.dispose();
  await store.dispose();
}
