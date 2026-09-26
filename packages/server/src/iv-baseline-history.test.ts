import type { IvHistoryDailyQuery, PersistedIvHistoryPoint } from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';

import { IvBaselineHistory, mergeIvSeries } from './iv-baseline-history.js';

const DAY_MS = 86_400_000;

function row(tenorDays: 7 | 30, day: number, atmIv: number): PersistedIvHistoryPoint {
  return {
    underlying: 'BTC',
    tenorDays,
    ts: new Date(day * DAY_MS),
    atmIv,
    rr25d: null,
    bfly25d: null,
    rr10d: null,
    bfly10d: null,
    source: 'live_surface',
  };
}

function point(day: number, atmIv: number) {
  return { ts: day * DAY_MS, atmIv, rr25d: null, bfly25d: null, rr10d: null, bfly10d: null };
}

describe('mergeIvSeries', () => {
  it('uses daily history only before the recent series starts', () => {
    const merged = mergeIvSeries([point(1, 0.5), point(2, 0.51), point(3, 0.52)], [point(2.5, 0.6)]);
    expect(merged.map((p) => p.atmIv)).toEqual([0.5, 0.51, 0.6]);
  });

  it('falls back to daily history when there is no recent series', () => {
    expect(mergeIvSeries([point(1, 0.5)], [])).toEqual([point(1, 0.5)]);
  });
});

describe('IvBaselineHistory', () => {
  it('splits tenors and caches per underlying until the TTL expires', async () => {
    let now = 500 * DAY_MS;
    const loadDaily = vi.fn(async (_query: IvHistoryDailyQuery) => [
      row(7, 1, 0.4),
      row(30, 1, 0.5),
      row(30, 2, 0.55),
    ]);
    const history = new IvBaselineHistory(
      { enabled: true, loadDaily },
      { lookbackDays: 400, ttlMs: 1_000, now: () => now },
    );

    const series = await history.get('btc');
    expect(series['7d'].map((p) => p.atmIv)).toEqual([0.4]);
    expect(series['30d'].map((p) => p.atmIv)).toEqual([0.5, 0.55]);
    expect(loadDaily).toHaveBeenCalledWith({
      underlying: 'BTC',
      tenorDays: [7, 30],
      since: new Date(100 * DAY_MS),
    });

    await history.get('BTC');
    expect(loadDaily).toHaveBeenCalledTimes(1);
    now += 1_000;
    await history.get('BTC');
    expect(loadDaily).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    const loadDaily = vi
      .fn<(query: IvHistoryDailyQuery) => Promise<PersistedIvHistoryPoint[]>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([row(30, 1, 0.5)]);
    const history = new IvBaselineHistory({ enabled: true, loadDaily });

    await expect(history.get('BTC')).rejects.toThrow('db down');
    await expect(history.get('BTC')).resolves.toMatchObject({ '30d': [{ atmIv: 0.5 }] });
  });

  it('returns empty series without a store', async () => {
    const loadDaily = vi.fn();
    const history = new IvBaselineHistory({ enabled: false, loadDaily });
    await expect(history.get('BTC')).resolves.toEqual({ '7d': [], '30d': [] });
    expect(loadDaily).not.toHaveBeenCalled();
  });
});
