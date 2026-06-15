import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SkewHistory from './SkewHistory';

afterEach(cleanup);

vi.mock('@lib/token-meta', () => ({ getTokenLogo: () => null }));

const series30 = Array.from({ length: 6 }, (_, i) => ({
  ts: (i + 1) * 86_400_000,
  atmIv: 0.4,
  rr25d: -0.08 + i * 0.008,
  bfly25d: 0.01 + i * 0.001,
  rr10d: -0.12 + i * 0.01,
  bfly10d: 0.03 + i * 0.001,
}));

vi.mock('./queries', () => ({
  useIvHistory: () => ({
    data: {
      underlying: 'BTC',
      windowDays: 30,
      tenors: {
        '7d': { series: [], current: null, min: {}, max: {} },
        '30d': {
          series: series30,
          current: series30[series30.length - 1],
          rrPercentile: 56,
          flyPercentile: 60,
          min: {}, max: {},
        },
        '60d': { series: [], current: null, min: {}, max: {} },
        '90d': { series: [], current: null, min: {}, max: {} },
      },
    },
  }),
}));

describe('SkewHistory', () => {
  it('renders density strips, smile, and controls; no MODE toggle', () => {
    render(<SkewHistory underlying="BTC" />);
    expect(screen.getByText('BTC SKEW')).toBeTruthy();
    expect(screen.getByRole('button', { name: '7d ago' })).toBeTruthy();
    // 90d appears in both TENOR and WINDOW groups — both must be present
    expect(screen.getAllByRole('button', { name: '90d' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Normalized' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Z-Score' })).toBeNull();
    expect(screen.getByText('25Δ RR')).toBeTruthy();
    expect(screen.getByText('25Δ Fly')).toBeTruthy();
    expect(screen.getByText(/56th/)).toBeTruthy();
    expect(screen.getByText('10Δp')).toBeTruthy();
    expect(screen.getByText('ATM')).toBeTruthy();
  });

  it('switches the VS reference label on the smile caption', () => {
    render(<SkewHistory underlying="BTC" />);
    expect(screen.getByText(/faded = 7d ago/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByText(/faded = open/)).toBeTruthy();
  });
});
