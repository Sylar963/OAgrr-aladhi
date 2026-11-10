import type { ExpectedMoveResponse } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpectedMovePanel from './ExpectedMovePanel';
import { DEFAULT_SETTINGS, useExpectedMoveSettings } from './settings';

const hooks = vi.hoisted(() => ({ daily: vi.fn(), expiries: vi.fn(), straddle: vi.fn() }));
vi.mock('./queries', () => ({
  useExpectedMove: hooks.daily,
  useExpectedMoveExpiries: hooks.expiries,
  useExpectedStraddle: hooks.straddle,
}));

function report(): ExpectedMoveResponse {
  const start = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  return {
    underlying: 'BTC',
    anchor: 'utc0',
    generatedAt: Date.now(),
    periodsPerYear: 365,
    index: 'DVOL',
    priceSource: 'aggregated-spot',
    liveIv: 0.7,
    liveIvAsOfMs: Date.now(),
    current: {
      startMs: start,
      endMs: start + 86_400_000,
      open: 100_000,
      last: 103_000,
      high: 104_000,
      low: 99_000,
      priceAsOfMs: Date.now(),
      openingIv: 0.5,
      ivAsOfMs: start,
      expectedFraction: 0.02617,
      expectedUsd: 2617,
      approximateStraddleUsd: 2088,
      lower: 97383,
      upper: 102617,
      returnFraction: 0.03,
      absoluteReturnFraction: 0.03,
      rangeFraction: 0.05,
      moveRatio: 1.15,
      complete: false,
      coverage: 'complete',
      classification: 'in-progress',
    },
    history: [],
  };
}

beforeEach(() => {
  useExpectedMoveSettings.setState({ panels: {} });
  useAppStore.setState({ activeMarketId: 'main', activeTab: 'chain' });
  useAppStore.setState((s) => ({
    markets: { ...s.markets, main: { ...s.markets.main, underlying: 'BTC' } },
  }));
  hooks.daily.mockReturnValue({
    data: report(),
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  });
  hooks.expiries.mockReturnValue({ data: ['2026-11-12'], isError: false, isPending: false });
  hooks.straddle.mockReturnValue({ data: undefined, isError: false, isPending: false });
});
afterEach(cleanup);

describe('Expected Move panel', () => {
  it('shows opening and live benchmarks separately and alerts against the opening value', () => {
    render(<ExpectedMovePanel />);
    expect(screen.getByText('±2.62%')).toBeDefined();
    expect(screen.getByText('±3.66%')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('1×');
    expect(screen.getByText('High–low range: 5.00%')).toBeDefined();
  });

  it('suppresses move alerts for failed refreshes and partial observations', () => {
    hooks.daily.mockReturnValue({
      data: report(),
      isError: true,
      isPending: false,
      refetch: vi.fn(),
    });
    const view = render(<ExpectedMovePanel />);
    expect(screen.queryByText(/Absolute return has crossed/)).toBeNull();
    const partial = report();
    partial.current!.coverage = 'partial';
    hooks.daily.mockReturnValue({
      data: partial,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    view.rerender(<ExpectedMovePanel />);
    expect(screen.queryByText(/Absolute return has crossed/)).toBeNull();
    expect(screen.getByText(/Partial or stale price coverage/)).toBeDefined();
  });

  it('persists panel settings per workspace and does not silently use BTC for unsupported assets', async () => {
    render(<ExpectedMovePanel />);
    fireEvent.change(screen.getByLabelText('Asset'), { target: { value: 'SPX' } });
    expect(useExpectedMoveSettings.getState().panels['builtin-chain']?.asset).toBe('SPX');
    expect(hooks.daily).toHaveBeenLastCalledWith('SPX', 'cash', 14);
    fireEvent.click(screen.getByText('ATM straddle'));
    await waitFor(() =>
      expect(useExpectedMoveSettings.getState().panels['builtin-chain']?.showStraddle).toBe(true),
    );
    expect(localStorage.getItem('ogg.expectedMovePanels.v1')).toContain('SPX');
    expect(DEFAULT_SETTINGS.showStraddle).toBe(false);
  });

  it('gates ATM pricing on fresh quotes even when a cached response says available', () => {
    hooks.straddle.mockReturnValue({
      data: { status: 'available', quoteAsOfMs: Date.now() - 100_000 },
      isError: false,
      isPending: false,
    });
    render(<ExpectedMovePanel />);
    expect(screen.queryByText('Buy at asks')).toBeNull();
    expect(screen.getByText(/No fresh two-sided ATM pair/)).toBeDefined();
  });

  it('does not silently substitute BTC for an unsupported workspace asset', () => {
    useAppStore.setState((s) => ({
      markets: { ...s.markets, main: { ...s.markets.main, underlying: 'SOL' } },
    }));
    render(<ExpectedMovePanel />);
    expect(hooks.daily).toHaveBeenLastCalledWith(null, 'utc0', 14);
    expect(screen.getByText(/No volatility-index benchmark is available/)).toBeDefined();
  });

  it('allows decimal threshold editing and discards invalid drafts on blur', () => {
    render(<ExpectedMovePanel />);
    const input = screen.getByLabelText('Move alert (×)');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.change(input, { target: { value: '0.5' } });
    fireEvent.blur(input);
    expect(useExpectedMoveSettings.getState().panels['builtin-chain']?.moveAlertRatio).toBe(0.5);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('0.5');
  });
});
