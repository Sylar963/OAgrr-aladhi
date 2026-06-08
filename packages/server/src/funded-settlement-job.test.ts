import { describe, expect, it } from 'vitest';
import { computeNextSettlementBoundary } from './funded-settlement-job.js';

describe('computeNextSettlementBoundary', () => {
  it('returns today 08:00 UTC when now is before 08:00', () => {
    const now = new Date('2026-06-06T07:00:00Z');
    expect(computeNextSettlementBoundary(now).toISOString()).toBe('2026-06-06T08:00:00.000Z');
  });
  it('returns tomorrow 08:00 UTC when now is after 08:00', () => {
    const now = new Date('2026-06-06T09:00:00Z');
    expect(computeNextSettlementBoundary(now).toISOString()).toBe('2026-06-07T08:00:00.000Z');
  });
  it('returns tomorrow 08:00 UTC when now is exactly 08:00', () => {
    const now = new Date('2026-06-06T08:00:00Z');
    expect(computeNextSettlementBoundary(now).toISOString()).toBe('2026-06-07T08:00:00.000Z');
  });
});
