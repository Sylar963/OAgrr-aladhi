import { describe, expect, it, vi } from 'vitest';
import { ExpectedMoveResponseSchema } from '@oggregator/protocol';
import type { RawCandle } from '../tastytrade/candle-codec.js';
import { buildSpxMoveReport, cashSessionTime, SpxMoveSource } from './expected-move.js';

const bar = (date: string, price: number): RawCandle => ({
  symbol: 'SPX{=d}',
  flags: 0,
  time: Date.parse(`${date}T05:00:00Z`),
  o: price,
  h: price * 1.03,
  l: price * 0.99,
  c: price * 1.02,
  v: 0,
  iv: NaN,
});

describe('SPX expected-move sessions', () => {
  it('handles the New York DST transition', () => {
    expect(cashSessionTime('2026-10-30', 9, 30)).toBe(Date.parse('2026-10-30T13:30:00Z'));
    expect(cashSessionTime('2026-11-02', 9, 30)).toBe(Date.parse('2026-11-02T14:30:00Z'));
  });

  it('uses the prior trading close IV across weekends without reading the same-day close', () => {
    const report = buildSpxMoveReport(
      [bar('2026-11-06', 6000), bar('2026-11-09', 6100)],
      [
        { ...bar('2026-11-06', 16), c: 16 },
        { ...bar('2026-11-09', 40), c: 40 },
      ],
      [],
      [],
      Date.parse('2026-11-10T03:00:00Z'),
    );
    expect(ExpectedMoveResponseSchema.safeParse(report).success).toBe(true);
    expect(report.history[0]?.openingIv).toBe(0.16);
    expect(report.history[0]?.classification).toBe('large');
    expect(report.history[0]?.open).toBe(6100);
    expect(report.history[0]?.expectedFraction).toBeCloseTo(0.16 / Math.sqrt(252));
    expect(report.history[1]?.openingIv).toBeNull();
    expect(report.current).toBeNull();
    expect(report.liveIv).toBeNull();
  });

  it('does not finalize the current session or describe an old price as current', () => {
    const now = Date.parse('2026-11-09T18:00:00Z');
    const report = buildSpxMoveReport(
      [bar('2026-11-06', 6000), bar('2026-11-09', 6100)],
      [{ ...bar('2026-11-06', 16), c: 16 }],
      [],
      [],
      now,
    );
    expect(report.current?.complete).toBe(false);
    expect(report.current?.classification).toBe('unavailable');
    expect(report.current?.coverage).toBe('partial');
    const spotTail = [{ ...bar('2026-11-09', 6100), time: now - 60_000 }];
    const live = buildSpxMoveReport(
      [bar('2026-11-06', 6000), bar('2026-11-09', 6100)],
      [{ ...bar('2026-11-06', 16), c: 16 }],
      spotTail,
      [],
      now,
    );
    expect(live.current?.classification).toBe('in-progress');
    expect(live.current?.coverage).toBe('complete');
  });

  it('coalesces history loads and retries after failure', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);
    const source = new SpxMoveSource({ getCandles });
    await Promise.all([source.get(100_000), source.get(100_000)]);
    expect(getCandles).toHaveBeenCalledTimes(4);
    getCandles.mockRejectedValueOnce(new Error('disconnected'));
    await expect(source.get(200_000)).rejects.toThrow('disconnected');
    await source.get(200_001);
    expect(getCandles).toHaveBeenCalledTimes(12);
  });
});
