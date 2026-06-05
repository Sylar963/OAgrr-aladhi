import { describe, expect, it } from 'vitest';
import {
  applyBookInterval,
  bootstrapNaivePosition,
  signOiDelta,
  type DealerPosition,
  type OiSnapshotInput,
} from './dealer-book.js';

function snap(overrides: Partial<OiSnapshotInput> = {}): OiSnapshotInput {
  return {
    venue: 'deribit',
    symbol: 'BTC-30JUN26-70000-C',
    underlying: 'BTC',
    expiry: '2026-06-30',
    strike: 70000,
    optionType: 'call',
    openInterest: 100,
    snapshotTs: 1_000,
    ...overrides,
  };
}

describe('bootstrapNaivePosition', () => {
  it('seeds calls long (+OI) and puts short (-OI)', () => {
    expect(bootstrapNaivePosition(snap()).dealerContracts).toBe(100);
    expect(bootstrapNaivePosition(snap({ optionType: 'put' })).dealerContracts).toBe(-100);
  });

  it('carries lastOi and lastSnapshotTs', () => {
    const pos = bootstrapNaivePosition(snap({ openInterest: 42, snapshotTs: 9 }));
    expect(pos.lastOi).toBe(42);
    expect(pos.lastSnapshotTs).toBe(9);
  });
});

describe('signOiDelta (opening increment)', () => {
  it('aggressive buyers → dealer short (negative)', () => {
    expect(signOiDelta({ deltaOi: 10, netFlow: 5, hasFlow: true, optionType: 'call' })).toBe(-10);
    expect(signOiDelta({ deltaOi: 10, netFlow: 5, hasFlow: true, optionType: 'put' })).toBe(-10);
  });

  it('aggressive sellers → dealer long (positive)', () => {
    expect(signOiDelta({ deltaOi: 10, netFlow: -5, hasFlow: true, optionType: 'call' })).toBe(10);
  });

  it('no flow → naive-prior sign (call +, put -)', () => {
    expect(signOiDelta({ deltaOi: 10, netFlow: 0, hasFlow: false, optionType: 'call' })).toBe(10);
    expect(signOiDelta({ deltaOi: 10, netFlow: 0, hasFlow: false, optionType: 'put' })).toBe(-10);
  });

  it('balanced flow (netFlow 0 with trades) → naive-prior sign', () => {
    expect(signOiDelta({ deltaOi: 10, netFlow: 0, hasFlow: true, optionType: 'put' })).toBe(-10);
  });
});

describe('applyBookInterval', () => {
  const prior: DealerPosition = bootstrapNaivePosition(snap()); // +100, lastOi 100

  it('opening buy reduces a bootstrapped long call toward short', () => {
    const next = applyBookInterval({
      prior,
      snapshot: snap({ openInterest: 130, snapshotTs: 2_000 }),
      netFlow: 20,
      hasFlow: true,
    });
    // ΔOI = +30, aggressive buyers → -30 increment → 100 - 30 = 70
    expect(next.dealerContracts).toBe(70);
    expect(next.lastOi).toBe(130);
    expect(next.lastSnapshotTs).toBe(2_000);
  });

  it('closing OI scales the position toward zero proportionally', () => {
    const next = applyBookInterval({
      prior, // +100, lastOi 100
      snapshot: snap({ openInterest: 40, snapshotTs: 2_000 }),
      netFlow: 0,
      hasFlow: false,
    });
    // ΔOI = -60 → scale 40/100 → 100 * 0.4 = 40
    expect(next.dealerContracts).toBeCloseTo(40, 10);
  });

  it('churn (ΔOI ≈ 0) leaves the position unchanged', () => {
    const next = applyBookInterval({
      prior,
      snapshot: snap({ openInterest: 100, snapshotTs: 2_000 }),
      netFlow: 50,
      hasFlow: true,
    });
    expect(next.dealerContracts).toBe(100);
  });

  it('keeps |dealer| <= OI across an opening interval', () => {
    const next = applyBookInterval({
      prior,
      snapshot: snap({ openInterest: 150, snapshotTs: 2_000 }),
      netFlow: 10,
      hasFlow: true,
    });
    // 100 - 50 = 50, |50| <= 150
    expect(Math.abs(next.dealerContracts)).toBeLessThanOrEqual(150);
  });
});
