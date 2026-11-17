import { describe, expect, it } from 'vitest';
import {
  gammaAtPrice,
  gammaContours,
  gammaHeatColor,
  gammaHeatmap,
  visibleGammaProfile,
} from './gamma-heatmap';

describe('gamma heatmap price profile', () => {
  const profile = [
    { movePct: 0.2, gexUsdMillions: 5 },
    { movePct: -0.2, gexUsdMillions: -10 },
    { movePct: 0, gexUsdMillions: 0 },
  ];
  const heatmap = gammaHeatmap(profile, 100);

  it('uses simulated spot prices and one magnitude scale for both signs', () => {
    expect(heatmap.points).toEqual([
      { price: 80, gexUsdMillions: -10 },
      { price: 100, gexUsdMillions: 0 },
      { price: 120, gexUsdMillions: 5 },
    ]);
    expect(heatmap.maxMagnitude).toBe(10);
    expect(gammaHeatColor(-10, 10, 0.6)).toBe('rgba(239, 70, 101, 0.6)');
    expect(gammaHeatColor(5, 10, 0.6)).toBe('rgba(0, 233, 151, 0.3)');
    expect(gammaHeatColor(0, 10, 0.6)).toBe('rgba(0, 233, 151, 0)');
  });

  it('interpolates amounts and contours without extrapolating beyond the model grid', () => {
    expect(gammaAtPrice(heatmap.points, 90)).toBe(-5);
    expect(gammaAtPrice(heatmap.points, 110)).toBe(2.5);
    expect(gammaAtPrice(heatmap.points, 80)).toBe(-10);
    expect(gammaAtPrice(heatmap.points, 120)).toBe(5);
    expect(gammaAtPrice(heatmap.points, 79)).toBeNull();
    expect(gammaAtPrice(heatmap.points, 121)).toBeNull();
    expect(gammaContours(heatmap.points, 0)).toEqual([100]);
    expect(gammaContours(heatmap.points, -5)).toEqual([90]);
    expect(gammaContours(heatmap.points, 2.5)).toEqual([110]);
  });

  it('preserves multiple sign changes and an all-zero profile', () => {
    const points = [
      { price: 80, gexUsdMillions: -10 },
      { price: 100, gexUsdMillions: 10 },
      { price: 120, gexUsdMillions: -10 },
    ];
    expect(gammaContours(points, 0)).toEqual([90, 110]);
    const zero = gammaHeatmap(
      profile.map((point) => ({ ...point, gexUsdMillions: 0 })),
      100,
    );
    expect(zero.maxMagnitude).toBe(0);
    expect(gammaAtPrice(zero.points, 110)).toBe(0);
    expect(gammaContours(zero.points, 0)).toEqual([]);
  });

  it('withholds invalid and missing profiles instead of inventing gamma', () => {
    for (const spot of [null, 0, -1, NaN, Infinity])
      expect(gammaHeatmap(profile, spot).points).toEqual([]);
    for (const invalid of [
      undefined,
      [],
      profile.slice(0, 1),
      [profile[0]!, profile[0]!],
      [...profile, { movePct: 0.1, gexUsdMillions: NaN }],
      [...profile, { movePct: Infinity, gexUsdMillions: 1 }],
      [...profile, { movePct: -1, gexUsdMillions: 1 }],
    ]) {
      expect(gammaHeatmap(invalid, 100).points).toEqual([]);
    }
    expect(gammaAtPrice([], 100)).toBeNull();
    expect(gammaAtPrice(heatmap.points, NaN)).toBeNull();
  });
});

describe('visible gamma profile', () => {
  it('clips to the visible prices and interpolates at both viewport edges', () => {
    const points = [
      { price: 60, gexUsdMillions: -100 },
      { price: 100, gexUsdMillions: -20 },
      { price: 140, gexUsdMillions: 20 },
    ];
    expect(visibleGammaProfile(points, (price) => 120 - price, 40)).toEqual([
      { y: 40, gexUsdMillions: -60 },
      { y: 20, gexUsdMillions: -20 },
      { y: 0, gexUsdMillions: 0 },
    ]);
  });

  it('preserves each peak and inserts zero crossings before plotting absolute magnitude', () => {
    const points = [
      { price: 80, gexUsdMillions: -10 },
      { price: 100, gexUsdMillions: 10 },
      { price: 120, gexUsdMillions: -10 },
    ];
    expect(visibleGammaProfile(points, (price) => 120 - price, 40)).toEqual([
      { y: 40, gexUsdMillions: -10 },
      { y: 30, gexUsdMillions: 0 },
      { y: 20, gexUsdMillions: 10 },
      { y: 10, gexUsdMillions: 0 },
      { y: 0, gexUsdMillions: -10 },
    ]);
  });

  it('never extends beyond the profile and omits prices that cannot be projected', () => {
    const points = [
      { price: 100, gexUsdMillions: 1 },
      { price: 110, gexUsdMillions: 2 },
    ];
    expect(visibleGammaProfile(points, (price) => 120 - price, 80)).toEqual([
      { y: 20, gexUsdMillions: 1 },
      { y: 10, gexUsdMillions: 2 },
    ]);
    expect(visibleGammaProfile(points, () => null, 80)).toEqual([]);
    expect(visibleGammaProfile(points, () => NaN, 80)).toEqual([]);
    expect(visibleGammaProfile(points, (price) => 200 - price, 40)).toEqual([]);
    expect(visibleGammaProfile([], (price) => price, 80)).toEqual([]);
  });
});
