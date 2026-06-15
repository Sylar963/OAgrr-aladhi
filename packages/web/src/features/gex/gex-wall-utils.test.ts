import { describe, expect, it } from 'vitest';
import type { GexStrike } from '@shared/enriched';
import { computeGammaWalls } from './gex-wall-utils';

// Worked example: spot 61,800. Call wall = 70k (+120), put wall = 57.5k (-85),
// flip interpolated between 67.5k (cum -50) and 70k (cum +70) -> ~68,541.67.
const SAMPLE: GexStrike[] = [
  { strike: 55_000, gexUsdMillions: -40 },
  { strike: 57_500, gexUsdMillions: -85 },
  { strike: 60_000, gexUsdMillions: -30 },
  { strike: 62_500, gexUsdMillions: 20 },
  { strike: 65_000, gexUsdMillions: 55 },
  { strike: 67_500, gexUsdMillions: 30 },
  { strike: 70_000, gexUsdMillions: 120 },
  { strike: 75_000, gexUsdMillions: 15 },
];

describe('computeGammaWalls', () => {
  it('picks max-positive call wall above spot and most-negative put wall below', () => {
    const w = computeGammaWalls(SAMPLE, 61_800);
    expect(w.callWall).toBe(70_000);
    expect(w.putWall).toBe(57_500);
  });

  it('interpolates the gamma flip at the cumulative zero-cross', () => {
    const w = computeGammaWalls(SAMPLE, 61_800);
    expect(w.gammaFlip).toBeCloseTo(68_541.67, 1);
  });

  it('returns nulls when spot is null or gex is empty', () => {
    expect(computeGammaWalls(SAMPLE, null)).toEqual({
      callWall: null,
      putWall: null,
      gammaFlip: null,
    });
    expect(computeGammaWalls([], 61_800)).toEqual({
      callWall: null,
      putWall: null,
      gammaFlip: null,
    });
  });

  it('omits the flip when cumulative GEX never crosses zero (all positive)', () => {
    const allPos: GexStrike[] = [
      { strike: 60_000, gexUsdMillions: 10 },
      { strike: 70_000, gexUsdMillions: 40 },
    ];
    const w = computeGammaWalls(allPos, 61_800);
    expect(w.gammaFlip).toBeNull();
    expect(w.callWall).toBe(70_000);
    expect(w.putWall).toBeNull(); // 60k is positive, not a (negative) put wall
  });

  it('ignores sub-floor noise strikes when choosing a wall', () => {
    const noisy: GexStrike[] = [
      { strike: 65_000, gexUsdMillions: 0.4 }, // above spot but below the 1M floor
      { strike: 55_000, gexUsdMillions: -0.3 }, // below spot but below the floor
    ];
    const w = computeGammaWalls(noisy, 61_800);
    expect(w.callWall).toBeNull();
    expect(w.putWall).toBeNull();
  });

  it('places the flip at the strike where cumulative GEX reaches exactly zero', () => {
    const exact: GexStrike[] = [
      { strike: 60_000, gexUsdMillions: -50 },
      { strike: 65_000, gexUsdMillions: 50 }, // cum: -50 -> 0 exactly at 65k
      { strike: 70_000, gexUsdMillions: 20 },
    ];
    // prevCum -50, cum 0: weight |prevCum|/denom = 50/50 = 1 -> lo + (hi-lo)*1 = hi = 65k
    expect(computeGammaWalls(exact, 61_800).gammaFlip).toBeCloseTo(65_000, 6);
  });
});
