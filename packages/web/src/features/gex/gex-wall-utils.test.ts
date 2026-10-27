import { describe, expect, it } from 'vitest';
import type { GexProfilePoint, GexStrike } from '@shared/enriched';
import {
  computeGammaFlip,
  computeGammaWalls,
  flowAttributedShare,
  gexAtSpot,
  sumGexProfiles,
} from './gex-wall-utils';

// Spot 61,800. Call wall = 70k (+120), put wall = 57.5k (-85).
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

const profile = (pairs: [number, number][]): GexProfilePoint[] =>
  pairs.map(([movePct, gexUsdMillions]) => ({ movePct, gexUsdMillions }));

describe('computeGammaWalls', () => {
  it('picks max-positive call wall above spot and most-negative put wall below', () => {
    const w = computeGammaWalls(SAMPLE, 61_800);
    expect(w.callWall).toBe(70_000);
    expect(w.putWall).toBe(57_500);
  });

  it('has no flip without a profile', () => {
    expect(computeGammaWalls(SAMPLE, 61_800).gammaFlip).toBeNull();
  });

  it('takes the flip from the profile zero crossing', () => {
    const p = profile([
      [-0.01, -10],
      [-0.005, -2],
      [0, 6],
      [0.005, 9],
    ]);
    // -2 → +6 between -0.5% and 0%: crossing at -0.5% + 0.5% * 2/8 = -0.375%.
    expect(computeGammaWalls(SAMPLE, 80_000, p).gammaFlip).toBeCloseTo(80_000 * (1 - 0.00375), 6);
  });

  it('returns nulls when spot is null or gex is empty', () => {
    const empty = { callWall: null, putWall: null, gammaFlip: null };
    expect(computeGammaWalls(SAMPLE, null)).toEqual(empty);
    expect(computeGammaWalls([], 61_800)).toEqual(empty);
  });

  it('ignores sub-floor noise strikes when choosing a wall', () => {
    const noisy: GexStrike[] = [
      { strike: 65_000, gexUsdMillions: 0.004 },
      { strike: 55_000, gexUsdMillions: -0.003 },
    ];
    const w = computeGammaWalls(noisy, 61_800);
    expect(w.callWall).toBeNull();
    expect(w.putWall).toBeNull();
  });
});

describe('computeGammaFlip', () => {
  it.each<{ pairs: [number, number][] }>([
    { pairs: [[-0.2, 0], [0, 2], [0.2, 0]] },
    { pairs: [[-0.2, 0], [0, -2], [0.2, 0]] },
    { pairs: [[-0.01, 2], [0, 0], [0.01, 3]] },
    { pairs: [[-0.01, -2], [0, 0], [0.01, -3]] },
    { pairs: [[-0.01, 0], [0, 0], [0.01, 0]] },
  ])('ignores zero tails and touches without a sign change: $pairs', ({ pairs }) => {
    expect(computeGammaFlip(profile(pairs), 100)).toBeNull();
  });

  it('keeps an exact zero bracketed by opposite signs', () => {
    expect(computeGammaFlip(profile([[-0.01, -2], [0, 0], [0.01, 3]]), 100)).toBe(100);
  });

  it('uses the nearest zero in a plateau only when both signs are present', () => {
    expect(computeGammaFlip(profile([[-0.02, -2], [-0.01, 0], [0, 0], [0.01, 3]]), 100)).toBe(100);
    expect(computeGammaFlip(profile([[0, -2], [0.01, 0], [0.02, 0], [0.03, 3]]), 100)).toBe(101);
  });

  it('allows the nearest flip above spot while net gamma at spot is positive', () => {
    expect(computeGammaFlip(profile([[0, 2], [0.02, -2]]), 100)).toBe(101);
  });

  it('does not constrain a profile crossing to the selected walls', () => {
    const walls = computeGammaWalls(SAMPLE, 61_800, profile([[0, -10], [0.2, 2]]));
    expect(walls.gammaFlip).toBeCloseTo(72_100);
    expect(walls.gammaFlip!).toBeGreaterThan(walls.callWall!);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid spot %s', (spot) => {
    expect(computeGammaFlip(profile([[-0.01, -2], [0.01, 2]]), spot)).toBeNull();
  });

  it('is null when total GEX keeps one sign', () => {
    expect(computeGammaFlip(profile([[-0.01, 3], [0, 5], [0.01, 2]]), 100)).toBeNull();
  });

  it('interpolates a crossing below spot', () => {
    const flip = computeGammaFlip(profile([[-0.04, -50], [-0.02, 20], [0, 130], [0.02, 90]]), 81_746);
    expect(flip).not.toBeNull();
    expect(flip!).toBeLessThan(81_746);
  });

  it('picks the crossing nearest spot', () => {
    const p = profile([
      [-0.2, 5],
      [-0.19, -5],
      [-0.01, -1],
      [0.01, 1],
    ]);
    expect(computeGammaFlip(p, 100)).toBeCloseTo(100, 6);
  });
});

describe('profile helpers', () => {
  it('keeps a negative strike separate from the total gamma regime at spot', () => {
    const p = profile([[-0.01, -2], [0, 6], [0.01, 9]]);
    expect(computeGammaWalls(SAMPLE, 61_800, p).putWall).toBe(57_500);
    expect(gexAtSpot(p)).toBe(6);
    expect(gexAtSpot(profile([[0, 0]]))).toBe(0);
  });

  it('sums profiles pointwise and reads the 0% point', () => {
    const sum = sumGexProfiles([profile([[-0.005, 1], [0, 2]]), undefined, profile([[0, 3]])]);
    expect(sum).toEqual(profile([[-0.005, 1], [0, 5]]));
    expect(gexAtSpot(sum)).toBe(5);
    expect(gexAtSpot(undefined)).toBeNull();
  });

  it('weights flow share by |GEX|', () => {
    expect(
      flowAttributedShare([
        { strike: 1, gexUsdMillions: 30, flowShare: 1 },
        { strike: 2, gexUsdMillions: -10, flowShare: 0 },
      ]),
    ).toBeCloseTo(0.75, 9);
    expect(flowAttributedShare([{ strike: 1, gexUsdMillions: 30 }])).toBeNull();
  });
});
