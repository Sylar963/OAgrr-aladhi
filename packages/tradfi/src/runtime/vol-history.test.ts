import { describe, expect, it } from 'vitest';
import type { RawCandle } from '../tastytrade/candle-codec.js';
import { buildVolHistory, volCone, volRank } from './vol-history.js';

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const STEP = 0.01;

function bar(i: number, c: number, iv = NaN, symbol = 'AAPL{=d}'): RawCandle {
  return { symbol, flags: 0, time: START + i * DAY, o: c, h: c, l: c, c, v: 1, iv };
}

// Alternating ±1% log moves: every window realizes exactly STEP × √252.
function zigzag(n: number, iv = (i: number) => 0.2 + i / 1000): RawCandle[] {
  return Array.from({ length: n }, (_, i) => bar(i, 100 * Math.exp(i % 2 === 0 ? 0 : STEP), iv(i)));
}

describe('buildVolHistory', () => {
  it('returns null without bars', () => {
    expect(buildVolHistory('AAPL', [])).toBeNull();
  });

  it('pairs each close with candle IV and 21-day realized vol at 252 days a year', () => {
    const body = buildVolHistory('AAPL', zigzag(30).reverse())!;
    expect(body.ivSource).toBe('IVx');
    expect(body.series.map((p) => p.ts)).toEqual(zigzag(30).map((b) => b.time));
    expect(body.series[20]!.rv).toBeNull();
    expect(body.series[21]!.rv).toBeCloseTo(STEP * Math.sqrt(252), 10);
    expect(body.series[29]!.iv).toBeCloseTo(0.229, 10);
  });

  it('uses the vol index close as IV when one is mapped, matching by day', () => {
    const index = [bar(0, 18, NaN, 'VIX{=d}'), bar(2, 21, NaN, 'VIX{=d}')];
    const body = buildVolHistory('SPX', zigzag(3), { symbol: 'VIX', bars: index })!;
    expect(body.ivSource).toBe('VIX');
    expect(body.series.map((p) => p.iv)).toEqual([0.18, null, 0.21]);
  });

  it('falls back to candle IV when the index has no bars', () => {
    const body = buildVolHistory('SPX', zigzag(3), { symbol: 'VIX', bars: [] })!;
    expect(body.ivSource).toBe('IVx');
    expect(body.series[0]!.iv).toBeCloseTo(0.2, 10);
  });
});

describe('volRank', () => {
  const series = [0.3, 0.1, null, 0.2].map((iv, i) => ({ ts: i, close: 1, iv, rv: iv && iv / 2 }));

  it('ranks the latest IV inside the trailing window', () => {
    const rank = volRank(series, 252, 'iv');
    expect(rank).toMatchObject({ lookbackDays: 252, min: 0.1, max: 0.3, sampleCount: 3 });
    expect(rank.rank).toBeCloseTo(50, 10);
    expect(rank.percentile).toBeCloseTo((2 / 3) * 100, 10);
    expect(volRank(series, 252, 'rv')).toMatchObject({ min: 0.05, max: 0.15, sampleCount: 3 });
    expect(volRank(series, 2, 'iv')).toMatchObject({ min: 0.2, max: 0.2, sampleCount: 1 });
    expect(volRank(series, 2, 'iv').rank).toBeNull();
  });

  it('is empty without IV', () => {
    expect(volRank([], 252, 'iv')).toMatchObject({ rank: null, percentile: null, sampleCount: 0 });
  });
});

describe('volCone', () => {
  it('builds calendar horizons from trading-day windows once 20 windows exist', () => {
    const closes = zigzag(83).map((b) => b.c);
    const bands = volCone(closes);
    expect(bands.map((b) => [b.horizonDays, b.windowDays])).toEqual([
      [7, 5], [14, 10], [30, 21], [60, 42], [90, 63],
    ]);
    const rv = STEP * Math.sqrt(252);
    for (const band of bands) {
      expect(band.sampleCount).toBe(83 - band.windowDays);
      expect(band.p50).toBeCloseTo(rv, 10);
      expect(band.current).toBeCloseTo(rv, 10);
    }
    expect(volCone(closes.slice(0, 82)).map((b) => b.horizonDays)).toEqual([7, 14, 30, 60]);
  });
});
