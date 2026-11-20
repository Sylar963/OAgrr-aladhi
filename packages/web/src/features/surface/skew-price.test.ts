import { describe, expect, it } from 'vitest';
import { chartPath, chartRange, nearestPoint } from './skew-price';

describe('price and skew chart data', () => {
  it('breaks paths at missing values and time gaps', () => {
    const points = [
      { time: 0, value: 1 },
      { time: 1, value: 2 },
      { time: 2, value: null },
      { time: 3, value: 3 },
      { time: 10, value: 4 },
    ];
    expect(
      chartPath(
        points,
        (value) => value,
        (value) => value,
        2,
      ),
    ).toBe('M0.0,1.0L1.0,2.0M3.0,3.0M10.0,4.0');
  });

  it('does not show a distant price as if it matched the cursor timestamp', () => {
    const points = [
      { time: 0, value: 60_000 },
      { time: 3600, value: 61_000 },
    ];
    expect(nearestPoint(points, 3000, 1800)).toEqual(points[1]);
    expect(nearestPoint(points, 7200, 1800)).toBeNull();
  });

  it('keeps independent units and produces a usable range for a flat series', () => {
    expect(chartRange([{ time: 0, value: null }])).toBeNull();
    const skew = chartRange([{ time: 0, value: 0 }])!;
    const price = chartRange([{ time: 0, value: 60_000 }])!;
    expect(skew[0]).toBeLessThan(0);
    expect(skew[1]).toBeGreaterThan(0);
    expect(price[0]).toBeLessThan(60_000);
    expect(price[1]).toBeGreaterThan(60_000);
    expect(price[0]).toBeGreaterThan(50_000);
  });
});
