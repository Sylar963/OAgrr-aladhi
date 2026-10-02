import {
  richnessState,
  type IvHistoryResponse,
  type SpotCandle,
  type TenorRichness,
  type VolRichness,
} from '@oggregator/core';
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

function richness(excess30d: number | null): VolRichness {
  const tenor = (tenorDays: 7 | 30, excessPremium: number | null): TenorRichness => ({
    tenorDays,
    atmIv: 0.4,
    forecastVol: 0.35,
    ivMinusForecast: 0.05,
    premiumBaseline: {
      tenorDays,
      source: 'blended',
      medianSpread: excessPremium == null ? null : 0.05 - excessPremium,
      sampleCount: 120,
      independentSampleCount: 10,
    },
    excessPremium,
    excessChange24h: null,
    excessHistory: { zScore: null, percentile: null, sampleCount: 0, firstTs: null },
    conePercentile: null,
    intraday: { ivChange24h: null, zScore24h: null, zScore7d: null, samples24h: 0, samples7d: 0 },
    level: { percentile90d: 25, percentile1y: null },
    state: richnessState(excessPremium),
  });
  return {
    generatedAt: NOW_MS,
    underlying: 'BTC',
    forecast: {
      method: 'mean-reverting-realized-v1',
      rv7d: 0.35,
      rv30d: 0.35,
      longRunVol: 0.35,
      longRunDays: 180,
      halfLifeDays: 14,
    },
    tenors: { '7d': tenor(7, null), '30d': tenor(30, excess30d) },
    termStructure: { state: 'flat', slope: 0 },
    forecastCurve: [],
    fairBand: 0.02,
  };
}

describe('buildAlphaMarketContext', () => {
  it('derives the volatility state from the 30D excess premium when it is known', () => {
    const base = {
      underlying: 'BTC',
      nowMs: NOW_MS,
      spotPrice: 100,
      ivHistory: ivHistory(0.35, 0.4),
      candles: quietCandles(),
      regime: null,
    };

    const rich = buildAlphaMarketContext({ ...base, richness: richness(0.04) });
    expect(rich.volatility).toMatchObject({ state: 'bid', stateSource: 'excess-premium' });
    expect(rich.setup.longCall).toBe('expensive');

    const fair = buildAlphaMarketContext({ ...base, richness: richness(0) });
    expect(fair.volatility).toMatchObject({ state: 'normal', stateSource: 'excess-premium' });

    const unknown = buildAlphaMarketContext({ ...base, richness: richness(null) });
    expect(unknown.volatility).toMatchObject({ state: 'compressed', stateSource: 'iv-percentile' });
    expect(unknown.richness?.tenors['30d'].state).toBe('unavailable');
  });

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
    expect(result.setup.protectivePut).toBe('favorable');
    expect(result.sources.ivScope).toBe('mixed');
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
    expect(result.setup.protectivePut).toBe('unavailable');
    expect(result.setup.creditSpread).toBe('unavailable');
  });

  it('does not call a downside breakout favorable for a long call', () => {
    const result = buildAlphaMarketContext({
      underlying: 'BTC',
      nowMs: NOW_MS,
      spotPrice: 98,
      ivHistory: ivHistory(0.35, 0.4),
      candles: quietCandles(),
      regime: null,
    });

    expect(result.volatility.state).toBe('compressed');
    expect(result.spotState.state).toBe('breaking-out');
    expect(result.spotState.direction).toBe('down');
    expect(result.setup.longCall).toBe('watch');
  });

  it('marks puts expensive once spot has already broken down', () => {
    const result = buildAlphaMarketContext({
      underlying: 'BTC',
      nowMs: NOW_MS,
      spotPrice: 98,
      ivHistory: ivHistory(0.35, 0.4),
      candles: quietCandles(),
      regime: null,
    });

    expect(result.setup.protectivePut).toBe('expensive');
  });
});
