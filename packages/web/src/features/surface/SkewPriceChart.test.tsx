import type { IvHistoryPoint } from '@shared/enriched';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  candles: [] as { timestamp: number; close: number }[],
  error: false,
  refetch: vi.fn(),
}));
vi.mock('./queries', () => ({
  useSkewSpotHistory: () => ({
    data: { candles: state.candles },
    isError: state.error,
    isLoading: false,
    refetch: state.refetch,
  }),
}));

import SkewPriceChart from './SkewPriceChart';

afterEach(() => {
  cleanup();
  state.candles = [];
  state.error = false;
  state.refetch.mockReset();
});

const point = (ts: number): IvHistoryPoint => ({
  ts,
  atmIv: 0.5,
  rr25d: -0.02,
  bfly25d: 0.01,
  rr10d: null,
  bfly10d: null,
});

describe('SkewPriceChart', () => {
  it('labels both axes and excludes a still-forming hourly spot close', () => {
    const hour = Math.floor(Date.now() / 3600_000) * 3600_000;
    state.candles = [
      { timestamp: hour - 3600_000, close: 60_000 },
      { timestamp: hour, close: 99_999 },
    ];
    render(
      <SkewPriceChart
        underlying="BTC"
        tenor="30d"
        window="30d"
        series={[point(hour - 3600_000), point(hour)]}
        loading={false}
        failed={false}
        retry={() => {}}
      />,
    );
    expect(screen.getByRole('img', { name: 'BTC 25Δ skew and spot price' })).toBeTruthy();
    expect(screen.getByText('30d 25Δ RR · vol pts · left axis')).toBeTruthy();
    expect(screen.getByText('BTC spot · USD · right axis')).toBeTruthy();
    expect(screen.getByText(/\$60,000 ·/)).toBeTruthy();
    expect(screen.queryByText(/99,999/)).toBeNull();
    expect(screen.getByText(/price is overlaid, skew is unadjusted/)).toBeTruthy();
  });

  it('keeps the skew chart when the price request fails and offers a retry', () => {
    state.error = true;
    const now = Date.now();
    render(
      <SkewPriceChart
        underlying="ETH"
        tenor="7d"
        window="30d"
        series={[point(now - 3600_000), point(now)]}
        loading={false}
        failed={false}
        retry={() => {}}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('spot price history failed');
    expect(screen.getByText(/RR -2.00 vp/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
