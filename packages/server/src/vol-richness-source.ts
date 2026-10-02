import {
  buildVolRichness,
  type IvHistoryResponse,
  type SpotCandle,
  type TenorIvSeries,
  type VolRichness,
} from '@oggregator/core';

import { mergeIvSeries } from './iv-baseline-history.js';
import { ResponseCache } from './response-cache.js';

const CACHE_TTL_MS = 5_000;
const IV_HISTORY_WINDOW_DAYS = 90;

interface WarnLogger {
  warn: (obj: object, msg: string) => void;
}

export interface VolRichnessSourceDeps {
  now: () => number;
  getDailyCandles: (underlying: string) => Promise<SpotCandle[]>;
  getIvHistory: (underlying: string, windowDays: 90) => IvHistoryResponse | null;
  getStoredIv: (underlying: string) => Promise<TenorIvSeries>;
  getDvolPercentile1y: (underlying: string) => number | null;
}

export interface VolRichnessSource {
  get(underlying: string, log: WarnLogger): Promise<VolRichness | null>;
}

/** Gathers spot, live IV, and stored IV history into one cached richness reading per underlying. */
export function createVolRichnessSource(deps: VolRichnessSourceDeps): VolRichnessSource {
  const cache = new ResponseCache<VolRichness | null>(CACHE_TTL_MS, 16);

  async function load(underlying: string, log: WarnLogger): Promise<VolRichness | null> {
    const ivHistory = deps.getIvHistory(underlying, IV_HISTORY_WINDOW_DAYS);
    if (ivHistory == null) return null;
    let dailyCandles: SpotCandle[] = [];
    try {
      dailyCandles = await deps.getDailyCandles(underlying);
    } catch (error: unknown) {
      log.warn({ error, underlying }, 'vol richness spot history unavailable');
    }
    if (dailyCandles.length === 0) return null;
    let stored: TenorIvSeries = { '7d': [], '30d': [] };
    try {
      stored = await deps.getStoredIv(underlying);
    } catch (error: unknown) {
      log.warn({ error, underlying }, 'vol richness stored IV history unavailable');
    }
    const recent7d = ivHistory.tenors['7d'];
    const recent30d = ivHistory.tenors['30d'];
    return buildVolRichness({
      underlying,
      nowMs: deps.now(),
      dailyCandles,
      recentIv: { '7d': recent7d.series, '30d': recent30d.series },
      baselineIv: {
        '7d': mergeIvSeries(stored['7d'], recent7d.series),
        '30d': mergeIvSeries(stored['30d'], recent30d.series),
      },
      percentile90d: { '7d': recent7d.atmPercentile, '30d': recent30d.atmPercentile },
      dvolPercentile1y: deps.getDvolPercentile1y(underlying),
    });
  }

  return {
    get(underlying, log) {
      const key = underlying.toUpperCase();
      return cache.get(key, () => load(key, log));
    },
  };
}
