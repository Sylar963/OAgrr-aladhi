import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SkewHistory from './SkewHistory';

afterEach(cleanup);

vi.mock('@lib/token-meta', () => ({ getTokenLogo: () => null }));

const series30 = Array.from({ length: 8 }, (_, i) => ({
  ts: (i + 1) * 86_400_000,
  atmIv: 0.4,
  rr25d: -0.08 + i * 0.008,
  bfly25d: 0.01 + i * 0.001,
  rr10d: -0.12 + i * 0.01,
  bfly10d: 0.03 + i * 0.001,
}));

function flowData() {
  const now = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const start = now - 12 * 86_400;
  const buckets = [];
  for (let ts = start, i = 0; ts < now; ts += 3600, i++) {
    const spike = ts >= now - 8 * 3600;
    const calls = spike ? 120 : 10 + (i % 2 === 0 ? 2 : -2);
    buckets.push({
      ts,
      callCount: 1,
      putCount: 1,
      callContracts: calls,
      putContracts: 10,
      callNotionalUsd: calls * 80_000,
      putNotionalUsd: 800_000,
      callPremiumUsd: calls * 1_000,
      putPremiumUsd: 10_000,
    });
  }
  return { available: true, underlying: 'BTC', resolution: 3600, start, end: now, buckets };
}

vi.mock('./queries', () => ({
  CALL_PUT_FLOW_RESOLUTION_SEC: 3600,
  useCallPutFlow: () => ({
    data: flowData(),
    isLoading: false,
    isPlaceholderData: false,
    isError: false,
  }),
  useIvHistory: () => ({
    data: {
      underlying: 'BTC',
      windowDays: 30,
      tenors: {
        '7d': {
          series: [],
          current: { ...series30[0], rr25d: -0.031 },
          rrPercentile: 12,
          flyPercentile: 40,
          min: {}, max: {},
        },
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
  it('renders timelines, tenor strip, smile, and controls', () => {
    render(<SkewHistory underlying="BTC" />);
    expect(screen.getByText('BTC SKEW')).toBeTruthy();
    for (const name of ['1d ago', '7d ago', '30d ago', '1M', '3M', '90d']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'open' })).toBeNull();
    expect(screen.getByText('25Δ RR')).toBeTruthy();
    expect(screen.getByText('25Δ Fly')).toBeTruthy();
    expect(screen.getByText('56th pct')).toBeTruthy();
    expect(screen.getByText('60th pct')).toBeTruthy();
    expect(screen.getByText('-3.1 · 12th')).toBeTruthy();
    expect(screen.getByText('puts bid ↓')).toBeTruthy();
    expect(screen.getByText('10Δp')).toBeTruthy();
    expect(screen.getByText('ATM')).toBeTruthy();
    expect(screen.getByText(/Puts over calls by 2.4vp/)).toBeTruthy();
  });

  it('switches the VS reference on the smile caption and timeline delta', () => {
    render(<SkewHistory underlying="BTC" />);
    expect(screen.getByText(/dashed = 7d ago/)).toBeTruthy();
    expect(screen.getAllByText(/Δ 7d ago/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '1d ago' }));
    expect(screen.getByText(/dashed = 1d ago/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '30d ago' }));
    expect(screen.getByText(/no history for 30d ago/)).toBeTruthy();
  });

  it('switches to the v2 regime model with flow sources', () => {
    render(<SkewHistory underlying="BTC" />);
    fireEvent.click(screen.getByRole('button', { name: 'v2' }));

    expect(screen.getByText('REGIME')).toBeTruthy();
    expect(screen.queryByText('25Δ Fly')).toBeNull();
    expect(screen.queryByRole('button', { name: '7d ago' })).toBeNull();
    for (const name of [
      'Contracts',
      'Notional',
      'Premium',
      'RR',
      '1d zone window',
      '7d zone window',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getAllByText('Risk-on').length).toBeGreaterThan(1);
    expect(screen.getByText(/broke above the upper zone/)).toBeTruthy();
    expect(screen.getAllByText(/ BTC$/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Notional' }));
    expect(screen.getAllByText(/^\+\$\d/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/ BTC$/)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'v1' }));
    expect(screen.getByText('25Δ Fly')).toBeTruthy();
  });
});
