import { describe, expect, it } from 'vitest';
import { gammaAtPrice, gammaContours, gammaHeatColor, gammaHeatmap } from './gamma-heatmap';

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
