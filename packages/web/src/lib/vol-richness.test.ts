import type { TenorRichness, VolRichness } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { expiryRichness, fmtVolPts, fmtZ } from './vol-richness';

function tenor(tenorDays: 7 | 30, medianSpread: number | null): TenorRichness {
  return {
    tenorDays,
    atmIv: 0.3,
    forecastVol: 0.35,
    ivMinusForecast: -0.05,
    premiumBaseline: {
      tenorDays,
      source: 'blended',
      medianSpread,
      sampleCount: 100,
      independentSampleCount: 8,
    },
    excessPremium: null,
    excessChange24h: null,
    excessHistory: { zScore: null, percentile: null, sampleCount: 0, firstTs: null },
    conePercentile: null,
    intraday: { ivChange24h: null, zScore24h: null, zScore7d: null, samples24h: 0, samples7d: 0 },
    level: { percentile90d: null, percentile1y: null },
    state: 'unavailable',
  };
}

const RICHNESS: VolRichness = {
  generatedAt: 0,
  underlying: 'BTC',
  forecast: {
    method: 'mean-reverting-realized-v1',
    rv7d: 0.4,
    rv30d: 0.35,
    longRunVol: 0.3,
    longRunDays: 180,
    halfLifeDays: 14,
  },
  tenors: { '7d': tenor(7, 0.09), '30d': tenor(30, 0.11) },
  termStructure: { state: 'contango', slope: 0.07 },
  forecastCurve: [
    { dteDays: 1, forecastVol: 0.4, usualPremium: 0.09 },
    { dteDays: 2, forecastVol: 0.38, usualPremium: 0.09 },
  ],
  volCone: [],
  fairBand: 0.02,
};

describe('expiryRichness', () => {
  it('interpolates the forecast curve and nets the matching usual premium', () => {
    const result = expiryRichness(RICHNESS, 0.5, 1.5);
    expect(result.forecastVol).toBeCloseTo(0.39, 10);
    expect(result.usualPremium).toBe(0.09);
    expect(result.excessPremium).toBeCloseTo(0.5 - 0.39 - 0.09, 10);
    expect(result.state).toBe('fair');
  });

  it('uses the 30D baseline past 14 days and clamps beyond the curve', () => {
    const result = expiryRichness(RICHNESS, 0.3, 40);
    expect(result.forecastVol).toBe(0.38);
    expect(result.usualPremium).toBe(0.11);
    expect(result.state).toBe('cheap');
  });

  it('is unavailable without IV or a baseline', () => {
    expect(expiryRichness(RICHNESS, null, 3).state).toBe('unavailable');
    const noBaseline = { ...RICHNESS, tenors: { ...RICHNESS.tenors, '7d': tenor(7, null) } };
    expect(expiryRichness(noBaseline, 0.5, 3).excessPremium).toBeNull();
  });
});

describe('formatters', () => {
  it('formats signed vol points and z-scores', () => {
    expect(fmtVolPts(-0.1023)).toBe('−10.2 pts');
    expect(fmtVolPts(0.005)).toBe('+0.5 pts');
    expect(fmtVolPts(null)).toBe('–');
    expect(fmtZ(1.26)).toBe('+1.3σ');
  });
});
