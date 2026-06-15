import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SkewDensityStrip from './SkewDensityStrip';
import type { SkewDistribution } from './skew-history-utils';

const dist: SkewDistribution = {
  bins: [
    { x: -9, density: 0.1 },
    { x: -6, density: 0.5 },
    { x: -3, density: 0.1 },
  ],
  nowValue: -6,
  percentile: 56,
  sigma: 0.12,
  zone: 'normal',
  mean: -6,
  stddev: 1.5,
  rangeLo: -9,
  rangeHi: -3,
  min: -9,
  max: -3,
};

describe('SkewDensityStrip', () => {
  it('renders the verdict line with zone, percentile, vol points', () => {
    render(
      <SkewDensityStrip
        label="25Δ RR"
        color="#50d2c1"
        distribution={dist}
        atmText="−14.9% ATM"
        spark={[
          { time: 1, value: -6 },
          { time: 2, value: -6 },
        ]}
      />,
    );
    expect(screen.getByText('25Δ RR')).toBeTruthy();
    expect(screen.getByText('NORMAL')).toBeTruthy();
    expect(screen.getByText(/56th/)).toBeTruthy();
    expect(screen.getByText(/-6.0vp|−6.0vp/)).toBeTruthy();
  });

  it('renders insufficient state when distribution is null', () => {
    render(
      <SkewDensityStrip label="25Δ RR" color="#50d2c1" distribution={null} atmText="" spark={[]} />,
    );
    expect(screen.getByText(/insufficient/i)).toBeTruthy();
  });
});
