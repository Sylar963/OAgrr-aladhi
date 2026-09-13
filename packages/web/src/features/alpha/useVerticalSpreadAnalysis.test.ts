import { describe, expect, it } from 'vitest';

import { computeTimeToExpiry } from './useVerticalSpreadAnalysis';

describe('computeTimeToExpiry', () => {
  it('uses the exact expiry timestamp instead of rounded DTE', () => {
    const nowMs = Date.UTC(2026, 8, 12, 6);
    const expiryTs = nowMs + 2 * 60 * 60 * 1_000;

    expect(computeTimeToExpiry(expiryTs, 1, nowMs)).toBeCloseTo(2 / 24 / 365.25, 12);
  });

  it('falls back to DTE when the venue has no expiry timestamp', () => {
    expect(computeTimeToExpiry(null, 7, 0)).toBeCloseTo(7 / 365.25, 12);
  });
});
