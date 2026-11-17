import { describe, expect, it } from 'vitest';
import { aggregateOptionsActivity, type OptionsActivityInput } from './options-activity.js';

function input(
  symbol: string,
  right: 'call' | 'put',
  overrides: Partial<OptionsActivityInput> = {},
): OptionsActivityInput {
  return {
    symbol,
    right,
    expiry: '2026-12-18',
    strike: 100,
    multiplier: 100,
    volume: 10,
    openInterest: 20,
    ...overrides,
  };
}

describe('aggregateOptionsActivity', () => {
  it('reconciles contracts and notionals across expiries, strikes and cells without duplicate symbols', () => {
    const rows = [
      input('C', 'call'),
      input('P', 'put', { volume: 30 }),
      input('C2', 'call', { expiry: '2027-01-15', strike: 110, multiplier: 10 }),
    ];
    const result = aggregateOptionsActivity([...rows, rows[0]!], 100);
    expect(result.summary.call.volume).toBe(20);
    expect(result.summary.putCallVolumeRatio).toBe(1.5);
    expect(result.summary.call.volumeNotionalUsd).toBe(110_000);
    for (const breakdown of [result.byExpiry, result.byStrike, result.cells]) {
      expect(breakdown.reduce((s, r) => s + (r.call.volume ?? 0) + (r.put.volume ?? 0), 0)).toBe(
        50,
      );
    }
  });

  it('preserves missing values and withholds ratios with partial coverage', () => {
    const result = aggregateOptionsActivity(
      [input('C', 'call'), input('P', 'put', { volume: null, openInterest: Number.NaN })],
      null,
    );
    expect(result.summary.put.volume).toBeNull();
    expect(result.summary.put.volumeObserved).toBe(0);
    expect(result.summary.putCallVolumeRatio).toBeNull();
    expect(result.summary.putCallOiRatio).toBeNull();
    expect(result.summary.call.volumeNotionalUsd).toBeNull();
  });

  it('keeps reported zero and avoids dividing by zero', () => {
    const result = aggregateOptionsActivity(
      [input('C', 'call', { volume: 0 }), input('P', 'put', { volume: 0 })],
      100,
    );
    expect(result.summary.call.volume).toBe(0);
    expect(result.summary.call.volumeObserved).toBe(1);
    expect(result.summary.putCallVolumeRatio).toBeNull();
  });
});
