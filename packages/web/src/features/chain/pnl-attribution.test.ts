import { describe, expect, it } from 'vitest';
import {
  bs76Delta,
  bs76Gamma,
  bs76Vega,
  bs76ThetaPerDay,
  bs76Price,
  solveIvBs76,
  attributePnL,
} from './pnl-attribution.js';

describe('Black-76 helpers', () => {
  it('ATM call delta is ≈0.5 (no drift, r=0)', () => {
    // F = K, sigma = 0.6, T = 7 days
    const d = bs76Delta(70_000, 70_000, 0.6, 7 / 365.25, 'call');
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(0.55);
  });

  it('put delta is call delta minus one', () => {
    const c = bs76Delta(70_000, 65_000, 0.6, 7 / 365.25, 'call');
    const p = bs76Delta(70_000, 65_000, 0.6, 7 / 365.25, 'put');
    expect(c - p).toBeCloseTo(1, 6);
  });

  it('gamma is positive and symmetric in call/put (Black-76)', () => {
    const g = bs76Gamma(70_000, 70_000, 0.6, 7 / 365.25);
    expect(g).toBeGreaterThan(0);
  });

  it('vega is positive', () => {
    const v = bs76Vega(70_000, 70_000, 0.6, 7 / 365.25);
    expect(v).toBeGreaterThan(0);
  });

  it('theta per day is negative for long options (r=0)', () => {
    const t = bs76ThetaPerDay(70_000, 70_000, 0.6, 7 / 365.25);
    expect(t).toBeLessThan(0);
  });

  it('solveIvBs76 recovers the sigma that produced the price', () => {
    const f = 70_000;
    const k = 67_000;
    const sigma = 0.55;
    const tYears = 14 / 365.25;
    const price = bs76Price(f, k, sigma, tYears, 'call');
    const solved = solveIvBs76({ price, forward: f, strike: k, tYears, right: 'call', seed: 0.5 });
    expect(solved).not.toBeNull();
    expect(solved!).toBeCloseTo(sigma, 4);
  });

  it('solveIvBs76 returns null for prices outside no-arbitrage bounds', () => {
    // intrinsic for a 67k call when F=70k is 3000; price below that is invalid.
    expect(
      solveIvBs76({ price: 100, forward: 70_000, strike: 67_000, tYears: 14 / 365.25, right: 'call', seed: 0.5 }),
    ).toBeNull();
  });
});

describe('attributePnL', () => {
  it('returns one fewer point than input bars (first bar has no diff)', () => {
    const bars = makeFlatBars(5, { mark: 2000, forward: 70_000 });
    const result = attributePnL({
      bars,
      strike: 70_000,
      right: 'call',
      expirationMs: bars[0]!.ts + 30 * 24 * 60 * 60 * 1000,
    });
    expect(result.points).toHaveLength(4);
  });

  it('a flat market produces ~zero total PnL (theta and vega cancel)', () => {
    // Constant mark + constant forward across bars. dS=0 → deltaPL=0, gammaPL=0.
    // Time still ticks down, so to keep the mark flat the solved IV must drift
    // up slightly each bar. The resulting positive vegaPL exactly cancels the
    // negative thetaPL — total realized PL is zero. That cancellation IS the
    // genuine "flat market" property; the individual greeks are not separately
    // zero.
    const bars = makeFlatBars(10, { mark: 2000, forward: 70_000 });
    const result = attributePnL({
      bars,
      strike: 70_000,
      right: 'call',
      expirationMs: bars[0]!.ts + 30 * 24 * 60 * 60 * 1000,
    });
    for (const p of result.points) {
      expect(Math.abs(p.deltaPL)).toBeLessThan(1e-6);
      expect(Math.abs(p.gammaPL)).toBeLessThan(1e-6);
      expect(p.thetaPL).toBeLessThan(0);
      expect(p.vegaPL).toBeGreaterThan(0);
      expect(p.totalPL).toBeCloseTo(0, 6);
    }
  });

  it('sum of components + residual equals total PL exactly', () => {
    const bars = makeMovingBars();
    const result = attributePnL({
      bars,
      strike: 70_000,
      right: 'call',
      expirationMs: bars[0]!.ts + 30 * 24 * 60 * 60 * 1000,
    });
    for (const p of result.points) {
      const reconstructed = p.deltaPL + p.gammaPL + p.thetaPL + p.vegaPL + p.residualPL;
      expect(reconstructed).toBeCloseTo(p.totalPL, 8);
    }
    // Aggregate check: summary.totalPL - summary.attributedPL should equal the
    // sum of per-point residuals. Pins the contract between point-level and
    // summary-level numbers.
    const sumResid = result.points.reduce((acc, p) => acc + p.residualPL, 0);
    expect(result.summary.totalPL - result.summary.attributedPL).toBeCloseTo(sumResid, 8);
  });

  it('summary percentages sum to 100 (component share of |contribution|)', () => {
    const bars = makeMovingBars();
    const result = attributePnL({
      bars,
      strike: 70_000,
      right: 'call',
      expirationMs: bars[0]!.ts + 30 * 24 * 60 * 60 * 1000,
    });
    const pct = result.summary;
    const sum = pct.deltaPct + pct.gammaPct + pct.thetaPct + pct.vegaPct + pct.residualPct;
    expect(sum).toBeCloseTo(1, 6);
  });

  it('skips bars where IV cannot be solved (price violates no-arb bounds)', () => {
    // A 60k call when F=70k has intrinsic = 10000. A mark of 9500 is below
    // intrinsic → solveIvBs76 returns null → that segment is dropped.
    const bars = [
      mkBar(0, { mark: 10_500, forward: 70_000 }),
      mkBar(60_000, { mark: 9500, forward: 70_000 }),   // below intrinsic
      mkBar(120_000, { mark: 10_700, forward: 70_500 }),
      mkBar(180_000, { mark: 11_000, forward: 71_000 }),
    ];
    const result = attributePnL({
      bars,
      strike: 60_000,
      right: 'call',
      expirationMs: bars[0]!.ts + 30 * 24 * 60 * 60 * 1000,
    });
    // The bad-IV bar breaks the chain; we get at most two valid segments
    // (bar 2→3 and 3→4). Skipped counter reflects the segment loss.
    expect(result.points.length).toBeLessThanOrEqual(2);
    expect(result.summary.skipped).toBeGreaterThan(0);
    for (const p of result.points) {
      expect(Number.isFinite(p.totalPL)).toBe(true);
    }
  });
});

function mkBar(offsetMs: number, vals: { mark: number; forward: number }) {
  return { ts: 1_700_000_000_000 + offsetMs, mark: vals.mark, forward: vals.forward };
}

function makeFlatBars(n: number, vals: { mark: number; forward: number }) {
  return Array.from({ length: n }, (_, i) => mkBar(i * 60_000, vals));
}

function makeMovingBars() {
  const bars: { ts: number; mark: number; forward: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const fwd = 70_000 + i * 100; // monotonic up move
    // Price scales roughly with forward × ATM σ √T (rough fixture, not exact BS)
    const mark = 2000 + i * 60;
    bars.push(mkBar(i * 60_000, { mark, forward: fwd }));
  }
  return bars;
}
