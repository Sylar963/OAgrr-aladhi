import { describe, expect, it } from 'vitest';
import {
  computeOptionsParity,
  type OptionsParityInput,
  type ParityQuote,
} from './options-parity.js';

const NOW = 1_800_000_000_000;
function quote(mid: number, overrides: Partial<ParityQuote> = {}): ParityQuote {
  return {
    bid: mid - 0.1,
    ask: mid + 0.1,
    bidSize: 5,
    askSize: 8,
    bidTime: NOW - 1_000,
    askTime: NOW - 1_000,
    receivedAt: NOW,
    ...overrides,
  };
}
function pair(strike: number, difference: number, root = 'SPXW'): OptionsParityInput[] {
  return (['call', 'put'] as const).map((right) => ({
    root,
    expiryTs: NOW + 86_400_000,
    settlement: 'cash',
    strike,
    multiplier: 100,
    right,
    quote: quote(right === 'call' ? 20 + difference : 20),
  }));
}

describe('computeOptionsParity', () => {
  it('excludes the target pair from its benchmark, even when its own price changes', () => {
    const inputs = [...pair(90, 10), ...pair(100, 2), ...pair(110, -10)];
    const row = computeOptionsParity(inputs, NOW, true)[1]!;
    expect(row.referenceStrikes).toEqual([90, 110]);
    expect(row.consistencyResidual).toBeCloseTo(2);
    expect(row.consistencyLow).toBeCloseTo(1.6);
    expect(row.consistencyHigh).toBeCloseTo(2.4);
    inputs[2]!.quote = quote(25);
    expect(computeOptionsParity(inputs, NOW, true)[1]!.consistencyResidual).toBeCloseTo(5);
  });

  it('supports unequal strike spacing without assuming zero interest for consistency', () => {
    const rows = computeOptionsParity(
      [...pair(90, 9.5), ...pair(100, 0), ...pair(120, -19)],
      NOW,
      true,
    );
    expect(rows[1]!.consistencyResidual).toBeCloseTo(0);
    expect(rows[0]!.consistencyResidual).toBeNull();
    expect(rows[2]!.consistencyResidual).toBeNull();
  });

  it('withholds cross-strike comparisons for American or unknown exercise style', () => {
    const rows = computeOptionsParity(
      [...pair(90, 10), ...pair(100, 2), ...pair(110, -10)],
      NOW,
      false,
    );
    expect(rows[1]!.zeroRateForward).toBeCloseTo(102);
    expect(rows.every((r) => r.consistencyResidual == null)).toBe(true);
  });

  it('does not pair different roots or invent a benchmark from a single strike', () => {
    const inputs = [...pair(100, 0)];
    inputs[1]!.root = 'OTHER';
    expect(computeOptionsParity(inputs, NOW, true).every((r) => r.status === 'missing_pair')).toBe(
      true,
    );
    expect(computeOptionsParity(pair(100, 0), NOW, true)[0]!.consistencyResidual).toBeNull();
  });

  it.each([
    [{ bid: 30 }, 'invalid_quote'],
    [{ bidSize: 0 }, 'invalid_quote'],
    [{ bidTime: null }, 'missing_time'],
    [{ bidTime: NOW - 1_300_000 }, 'stale'],
    [{ receivedAt: NOW - 121_000 }, 'stale'],
    [{ bidTime: NOW - 60_000 }, 'unsynchronized'],
  ] as const)('rejects unusable quotes: %s', (patch, status) => {
    const inputs = pair(100, 0);
    inputs[0]!.quote = quote(20, patch);
    const row = computeOptionsParity(inputs, NOW, true)[0]!;
    expect(row.status).toBe(status);
    expect(row.zeroRateForward).toBeNull();
  });

  it('rejects benchmarks whose strikes were observed at different market times', () => {
    const inputs = [...pair(90, 10), ...pair(100, 0), ...pair(110, -10)];
    for (const input of inputs.slice(0, 2))
      input.quote = quote(input.right === 'call' ? 30 : 20, {
        bidTime: NOW - 60_000,
        askTime: NOW - 60_000,
      });
    expect(computeOptionsParity(inputs, NOW, true)[1]!.consistencyResidual).toBeNull();
  });
});
