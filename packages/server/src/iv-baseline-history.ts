import type { IvHistoryPoint } from '@oggregator/core';
import type { IvHistoryStore, PersistedIvHistoryPoint } from '@oggregator/db';

import type { StraddleIvSeries } from './alpha-straddle-scanner.js';

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 400;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  loadedAt: number;
  series: Promise<StraddleIvSeries>;
}

export interface IvBaselineHistoryOptions {
  lookbackDays?: number;
  ttlMs?: number;
  now?: () => number;
}

function toPoint(row: PersistedIvHistoryPoint): IvHistoryPoint {
  return {
    ts: row.ts.getTime(),
    atmIv: row.atmIv,
    rr25d: row.rr25d,
    bfly25d: row.bfly25d,
    rr10d: row.rr10d,
    bfly10d: row.bfly10d,
  };
}

/** Daily long-range history before the recent in-memory series, recent points after it. */
export function mergeIvSeries(
  daily: readonly IvHistoryPoint[],
  recent: readonly IvHistoryPoint[],
): IvHistoryPoint[] {
  const recentStart = recent[0]?.ts ?? Number.POSITIVE_INFINITY;
  return [...daily.filter((point) => point.ts < recentStart), ...recent];
}

/**
 * The premium baseline needs several non-overlapping windows of the tenor length (four
 * 30-day windows is ~4 months), which the 90-day in-memory IV buffer cannot hold. Reads a
 * daily-sampled series from the store and caches it per underlying.
 */
export class IvBaselineHistory {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly lookbackDays: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: Pick<IvHistoryStore, 'enabled' | 'loadDaily'>,
    options: IvBaselineHistoryOptions = {},
  ) {
    this.lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async get(underlying: string): Promise<StraddleIvSeries> {
    if (!this.store.enabled) return { '7d': [], '30d': [] };
    const key = underlying.toUpperCase();
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached != null && now - cached.loadedAt < this.ttlMs) return cached.series;

    const series = this.load(key, now);
    this.cache.set(key, { loadedAt: now, series });
    series.catch(() => {
      if (this.cache.get(key)?.series === series) this.cache.delete(key);
    });
    return series;
  }

  private async load(underlying: string, now: number): Promise<StraddleIvSeries> {
    const rows = await this.store.loadDaily({
      underlying,
      tenorDays: [7, 30],
      since: new Date(now - this.lookbackDays * DAY_MS),
    });
    return {
      '7d': rows.filter((row) => row.tenorDays === 7).map(toPoint),
      '30d': rows.filter((row) => row.tenorDays === 30).map(toPoint),
    };
  }
}
