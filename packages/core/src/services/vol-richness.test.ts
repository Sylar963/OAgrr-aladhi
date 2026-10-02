import { describe, expect, it } from 'vitest';

import type { IvHistoryPoint } from '../core/enrichment.js';
import type { SpotCandle } from './spot-candles.js';
import {
  buildVolForecastModel,
  buildVolRichness,
  forecastFromCloses,
  richnessState,
  termStructure,
  type VolRichnessInput,
} from './vol-richness.js';

const DAY_MS = 86_400_000;
const FIVE_MIN_MS = 300_000;
const START = Date.UTC(2026, 0, 1, 8);
const DAILY_MOVE = 0.02;
const CONSTANT_RV = DAILY_MOVE * Math.sqrt(365);

function candles(count: number): SpotCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 * Math.exp(index % 2 === 0 ? 0 : DAILY_MOVE);
    return { timestamp: START + index * DAY_MS, open: close, high: close, low: close, close };
  });
}

function point(ts: number, atmIv: number | null): IvHistoryPoint {
  return { ts, atmIv, rr25d: null, bfly25d: null, rr10d: null, bfly10d: null };
}

function dailyIv(series: readonly SpotCandle[], iv: (index: number) => number): IvHistoryPoint[] {
  return series.map((candle, index) => point(candle.timestamp + DAY_MS, iv(index)));
}

function recentIv(nowMs: number, values: readonly number[]): IvHistoryPoint[] {
  return values.map((value, index) =>
    point(nowMs - (values.length - 1 - index) * FIVE_MIN_MS, value),
  );
}

function baseInput(overrides: Partial<VolRichnessInput> = {}): VolRichnessInput {
  const daily = candles(200);
  const nowMs = daily.at(-1)!.timestamp + DAY_MS + 3_600_000;
  const history = dailyIv(daily, () => 0.5);
  const recent = recentIv(nowMs, new Array<number>(400).fill(0.5));
  return {
    underlying: 'BTC',
    nowMs,
    dailyCandles: daily,
    recentIv: { '7d': recent, '30d': recent },
    baselineIv: { '7d': history, '30d': history },
    percentile90d: { '7d': 40, '30d': 45 },
    dvolPercentile1y: 3,
    ...overrides,
  };
}

describe('forecastFromCloses', () => {
  it('returns the realized level when recent and long-run vol agree', () => {
    const closes = candles(60).map((candle) => candle.close);
    expect(forecastFromCloses(closes, 7)).toBeCloseTo(CONSTANT_RV, 10);
    expect(forecastFromCloses(closes, 30)).toBeCloseTo(CONSTANT_RV, 10);
  });

  it('needs 31 closes for a long-run level', () => {
    expect(forecastFromCloses(candles(30).map((candle) => candle.close), 7)).toBeNull();
  });

  it('matches the shared forecast model', () => {
    const daily = candles(120);
    const model = buildVolForecastModel(daily, { '7d': [], '30d': [] });
    const closes = daily.map((candle) => candle.close);
    expect(model.forecastVol(12)).toBe(forecastFromCloses(closes, 12));
  });
});

describe('buildVolRichness', () => {
  it('nets the usual premium out of IV minus forecast', () => {
    const input = baseInput();
    const recent = recentIv(input.nowMs, [...new Array<number>(399).fill(0.5), 0.55]);
    const result = buildVolRichness({ ...input, recentIv: { '7d': recent, '30d': recent } });
    const tenor = result.tenors['7d'];

    expect(tenor.forecastVol).toBeCloseTo(CONSTANT_RV, 10);
    expect(tenor.premiumBaseline.medianSpread).toBeCloseTo(0.5 - CONSTANT_RV, 10);
    expect(tenor.ivMinusForecast).toBeCloseTo(0.55 - CONSTANT_RV, 10);
    expect(tenor.excessPremium).toBeCloseTo(0.05, 10);
    expect(tenor.state).toBe('rich');
  });

  it('reports the excess as unknown, not zero, without a premium baseline', () => {
    const input = baseInput({ baselineIv: { '7d': [], '30d': [] } });
    const tenor = buildVolRichness(input).tenors['30d'];

    expect(tenor.ivMinusForecast).toBeCloseTo(0.5 - CONSTANT_RV, 10);
    expect(tenor.premiumBaseline.medianSpread).toBeNull();
    expect(tenor.excessPremium).toBeNull();
    expect(tenor.excessChange24h).toBeNull();
    expect(tenor.state).toBe('unavailable');
  });

  it('ranks IV minus forecast against its own daily history', () => {
    const daily = candles(200);
    const history = dailyIv(daily, (index) => 0.45 + (index % 10) * 0.01);
    const input = baseInput({ baselineIv: { '7d': history, '30d': history } });
    const recent = recentIv(input.nowMs, [...new Array<number>(399).fill(0.5), 0.6]);
    const tenor = buildVolRichness({ ...input, recentIv: { '7d': recent, '30d': recent } }).tenors[
      '7d'
    ];

    expect(tenor.excessHistory.sampleCount).toBe(170);
    expect(tenor.excessHistory.percentile).toBe(100);
    expect(tenor.excessHistory.zScore).toBeGreaterThan(2);
  });

  it('measures the intraday move against the last 24h and 7d of samples', () => {
    const input = baseInput();
    const values = Array.from({ length: 7 * 288 }, (_, index): number => (index % 2 === 0 ? 0.49 : 0.51));
    values.push(0.53);
    const recent = recentIv(input.nowMs, values);
    const tenor = buildVolRichness({ ...input, recentIv: { '7d': recent, '30d': recent } }).tenors[
      '30d'
    ];

    expect(tenor.intraday.samples24h).toBe(289);
    expect(tenor.intraday.ivChange24h).toBeCloseTo(0.53 - 0.49, 10);
    expect(tenor.intraday.zScore24h).toBeGreaterThan(1.5);
    expect(tenor.intraday.zScore7d).toBeGreaterThan(1.5);
  });

  it('tracks the excess change over 24h from the IV move and the earlier forecast', () => {
    const input = baseInput();
    const values = new Array<number>(400).fill(0.5);
    values[values.length - 1] = 0.52;
    const recent = recentIv(input.nowMs, values);
    const tenor = buildVolRichness({ ...input, recentIv: { '7d': recent, '30d': recent } }).tenors[
      '7d'
    ];

    expect(tenor.excessChange24h).toBeCloseTo(0.02, 10);
  });

  it('keeps the 52-week DVOL level on the 30D tenor only', () => {
    const result = buildVolRichness(baseInput());
    expect(result.tenors['30d'].level).toEqual({ percentile90d: 45, percentile1y: 3 });
    expect(result.tenors['7d'].level).toEqual({ percentile90d: 40, percentile1y: null });
  });

  it('publishes a forecast curve with the baseline tenor switching after 14 days', () => {
    const daily = candles(200);
    const input = baseInput({
      baselineIv: { '7d': dailyIv(daily, () => 0.5), '30d': dailyIv(daily, () => 0.6) },
    });
    const curve = buildVolRichness(input).forecastCurve;
    expect(curve[13]!.usualPremium).toBeCloseTo(0.5 - CONSTANT_RV, 10);
    expect(curve[14]!.usualPremium).toBeCloseTo(0.6 - CONSTANT_RV, 10);
  });
});

describe('richnessState and termStructure', () => {
  it('uses a ±2 vol-point fair band', () => {
    expect(richnessState(-0.021)).toBe('cheap');
    expect(richnessState(0.01)).toBe('fair');
    expect(richnessState(0.02)).toBe('rich');
    expect(richnessState(null)).toBe('unavailable');
  });

  it('classifies the 7D/30D slope', () => {
    expect(termStructure(0.27, 0.35)).toEqual({ state: 'contango', slope: 0.35 - 0.27 });
    expect(termStructure(0.5, 0.4).state).toBe('backwardation');
    expect(termStructure(null, 0.4)).toEqual({ state: 'unknown', slope: null });
  });
});
