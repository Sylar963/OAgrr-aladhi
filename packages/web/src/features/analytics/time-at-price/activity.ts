import type { TimeAtPriceResponse } from '@oggregator/protocol';

export const DAY_MS = 86_400_000;
export const ACTIVITY_PAGE_DAYS = 14;
export type ActivityDay = TimeAtPriceResponse['dailyActivity'][number];

export function weekdayActivity(days: readonly ActivityDay[]) {
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = (index + 1) % 7;
    const complete = days.filter(
      (day) => new Date(day.ts).getUTCDay() === weekday && day.bars === 24,
    );
    const count = complete.length;
    return {
      ts: Date.UTC(2026, 0, 5 + index),
      days: count,
      bars: count * 24,
      range: count ? complete.reduce((sum, day) => sum + day.range, 0) / count : null,
      vol: count ? Math.sqrt(complete.reduce((sum, day) => sum + day.vol ** 2, 0) / count) : null,
      hourlyRanges: Array.from({ length: 24 }, (_, hour) =>
        count
          ? complete.reduce((sum, day) => sum + (day.hourlyRanges[hour] ?? 0), 0) / count
          : null,
      ),
    };
  });
}

export function calendarActivity(days: readonly ActivityDay[], endDay: number) {
  const byDay = new Map(days.map((day) => [day.ts, day]));
  return Array.from({ length: ACTIVITY_PAGE_DAYS }, (_, index) => {
    const ts = endDay - (ACTIVITY_PAGE_DAYS - 1 - index) * DAY_MS;
    const day = byDay.get(ts);
    return {
      ts,
      days: day ? 1 : 0,
      bars: day?.bars ?? 0,
      range: day?.range ?? null,
      vol: day?.vol ?? null,
      hourlyRanges: day?.hourlyRanges ?? Array<number | null>(24).fill(null),
    };
  });
}
