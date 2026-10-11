import type { BreakEvenLine } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';
import {
  defaultExpiry,
  formatProb,
  historyWithLive,
  lineColors,
  lineKey,
  probGap,
  spotProjection,
  toChartPoints,
  withAlpha,
} from './break-even-chart';

function line(overrides: Partial<BreakEvenLine>): BreakEvenLine {
  return {
    strike: 70_000,
    right: 'call',
    markIv: 0.4,
    delta: 0.1,
    premiumUsd: 45,
    breakEven: 70_045,
    impliedProb: 0.033,
    historicalProb: 0.1,
    history: [],
    projection: [],
    ...overrides,
  };
}

describe('break-even chart helpers', () => {
  it('converts to ascending seconds and keeps the last value on a duplicate second', () => {
    expect(
      toChartPoints([
        { ts: 5_000, value: 2 },
        { ts: 1_000, value: 1 },
        { ts: 5_400, value: 3 },
      ]),
    ).toEqual([
      { time: 1, value: 1 },
      { time: 5, value: 3 },
    ]);
  });

  it('joins the recorded path to the live projection point', () => {
    const joined = historyWithLive(
      line({
        history: [{ ts: 3_600_000, value: 70_100 }],
        projection: [
          { ts: 4_000_000, value: 70_090 },
          { ts: 7_200_000, value: 70_080 },
        ],
      }),
    );
    expect(joined).toEqual([
      { time: 3_600, value: 70_100 },
      { time: 4_000, value: 70_090 },
    ]);
  });

  it('draws spot flat across the projection grid', () => {
    const projection = [
      { ts: 4_000_000, value: 1 },
      { ts: 7_200_000, value: 1 },
    ];
    expect(spotProjection([line({ projection })], 64_000, 4_000_000)).toEqual([
      { time: 4_000, value: 64_000 },
      { time: 7_200, value: 64_000 },
    ]);
  });

  it('colours each side brightest nearest the money', () => {
    const lines = [
      line({ strike: 66_000 }),
      line({ strike: 75_000 }),
      line({ strike: 62_000, right: 'put' }),
    ];
    const colors = lineColors(lines, 64_000);
    expect(colors.get(lineKey(lines[0]!))).toBe('rgb(92, 242, 181)');
    expect(colors.get(lineKey(lines[1]!))).toBe('rgb(24, 120, 88)');
    expect(colors.get(lineKey(lines[2]!))).toBe('rgb(255, 92, 122)');
    expect(withAlpha('rgb(255, 92, 122)', 0.2)).toBe('rgba(255, 92, 122, 0.2)');
  });

  it('formats probabilities and the historical minus implied gap', () => {
    expect(formatProb(0.0004)).toBe('<0.1%');
    expect(formatProb(0.033)).toBe('3.3%');
    expect(formatProb(0.453)).toBe('45%');
    expect(formatProb(null)).toBe('–');
    expect(probGap(line({}))).toBeCloseTo(6.7, 6);
    expect(probGap(line({ historicalProb: null }))).toBeNull();
  });

  it('defaults to the first live expiry at least a week out', () => {
    const day = 86_400_000;
    const expiries = [
      { expiry: 'a', expiryTs: 0 },
      { expiry: 'b', expiryTs: 3 * day },
      { expiry: 'c', expiryTs: 9 * day },
    ];
    expect(defaultExpiry(expiries, day)).toBe('c');
    expect(defaultExpiry(expiries.slice(0, 2), day)).toBe('b');
    expect(defaultExpiry([], day)).toBeNull();
  });
});
