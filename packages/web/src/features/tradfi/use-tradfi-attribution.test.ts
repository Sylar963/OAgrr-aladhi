import { describe, it, expect } from 'vitest';
import { alignTradfiBars, expiryToMs, computeTradfiAttribution } from './use-tradfi-attribution';

describe('alignTradfiBars', () => {
  it('joins option and underlying closes by exact ts and drops unmatched', () => {
    const bars = alignTradfiBars(
      [{ ts: 100, c: 5 }, { ts: 200, c: 6 }, { ts: 300, c: 7 }],
      [{ ts: 100, c: 500 }, { ts: 300, c: 530 }],
    );
    expect(bars).toEqual([
      { ts: 100, mark: 5, forward: 500 },
      { ts: 300, mark: 7, forward: 530 },
    ]);
  });
});

describe('expiryToMs', () => {
  it('maps a YYYY-MM-DD expiry to ~US close (21:00 UTC) ms', () => {
    expect(expiryToMs('2026-06-19')).toBe(Date.parse('2026-06-19T21:00:00Z'));
  });
});

describe('computeTradfiAttribution', () => {
  it('returns null when fewer than 2 aligned bars', () => {
    const r = computeTradfiAttribution({
      optionCandles: [{ ts: 100, c: 5 }],
      underlyingCandles: [{ ts: 100, c: 500 }],
      strike: 500, right: 'call', expiry: '2026-12-18',
    });
    expect(r).toBeNull();
  });

  it('produces an attribution result for a multi-bar series', () => {
    // Realistic ATM call prices (~40% IV) so the Black-76 Newton solver converges
    // from its 0.5 seed: ~140 premium on a 500 forward ~3y out.
    const optionCandles = Array.from({ length: 6 }, (_, k) => ({ ts: 1_700_000_000_000 + k * 3_600_000, c: 140 + k }));
    const underlyingCandles = optionCandles.map((b, k) => ({ ts: b.ts, c: 500 + k * 2 }));
    const r = computeTradfiAttribution({
      optionCandles, underlyingCandles, strike: 500, right: 'call', expiry: '2027-01-15',
    });
    expect(r).not.toBeNull();
    expect(r!.points.length).toBeGreaterThan(0);
    expect(r!.summary).toHaveProperty('deltaPct');
  });
});
