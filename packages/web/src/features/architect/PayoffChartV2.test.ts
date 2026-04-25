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

  it('picks 5m × 36 buckets for sub-1d expiries', () => {
    expect(pickCandleSpec([leg(expiryInDays(0))])).toEqual({ resolutionSec: 300, buckets: 36 });
  });

  it('picks 1h × 24 buckets for sub-7d expiries', () => {
    expect(pickCandleSpec([leg(expiryInDays(3))])).toEqual({ resolutionSec: 3600, buckets: 24 });
  });

  it('picks 4h × 42 buckets for week+ expiries', () => {
    expect(pickCandleSpec([leg(expiryInDays(30))])).toEqual({ resolutionSec: 14400, buckets: 42 });
  });

  it('uses the nearest leg DTE when legs have mixed expiries', () => {
    const legs = [leg(expiryInDays(45)), leg(expiryInDays(2))];
    expect(pickCandleSpec(legs)).toEqual({ resolutionSec: 3600, buckets: 24 });
  });
});
