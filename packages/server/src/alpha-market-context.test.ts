import type { IvHistoryResponse, SpotCandle } from '@oggregator/core';
import { describe, expect, it } from 'vitest';

import { buildAlphaMarketContext } from './alpha-market-context.js';

const NOW_MS = Date.UTC(2026, 7, 26);

function ivHistory(atm7d: number, atm30d: number): IvHistoryResponse {
  const tenor = (atmIv: number, percentile: number) => ({
    current: {
      ts: NOW_MS,
      atmIv,
      rr25d: null,
      bfly25d: null,
      rr10d: null,
      bfly10d: null,
    },
    atmRank: percentile,
    atmPercentile: percentile,
    rrRank: null,
    rrPercentile: null,
    flyRank: null,
    flyPercentile: null,
    min: { atmIv: null, rr25d: null, bfly25d: null },
    max: { atmIv: null, rr25d: null, bfly25d: null },
    series: [
      {
        ts: NOW_MS - 7 * 86_400_000,
        atmIv: atmIv - 0.05,
        rr25d: null,
        bfly25d: null,
        rr10d: null,
        bfly10d: null,
      },
      {
        ts: NOW_MS,
        atmIv,
        rr25d: null,
        bfly25d: null,
        rr10d: null,
        bfly10d: null,
      },
    ],
  });
  return {
    underlying: 'BTC',
    windowDays: 90,
    tenors: {
      '7d': tenor(atm7d, 20),
      '30d': tenor(atm30d, 25),
      '60d': tenor(atm30d, 25),
      '90d': tenor(atm30d, 25),
    },
  };
}

function quietCandles(): SpotCandle[] {
  return Array.from({ length: 60 }, (_, index) => {
    const close = index < 45 ? 95 + index : 100 + (index % 2) * 0.2;
    return {
      timestamp: NOW_MS - (59 - index) * 86_400_000,
      open: close,
      high: close + (index < 45 ? 2 : 0.2),
      low: close - (index < 45 ? 2 : 0.2),
      close,
    };
  });
}

describe('buildAlphaMarketContext', () => {
  it('computes expected moves, IV changes, and compressed-range setup labels', () => {
    const result = buildAlphaMarketContext({
      underlying: 'BTC',
      nowMs: NOW_MS,
      spotPrice: 100,
      ivHistory: ivHistory(0.35, 0.4),
      candles: quietCandles(),
      regime: null,
    });

    expect(result.volatility.state).toBe('compressed');
    expect(result.volatility.ivChange7d).toBeCloseTo(0.05, 8);
    expect(result.range.state).toBe('coiled');
    expect(result.expectedMoves[0]!.movePct).toBeCloseTo(4.847, 3);
    expect(result.setup.longCall).toBe('favorable');
    expect(result.sources.ivScope).toBe('cross-venue');
  });

  it('reports unavailable context without inventing historical values', () => {
    const result = buildAlphaMarketContext({
      underlying: 'SOL',
      nowMs: NOW_MS,
      spotPrice: 150,
      ivHistory: null,
      candles: [],
      regime: null,
    });

    expect(result.volatility.state).toBe('unavailable');
    expect(result.range.state).toBe('unavailable');
    expect(result.setup.longCall).toBe('unavailable');
    expect(result.setup.creditSpread).toBe('unavailable');
  });
});
