import type { IvHistoryPoint } from '@oggregator/core';
import type {
  IvHistoryStore,
  PersistedIvHistoryPoint,
  VenueIvHistoryStore,
} from '@oggregator/db';

import type { StraddleIvSeries } from './alpha-straddle-scanner.js';

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 400;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

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

/** Long-range history before the recent in-memory series starts, recent points after it. */
export function mergeIvSeries(
  history: readonly IvHistoryPoint[],
  recent: readonly IvHistoryPoint[],
): IvHistoryPoint[] {
  const recentStart = recent[0]?.ts ?? Number.POSITIVE_INFINITY;
  return [...history.filter((point) => point.ts < recentStart), ...recent];
}

/** Per-underlying cache of a slow store read; failed loads are not cached. */
class TtlCache<T> {
  private readonly entries = new Map<string, { loadedAt: number; value: Promise<T> }>();
  readonly lookbackDays: number;
  private readonly ttlMs: number;
  readonly now: () => number;

  constructor(options: IvBaselineHistoryOptions) {
    this.lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(underlying: string, load: (key: string, since: Date) => Promise<T>): Promise<T> {
    const key = underlying.toUpperCase();
    const now = this.now();
    const cached = this.entries.get(key);
    if (cached != null && now - cached.loadedAt < this.ttlMs) return cached.value;

    const value = load(key, new Date(now - this.lookbackDays * DAY_MS));
    this.entries.set(key, { loadedAt: now, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}

/**
 * The premium baseline needs several non-overlapping windows of the tenor length (four
 * 30-day windows is ~4 months), which the 90-day in-memory IV buffer cannot hold. Reads an
 * hourly-sampled series from the store and caches it per underlying.
 */
export class IvBaselineHistory {
  private readonly cache: TtlCache<StraddleIvSeries>;

  constructor(
    private readonly store: Pick<IvHistoryStore, 'enabled' | 'loadHourly'>,
    options: IvBaselineHistoryOptions = {},
  ) {
    this.cache = new TtlCache(options);
  }

  async get(underlying: string): Promise<StraddleIvSeries> {
    if (!this.store.enabled) return { '7d': [], '30d': [] };
    return this.cache.get(underlying, async (key, since) => {
      const rows = await this.store.loadHourly({ underlying: key, tenorDays: [7, 30], since });
      return {
        '7d': rows.filter((row) => row.tenorDays === 7).map(toPoint),
        '30d': rows.filter((row) => row.tenorDays === 30).map(toPoint),
      };
    });
  }
}

/** Same long-range series, measured from each venue's own quotes. */
export class VenueIvBaselineHistory {
  private readonly cache: TtlCache<ReadonlyMap<string, StraddleIvSeries>>;

  constructor(
    private readonly store: Pick<VenueIvHistoryStore, 'enabled' | 'loadSince'>,
    options: IvBaselineHistoryOptions = {},
  ) {
    this.cache = new TtlCache(options);
  }

  async get(underlying: string): Promise<ReadonlyMap<string, StraddleIvSeries>> {
    if (!this.store.enabled) return new Map();
    return this.cache.get(underlying, async (key, since) => {
      const rows = await this.store.loadSince({ underlying: key, tenorDays: [7, 30], since });
      const byVenue = new Map<string, { '7d': IvHistoryPoint[]; '30d': IvHistoryPoint[] }>();
      for (const row of rows) {
        let series = byVenue.get(row.venue);
        if (series == null) {
          series = { '7d': [], '30d': [] };
          byVenue.set(row.venue, series);
        }
        const point: IvHistoryPoint = {
          ts: row.observedAt.getTime(),
          atmIv: row.atmIv,
          rr25d: row.rr25d,
          bfly25d: row.bfly25d,
          rr10d: null,
          bfly10d: null,
        };
        if (row.tenorDays === 7) series['7d'].push(point);
        else if (row.tenorDays === 30) series['30d'].push(point);
      }
      for (const series of byVenue.values()) {
        series['7d'].sort((a, b) => a.ts - b.ts);
        series['30d'].sort((a, b) => a.ts - b.ts);
      }
      return byVenue;
    });
  }
}
