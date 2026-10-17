import { describe, expect, it } from 'vitest';

import { futureTimes } from './future-axis';

describe('futureTimes', () => {
  it('steps one bar at a time and lands exactly on the deadline', () => {
    expect(futureTimes(1000, 1000 + 3 * 600 + 100, 600)).toEqual([1600, 2200, 2800, 2900]);
  });

  it('returns nothing once the deadline has passed', () => {
    expect(futureTimes(5000, 4000, 60)).toEqual([]);
    expect(futureTimes(5000, 5000, 60)).toEqual([]);
  });

  it('thins long horizons to the point cap', () => {
    const times = futureTimes(0, 900 * 10_000, 900, 1000);
    expect(times.length).toBeLessThanOrEqual(1001);
    expect(times.at(-1)).toBe(900 * 10_000);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
  });
});
