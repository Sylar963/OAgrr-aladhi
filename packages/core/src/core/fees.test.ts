import { describe, expect, it } from 'vitest';

import { cappedTakerFeeUsd } from './fees.js';

describe('cappedTakerFeeUsd', () => {
  it('charges the underlying-based rate when it is below the premium cap', () => {
    expect(cappedTakerFeeUsd(0.0003, 0.125, 2_000, 100_000, 2)).toBeCloseTo(60);
  });

  it('caps the fee at a fraction of the premium on cheap options', () => {
    expect(cappedTakerFeeUsd(0.0003, 0.125, 5, 100_000, 4)).toBeCloseTo(2.5);
  });

  it('charges the full cap when the underlying price is unknown', () => {
    expect(cappedTakerFeeUsd(0.0003, 0.125, 100, null)).toBeCloseTo(12.5);
  });
});
