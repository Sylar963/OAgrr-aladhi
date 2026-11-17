import { describe, expect, it } from 'vitest';
import { calendarActivity, DAY_MS, weekdayActivity, type ActivityDay } from './activity';

const MONDAY = Date.UTC(2026, 0, 5);
function day(ts: number, range: number, vol: number, bars = 24): ActivityDay {
  return {
    ts,
    bars,
    range,
    vol,
    hourlyRanges: Array.from({ length: 24 }, (_, hour) => (hour < bars ? range : null)),
  };
}

describe('daily activity comparisons', () => {
  it('averages matching weekdays with equal sample counts and pools variance', () => {
    const rows = weekdayActivity([
      day(MONDAY, 0.01, 0.2),
      day(MONDAY + 7 * DAY_MS, 0.03, 0.6),
      day(MONDAY + DAY_MS, 0.05, 0.8),
      day(MONDAY + 14 * DAY_MS, 0.9, 3, 4),
    ]);
    expect(rows[0]!.days).toBe(2);
    expect(rows[0]!.bars).toBe(48);
    expect(rows[0]!.hourlyRanges[12]).toBeCloseTo(0.02);
    expect(rows[0]!.range).toBeCloseTo(0.02);
    expect(rows[0]!.vol).toBeCloseTo(Math.sqrt((0.2 ** 2 + 0.6 ** 2) / 2));
    expect(rows[1]!.range).toBe(0.05);
    expect(rows[2]!.hourlyRanges).toEqual(Array(24).fill(null));
    expect(rows[2]!.vol).toBeNull();
  });

  it('keeps missing calendar days blank and preserves zero-range hours', () => {
    const rows = calendarActivity(
      [day(MONDAY, 0, 0), day(MONDAY + 2 * DAY_MS, 0.02, 0.4, 2)],
      MONDAY + 2 * DAY_MS,
    );
    expect(rows).toHaveLength(14);
    expect(rows[11]!.hourlyRanges).toEqual(Array(24).fill(0));
    expect(rows[12]!.bars).toBe(0);
    expect(rows[12]!.hourlyRanges).toEqual(Array(24).fill(null));
    expect(rows[13]!.bars).toBe(2);
    expect(rows[13]!.hourlyRanges[2]).toBeNull();
  });
});
