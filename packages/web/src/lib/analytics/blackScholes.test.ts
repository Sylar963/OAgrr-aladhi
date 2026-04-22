import { describe, it, expect } from 'vitest';

import {
  blackScholesCall,
  blackScholesPut,
  impliedVolNewtonRaphson,
  normCdf,
  normPdf,
  erf,
} from './blackScholes';

// Numeric parity targets. Values generated from the reference Python
// implementation using scipy.stats.norm; tolerances reflect A&S 7.1.26 accuracy.
describe('erf / normCdf / normPdf', () => {
  it('erf matches known values (A&S 7.1.26, ~1.5e-7 precision)', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
  });
  it('normCdf matches scipy (A&S 26.2.17, ~7.5e-8 precision)', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normCdf(-1)).toBeCloseTo(0.1586553, 6);
  });
  it('normPdf(0) ≈ 0.3989 (machine precision)', () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804, 9);
  });
});

// BS price precision is bounded by Φ precision × spot. With A&S 26.2.17 and
// spot=100, this gives ~1e-5 absolute error — well under the Python spec's
// "within 1e-5" parity target.
describe('blackScholesCall / blackScholesPut', () => {
  it('ATM 1Y 20%vol 5%r call ≈ 10.45058', () => {
    expect(blackScholesCall(100, 100, 1, 0.05, 0.2)).toBeCloseTo(10.45058, 4);
  });
  it('ATM 1Y 20%vol 5%r put ≈ 5.57353', () => {
    expect(blackScholesPut(100, 100, 1, 0.05, 0.2)).toBeCloseTo(5.57353, 4);
  });
  it('put-call parity', () => {
    // C - P = S - K * exp(-rT)
    const c = blackScholesCall(100, 90, 0.5, 0.03, 0.25);
    const p = blackScholesPut(100, 90, 0.5, 0.03, 0.25);
    const parity = 100 - 90 * Math.exp(-0.03 * 0.5);
    expect(c - p).toBeCloseTo(parity, 8);
  });
  it('zero time → intrinsic', () => {
    expect(blackScholesCall(110, 100, 0, 0.05, 0.2)).toBe(10);
    expect(blackScholesCall(90, 100, 0, 0.05, 0.2)).toBe(0);
    expect(blackScholesPut(90, 100, 0, 0.05, 0.2)).toBe(10);
    expect(blackScholesPut(110, 100, 0, 0.05, 0.2)).toBe(0);
  });
});

describe('impliedVolNewtonRaphson', () => {
  it('recovers σ=0.2 from an ATM call', () => {
    const price = blackScholesCall(100, 100, 1, 0.05, 0.2);
    const iv = impliedVolNewtonRaphson({
      marketPrice: price,
      spot: 100,
      strike: 100,
      T: 1,
      r: 0.05,
      right: 'call',
    });
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(0.2, 5);
  });
  it('recovers σ=0.35 from an OTM put', () => {
    const price = blackScholesPut(100, 90, 0.5, 0.03, 0.35);
    const iv = impliedVolNewtonRaphson({
      marketPrice: price,
      spot: 100,
      strike: 90,
      T: 0.5,
      r: 0.03,
      right: 'put',
    });
    expect(iv!).toBeCloseTo(0.35, 5);
  });
  it('returns null for non-positive price or time', () => {
    expect(
      impliedVolNewtonRaphson({
        marketPrice: 0,
        spot: 100,
        strike: 100,
        T: 1,
        r: 0.05,
        right: 'call',
      }),
    ).toBeNull();
    expect(
      impliedVolNewtonRaphson({
        marketPrice: 5,
        spot: 100,
        strike: 100,
        T: 0,
        r: 0.05,
        right: 'call',
      }),
    ).toBeNull();
  });
  it('returns null when σ would escape [0, 5]', () => {
    // Absurdly high premium the model cannot support → divergence
    const iv = impliedVolNewtonRaphson({
      marketPrice: 200,
      spot: 100,
      strike: 100,
      T: 1,
      r: 0.05,
      right: 'call',
    });
    expect(iv).toBeNull();
  });
});
