import { describe, expect, it } from 'vitest';
import { pickCandleSpec } from './PayoffChartV2';
import type { Leg } from './payoff';

function leg(expiry: string): Leg {
  return {
    id: expiry,
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry,
    quantity: 1,
    entryPrice: 1,
    venue: 'deribit',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
  };
}

function expiryInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

describe('pickCandleSpec', () => {
  it('defaults to 1h × 24 buckets when no legs', () => {
    expect(pickCandleSpec([])).toEqual({ resolutionSec: 3600, buckets: 24 });
  });

  it('intraday picks 5m × 48 buckets', () => {
    expect(pickCandleSpec([leg(expiryInDays(0))])).toEqual({ resolutionSec: 300, buckets: 48 });
  });

  it('1–3d picks 30m and bucket count tracks DTE', () => {
    const spec1d = pickCandleSpec([leg(expiryInDays(1))]);
    const spec2d = pickCandleSpec([leg(expiryInDays(2))]);
    expect(spec1d.resolutionSec).toBe(1800);
    expect(spec2d.resolutionSec).toBe(1800);
    // Different DTE within the same tier must produce different bucket counts
    // so the query key changes and TanStack Query refetches.
    expect(spec1d.buckets).not.toBe(spec2d.buckets);
  });

  it('3–14d picks 1h and bucket count scales with DTE', () => {
    const spec3d = pickCandleSpec([leg(expiryInDays(3))]);
    const spec10d = pickCandleSpec([leg(expiryInDays(10))]);
    expect(spec3d.resolutionSec).toBe(3600);
    expect(spec10d.resolutionSec).toBe(3600);
    expect(spec3d.buckets).toBeLessThan(spec10d.buckets);
  });

  it('14–60d picks 4h and bucket count scales with DTE', () => {
    const spec14d = pickCandleSpec([leg(expiryInDays(14))]);
    const spec45d = pickCandleSpec([leg(expiryInDays(45))]);
    expect(spec14d.resolutionSec).toBe(14400);
    expect(spec45d.resolutionSec).toBe(14400);
    expect(spec14d.buckets).toBeLessThan(spec45d.buckets);
  });

  it('60d+ picks daily resolution', () => {
    const spec90d = pickCandleSpec([leg(expiryInDays(90))]);
    expect(spec90d.resolutionSec).toBe(86400);
  });

  it('uses the nearest leg DTE when legs have mixed expiries', () => {
    const legs = [leg(expiryInDays(45)), leg(expiryInDays(2))];
    const spec = pickCandleSpec(legs);
    expect(spec.resolutionSec).toBe(1800);
  });
});
