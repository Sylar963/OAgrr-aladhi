import { AlphaStrategyContextSchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';
import type { IvHistoryResponse } from '../core/enrichment.js';
import type { SpotCandle } from './spot-candles.js';
import {
  buildAlphaStrategyContext,
  type AlphaStrategyContextInput,
} from './alpha-strategy-context.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 10, 12);

function candles(count = 730, sign = -1, step = DAY): SpotCandle[] {
  let close = 100;
  return Array.from({ length: count }, (_, i) => {
    const move =
      i >= count - (step === HOUR ? 168 : 30)
        ? sign * (0.008 + (i % 3) * 0.001)
        : (i % 2 ? -1 : 1) * 0.012;
    close *= Math.exp(move);
    return { timestamp: NOW - (count - i) * step, open: close, high: close, low: close, close };
  });
}

function history(iv7 = 0.4, iv30 = 0.4): IvHistoryResponse {
  const tenor = (atmIv: number) => ({
    current: { ts: NOW, atmIv, rr25d: -0.04, bfly25d: 0.01, rr10d: null, bfly10d: null },
    atmRank: 1,
    atmPercentile: 1,
    rrRank: null,
    rrPercentile: null,
    flyRank: null,
    flyPercentile: null,
    min: { atmIv: null, rr25d: null, bfly25d: null },
    max: { atmIv: null, rr25d: null, bfly25d: null },
    series: [],
  });
  return {
    underlying: 'BTC',
    windowDays: 90,
    tenors: { '7d': tenor(iv7), '30d': tenor(iv30), '60d': tenor(iv30), '90d': tenor(iv30) },
  };
}

function input(overrides: Partial<AlphaStrategyContextInput> = {}): AlphaStrategyContextInput {
  return {
    nowMs: NOW,
    candles: candles(),
    ivHistory: history(),
    horizonDays: 30,
    ...overrides,
  };
}

describe('automatic strategy market context', () => {
  it('separates bullish and bearish structures automatically, without a user thesis', () => {
    const result = buildAlphaStrategyContext(input());
    expect(AlphaStrategyContextSchema.safeParse(result).success).toBe(true);
    expect(result.direction).toBe('down');
    expect(result.assessments['long-call'].verdict).toBe('poor-fit');
    expect(result.assessments['put-credit'].reasons).toContain('downside-short-risk');
    expect(result.assessments['put-credit'].verdict).toBe('poor-fit');
    expect(result.assessments['call-credit'].verdict).toBe('supported');
    expect(result.assessments['put-debit'].verdict).toBe('supported');
    expect(result.assessments['call-debit'].verdict).toBe('poor-fit');
    expect(result.assessments['protective-put'].verdict).toBe('conditional');
    const up = buildAlphaStrategyContext(input({ candles: candles(730, 1) }));
    expect(up.direction).toBe('up');
    expect(up.assessments['call-debit'].verdict).toBe('supported');
    expect(up.assessments['call-credit'].verdict).toBe('poor-fit');
  });

  it('does not let cheap ATM IV override direction, or expensive IV ban an aligned debit vertical', () => {
    const cheap = buildAlphaStrategyContext(input({ ivHistory: history(0.01, 0.01) }));
    expect(cheap.assessments['long-call'].verdict).toBe('poor-fit');
    expect(cheap.assessments['call-credit'].verdict).toBe('conditional');
    expect(cheap.assessments['call-credit'].reasons).toContain('credit-premium-thin');
    const rich = buildAlphaStrategyContext(input({ ivHistory: history(2, 2) }));
    expect(rich.assessments['put-debit'].verdict).toBe('supported');
    expect(rich.assessments['long-put'].verdict).toBe('conditional');
    expect(rich.assessments['protective-put'].reasons).toContain('insurance-expensive');
    expect(rich.assessments['protective-put'].verdict).not.toBe('poor-fit');
  });

  it('requires wing pricing for outright support and separates expensive put skew from cheap ATM', () => {
    const plain = buildAlphaStrategyContext(input({ ivHistory: history(0.05, 0.05) }));
    expect(plain.assessments['long-put'].verdict).toBe('supported');
    const skew = history(0.05, 0.05);
    skew.tenors['30d'].current.rr25d = -2;
    const costlyWing = buildAlphaStrategyContext(input({ ivHistory: skew }));
    expect(costlyWing.pricing.put25Iv).toBeCloseTo(1.06);
    expect(costlyWing.assessments['long-put'].verdict).toBe('conditional');
    skew.tenors['30d'].current.rr25d = null;
    const unknownWing = buildAlphaStrategyContext(input({ ivHistory: skew }));
    expect(unknownWing.assessments['long-put'].reasons).toContain('wing-pricing-unavailable');
    expect(unknownWing.assessments['long-put'].verdict).toBe('conditional');
  });

  it('matches selected-expiry IV and refuses a stale or missing selected chain instead of substituting 7D IV', () => {
    const base = input({
      expiryTs: NOW + 3 * DAY,
      selectedIv: 0.3,
      ivAsOfMs: NOW,
      selectedSkew: -0.1,
      selectedBfly: 0.02,
    });
    const selected = buildAlphaStrategyContext(base);
    expect(selected.horizonDays).toBe(3);
    expect(selected.horizonSource).toBe('selected-expiry');
    expect(selected.pricing.source).toBe('selected-chain');
    expect(selected.pricing.put25Iv).toBeCloseTo(0.37);
    for (const ivAsOfMs of [undefined, NOW - 120_001, NOW + 1]) {
      const missing = buildAlphaStrategyContext({ ...base, ivAsOfMs });
      expect(missing.pricing.atmIv).toBeNull();
      expect(missing.assessments['call-credit'].verdict).toBe('conditional');
    }
  });

  it('uses hourly pressure for a short horizon and detects opposing short and longer moves', () => {
    const hourly = candles(240, -1, HOUR);
    for (let i = hourly.length - 6; i < hourly.length; i += 1) {
      hourly[i]!.close = hourly[i - 1]!.close * Math.exp(0.03);
    }
    const mixed = buildAlphaStrategyContext(input({ horizonDays: 7, hourlyCandles: hourly }));
    expect(mixed.directionBasis).toBe('hourly');
    expect(mixed.direction).toBe('transition');
    expect(mixed.assessments['call-credit'].verdict).toBe('conditional');
    expect(mixed.assessments['call-credit'].reasons).toContain('reversal-risk');
    const fallback = buildAlphaStrategyContext(
      input({ horizonDays: 7, hourlyCandles: hourly.slice(0, -10) }),
    );
    expect(fallback.directionBasis).toBe('daily');
  });

  it('downgrades aligned short-premium structures during a volatility shock', () => {
    const shock = candles();
    for (let i = shock.length - 7; i < shock.length; i += 1)
      shock[i]!.close = shock[i - 1]!.close * Math.exp(-0.08);
    const result = buildAlphaStrategyContext(input({ candles: shock, ivHistory: history(1, 0.8) }));
    expect(result.stress.accelerating).toBe(true);
    expect(result.stress.backwardation).toBe(true);
    expect(result.assessments['call-credit'].verdict).toBe('conditional');
    expect(result.assessments['call-credit'].reasons).toContain('vol-accelerating');
    expect(result.assessments['put-credit'].verdict).toBe('poor-fit');
  });

  it('withholds history-derived verdicts for missing, stale, broken or flat histories', () => {
    const daily = candles();
    for (const data of [
      [],
      daily.slice(0, -5),
      daily.filter((_, i) => i !== 710),
      daily.map((c) => ({ ...c, close: 100 })),
    ]) {
      const result = buildAlphaStrategyContext(input({ candles: data }));
      expect(result.assessments['long-call'].verdict).toBe('unavailable');
    }
  });

  it('never uses IV percentile to manufacture cheap volatility and requires sufficient delivery outcomes', () => {
    const missing = history();
    missing.tenors['30d'].current.ts = NOW - 300_001;
    const result = buildAlphaStrategyContext(input({ ivHistory: missing }));
    expect(result.pricing.atmIv).toBeNull();
    expect(result.assessments['long-put'].reasons).toContain('pricing-unknown');
    const shortHistory = buildAlphaStrategyContext(input({ candles: candles(90) }));
    expect(shortHistory.pricing.calibrationWindows).toBe(0);
    expect(shortHistory.pricing.deliveryLow).toBeNull();
    expect(shortHistory.assessments['call-credit'].verdict).toBe('conditional');
  });

  it('uses non-overlapping delivery outcomes and ignores forming and future candles', () => {
    const base = input();
    const result = buildAlphaStrategyContext(base);
    expect(result.pricing.calibrationWindows).toBe(18);
    expect(result.pricing.deliveryLow).toBeGreaterThan(0);
    expect(result.pricing.deliveryHigh).toBeGreaterThanOrEqual(result.pricing.deliveryLow!);
    const extra = { timestamp: NOW, open: 1, high: 1, low: 1, close: 1 };
    expect(
      buildAlphaStrategyContext({
        ...base,
        candles: [...base.candles, extra, { ...extra, timestamp: NOW + DAY }],
      }),
    ).toEqual(result);
  });

  it('marks unsupported horizons unavailable and flags intraday expiry without inventing a daily range', () => {
    for (const expiryTs of [NOW - 1, NOW + 91 * DAY]) {
      const result = buildAlphaStrategyContext(input({ expiryTs }));
      expect(result.assessments['long-put']).toEqual({
        verdict: 'unavailable',
        reasons: ['horizon-unsupported'],
      });
    }
    const near = buildAlphaStrategyContext(
      input({ expiryTs: NOW + HOUR, selectedIv: 0.4, ivAsOfMs: NOW }),
    );
    expect(near.assessments['call-credit'].reasons).toContain('near-expiry');
    expect(near.pricing.deliveryLow).toBeNull();
    expect(near.assessments['call-credit'].verdict).toBe('conditional');
  });
});
