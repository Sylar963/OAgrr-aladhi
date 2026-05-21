import { describe, expect, it } from 'vitest';
import {
  alignBarsForAttribution,
  intervalToResolutionSec,
  rangeToBuckets,
} from './use-instrument-attribution.js';

describe('intervalToResolutionSec', () => {
  it('maps every supported option interval to a forward resolution', () => {
    expect(intervalToResolutionSec('1m')).toBe(60);
    expect(intervalToResolutionSec('5m')).toBe(300);
    expect(intervalToResolutionSec('15m')).toBe(900);
    expect(intervalToResolutionSec('1h')).toBe(3600);
    expect(intervalToResolutionSec('4h')).toBe(14400);
    expect(intervalToResolutionSec('1d')).toBe(86400);
  });
});

describe('rangeToBuckets', () => {
  it('1d at 1m → 1440 buckets', () => {
    expect(rangeToBuckets('1d', '1m')).toBe(1440);
  });
  it('7d at 1h → 168 buckets', () => {
    expect(rangeToBuckets('7d', '1h')).toBe(168);
  });
  it('30d at 1d → 30 buckets', () => {
    expect(rangeToBuckets('30d', '1d')).toBe(30);
  });
  it('max is capped at 3000 (server limit)', () => {
    expect(rangeToBuckets('max', '1m')).toBe(3000);
  });
});

describe('alignBarsForAttribution', () => {
  it('joins option mark + forward by nearest bucket on the option timestamp', () => {
    const optionMarks = [
      { ts: 1_700_000_000_000, c: 2000 },
      { ts: 1_700_000_060_000, c: 2010 },
      { ts: 1_700_000_120_000, c: 2025 },
    ];
    const fwdCandles = [
      { timestamp: 1_700_000_000_000, open: 70_000, high: 70_010, low: 69_990, close: 70_005 },
      { timestamp: 1_700_000_060_000, open: 70_005, high: 70_050, low: 70_005, close: 70_040 },
      { timestamp: 1_700_000_120_000, open: 70_040, high: 70_080, low: 70_030, close: 70_070 },
    ];
    const bars = alignBarsForAttribution(optionMarks, fwdCandles);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toEqual({ ts: 1_700_000_000_000, mark: 2000, forward: 70_005 });
    expect(bars[2]).toEqual({ ts: 1_700_000_120_000, mark: 2025, forward: 70_070 });
  });

  it('drops option bars that have no forward within the bucket', () => {
    const optionMarks = [
      { ts: 1_700_000_000_000, c: 2000 },
      { ts: 1_700_000_999_999, c: 2050 },
    ];
    const fwdCandles = [
      { timestamp: 1_700_000_000_000, open: 70_000, high: 70_010, low: 69_990, close: 70_005 },
    ];
    const bars = alignBarsForAttribution(optionMarks, fwdCandles);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.ts).toBe(1_700_000_000_000);
  });
});
