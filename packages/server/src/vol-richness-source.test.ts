import type { IvHistoryPoint, IvHistoryResponse, SpotCandle } from '@oggregator/core';
import { describe, expect, it, vi } from 'vitest';

import { createVolRichnessSource, type VolRichnessSourceDeps } from './vol-richness-source.js';

const DAY_MS = 86_400_000;
const NOW_MS = Date.UTC(2026, 9, 2, 12);
const log = { warn: vi.fn() };

function point(ts: number, atmIv: number): IvHistoryPoint {
  return { ts, atmIv, rr25d: null, bfly25d: null, rr10d: null, bfly10d: null };
}

function candles(): SpotCandle[] {
  return Array.from({ length: 200 }, (_, index) => {
    const close = 100 * Math.exp(index % 2 === 0 ? 0 : 0.02);
    return {
      timestamp: NOW_MS - (200 - index) * DAY_MS,
      open: close,
      high: close,
      low: close,
      close,
    };
  });
}

function ivHistory(): IvHistoryResponse {
  const tenor = {
    current: point(NOW_MS, 0.42),
    atmRank: 30,
    atmPercentile: 35,
    rrRank: null,
    rrPercentile: null,
    flyRank: null,
    flyPercentile: null,
    min: { atmIv: null, rr25d: null, bfly25d: null },
    max: { atmIv: null, rr25d: null, bfly25d: null },
    series: [point(NOW_MS - DAY_MS, 0.4), point(NOW_MS, 0.42)],
  };
  return {
    underlying: 'BTC',
    windowDays: 90,
    tenors: { '7d': tenor, '30d': tenor, '60d': tenor, '90d': tenor },
  };
}

function deps(overrides: Partial<VolRichnessSourceDeps> = {}): VolRichnessSourceDeps {
  const stored = candles().map((candle) => point(candle.timestamp + DAY_MS, 0.5));
  return {
    now: () => NOW_MS,
    getDailyCandles: async () => candles(),
    getIvHistory: () => ivHistory(),
    getStoredIv: async () => ({ '7d': stored, '30d': stored }),
    getDvolPercentile1y: () => 4,
    ...overrides,
  };
}

describe('createVolRichnessSource', () => {
  it('builds the reading from live IV, stored history, and the DVOL level', async () => {
    const result = await createVolRichnessSource(deps()).get('btc', log);

    expect(result?.underlying).toBe('BTC');
    expect(result?.tenors['30d'].atmIv).toBe(0.42);
    expect(result?.tenors['30d'].level).toEqual({ percentile90d: 35, percentile1y: 4 });
    expect(result?.tenors['30d'].premiumBaseline.medianSpread).not.toBeNull();
    expect(result?.tenors['30d'].excessPremium).not.toBeNull();
  });

  it('returns null without IV history or spot candles', async () => {
    expect(await createVolRichnessSource(deps({ getIvHistory: () => null })).get('BTC', log)).toBeNull();
    expect(
      await createVolRichnessSource(deps({ getDailyCandles: async () => [] })).get('BTC', log),
    ).toBeNull();
  });

  it('keeps going with an unknown baseline when the store fails', async () => {
    const result = await createVolRichnessSource(
      deps({ getStoredIv: async () => Promise.reject(new Error('db down')) }),
    ).get('BTC', log);

    expect(result?.tenors['30d'].excessPremium).toBeNull();
    expect(result?.tenors['30d'].state).toBe('unavailable');
    expect(log.warn).toHaveBeenCalled();
  });
});
