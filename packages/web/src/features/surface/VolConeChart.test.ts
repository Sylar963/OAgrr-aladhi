import { describe, expect, it } from 'vitest';

import type { VolConeBand } from '@oggregator/protocol';

import { estimateConePercentile } from './VolConeChart';

const band: VolConeBand = {
  horizonDays: 30,
  windowDays: 30,
  sampleCount: 170,
  min: 0.2,
  p10: 0.3,
  p25: 0.35,
  p50: 0.4,
  p75: 0.5,
  p90: 0.6,
  max: 0.8,
  current: 0.42,
};

describe('estimateConePercentile', () => {
  it('interpolates between the published quantiles', () => {
    expect(estimateConePercentile(band, 0.4)).toBe(50);
    expect(estimateConePercentile(band, 0.45)).toBeCloseTo(62.5, 10);
    expect(estimateConePercentile(band, 0.25)).toBeCloseTo(5, 10);
  });

  it('returns null outside the cone', () => {
    expect(estimateConePercentile(band, 0.19)).toBeNull();
    expect(estimateConePercentile(band, 0.81)).toBeNull();
  });
});
