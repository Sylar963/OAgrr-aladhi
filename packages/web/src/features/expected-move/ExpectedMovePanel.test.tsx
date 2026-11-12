import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpectedMovePanel from './ExpectedMovePanel';
import { DEFAULT_SETTINGS, useExpectedMoveSettings } from './settings';
import { radarCandles, radarQuote, radarReport, TEST_NOW, TEST_START } from './test-fixtures';

const hooks = vi.hoisted(() => ({
  daily: vi.fn(),
  expiries: vi.fn(),
  straddle: vi.fn(),
  path: vi.fn(),
}));
vi.mock('./queries', () => ({
  useExpectedMove: hooks.daily,
  useExpectedMoveExpiries: hooks.expiries,
  useExpectedStraddle: hooks.straddle,
  useRadarPath: hooks.path,
}));

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  useExpectedMoveSettings.setState({ panels: {} });
  useAppStore.setState((s) => ({
    activeMarketId: 'main',
    activeTab: 'chain',
    markets: { ...s.markets, main: { ...s.markets.main, underlying: 'BTC' } },
  }));
  hooks.daily.mockReturnValue({
    data: radarReport(),
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  });
  hooks.expiries.mockReturnValue({ data: ['2026-11-12'], isError: false, isPending: false });
  hooks.straddle.mockReturnValue({ data: radarQuote(), isError: false, isPending: false });
  hooks.path.mockReturnValue({
    data: { candles: radarCandles(), resolutionMs: 300000, asOfMs: TEST_NOW },
    isError: false,
    isPending: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Expected Move Radar', () => {
  it('replaces the metric rail with an interactive cone, daily ratio and elapsed-time pace', () => {
    render(<ExpectedMovePanel />);
    expect(
      screen.getByRole('img', { name: 'Expected move cone and observed spot path' }),
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Expected Move Radar' })).toBeDefined();
    expect(screen.getByText('Movement pace')).toBeDefined();
    expect(screen.getByText('1.62×')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('1×');
    expect(hooks.straddle).toHaveBeenLastCalledWith('BTC', 'deribit', '2026-11-12', false);
  });

  it('persists chart toggles and units per workspace without changing old defaults', () => {
    render(<ExpectedMovePanel />);
    fireEvent.click(screen.getByRole('button', { name: '2σ band' }));
    fireEvent.change(screen.getByLabelText('Chart unit'), { target: { value: 'sigma' } });
    expect(useExpectedMoveSettings.getState().panels['builtin-chain']?.showTwoSigma).toBe(true);
    expect(useExpectedMoveSettings.getState().panels['builtin-chain']?.chartUnit).toBe('sigma');
    expect(DEFAULT_SETTINGS.showStraddle).toBe(false);
    expect(localStorage.getItem('ogg.expectedMovePanels.v1')).toContain('sigma');
  });

  it('keeps expiry breakevens separate from the daily cone', () => {
    render(<ExpectedMovePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'ATM straddle' }));
    expect(screen.getByText('+8.30%')).toBeDefined();
    expect(screen.queryByText(/^Buy breakeven/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show expiry levels →' }));
    expect(screen.getByText(/^Buy breakeven/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'To expiry' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('hides current quotes and live IV when rewinding, then restores the latest view', () => {
    render(<ExpectedMovePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'ATM straddle' }));
    fireEvent.click(screen.getByRole('button', { name: 'To expiry' }));
    fireEvent.change(screen.getByLabelText('Replay position'), { target: { value: '10' } });
    expect(screen.queryByText('+8.30%')).toBeNull();
    expect(screen.getByText(/Historical option books are not recorded/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    expect(
      (screen.getByRole('button', { name: 'Live reforecast' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(hooks.straddle).toHaveBeenLastCalledWith('BTC', 'deribit', '2026-11-12', false);
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(screen.getByText('+8.30%')).toBeDefined();
  });

  it('replays selected completed sessions without applying today’s quote', () => {
    const report = radarReport();
    report.history = [
      {
        ...report.current!,
        startMs: TEST_START - 86400000,
        endMs: TEST_START,
        priceAsOfMs: TEST_START,
        complete: true,
        classification: 'large',
      },
    ];
    hooks.daily.mockReturnValue({
      data: report,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    render(<ExpectedMovePanel />);
    fireEvent.click(screen.getByRole('button', { name: /11-10/ }));
    expect(screen.getByText(/Historical option books are not recorded/)).toBeDefined();
    expect(hooks.straddle).toHaveBeenLastCalledWith('BTC', 'deribit', '2026-11-12', false);
  });

  it('suppresses alerts for partial coverage and stale cached quotes', () => {
    const report = radarReport();
    report.current!.coverage = 'partial';
    hooks.daily.mockReturnValue({
      data: report,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    hooks.straddle.mockReturnValue({
      data: { ...radarQuote(), quoteAsOfMs: TEST_NOW - 100000 },
      isError: false,
      isPending: false,
    });
    render(<ExpectedMovePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'ATM straddle' }));
    expect(screen.queryByText(/Absolute return has crossed/)).toBeNull();
    expect(screen.getByText(/No fresh two-sided ATM pair/)).toBeDefined();
    expect(screen.queryByText('+8.30%')).toBeNull();
  });

  it('keeps unsupported assets explicit and validates numeric settings on blur', () => {
    const view = render(<ExpectedMovePanel />);
    const input = screen.getByLabelText('Move alert (×)');
    fireEvent.change(input, { target: { value: '0.5' } });
    fireEvent.blur(input);
    expect(useExpectedMoveSettings.getState().panels['builtin-chain']?.moveAlertRatio).toBe(0.5);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('0.5');
    useAppStore.setState((s) => ({
      markets: { ...s.markets, main: { ...s.markets.main, underlying: 'SOL' } },
    }));
    view.rerender(<ExpectedMovePanel />);
    expect(hooks.daily).toHaveBeenLastCalledWith(null, 'utc0', 14);
    expect(screen.getByText(/No volatility-index benchmark is available/)).toBeDefined();
  });

  it('keeps a paused observation fixed when a refetch fills earlier candle gaps', () => {
    hooks.path.mockReturnValue({
      data: {
        candles: radarCandles().filter((_, i) => i !== 20 && i !== 22),
        resolutionMs: 300000,
        asOfMs: TEST_NOW,
      },
      isError: false,
      isPending: false,
    });
    const view = render(<ExpectedMovePanel />);
    const slider = screen.getByLabelText('Replay position');
    fireEvent.change(slider, { target: { value: '30' } });
    const selectedTime = () => slider.parentElement?.querySelector('span')?.textContent;
    const before = selectedTime();
    hooks.path.mockReturnValue({
      data: { candles: radarCandles(), resolutionMs: 300000, asOfMs: TEST_NOW },
      isError: false,
      isPending: false,
    });
    view.rerender(<ExpectedMovePanel />);
    expect(selectedTime()).toBe(before);
  });

  it('keeps an inspected observation fixed when earlier candles arrive', () => {
    hooks.path.mockReturnValue({
      data: {
        candles: radarCandles().filter((_, i) => i !== 20 && i !== 22),
        resolutionMs: 300000,
        asOfMs: TEST_NOW,
      },
      isError: false,
      isPending: false,
    });
    const view = render(<ExpectedMovePanel />);
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowLeft' });
    const before = screen.getByText(/Selected observation/).textContent;
    hooks.path.mockReturnValue({
      data: { candles: radarCandles(), resolutionMs: 300000, asOfMs: TEST_NOW },
      isError: false,
      isPending: false,
    });
    view.rerender(<ExpectedMovePanel />);
    expect(screen.getByText(/Selected observation/).textContent).toBe(before);
  });

  it('does not render infinite sigma labels for wide long-dated cones', () => {
    useExpectedMoveSettings
      .getState()
      .update('builtin-chain', { horizon: 'expiry', chartUnit: 'sigma', showTwoSigma: true });
    hooks.expiries.mockReturnValue({ data: ['2027-11-11'], isError: false, isPending: false });
    hooks.straddle.mockReturnValue({
      data: {
        ...radarQuote(),
        expiry: '2027-11-11',
        expiryTs: TEST_NOW + 365 * 86400000,
        surfaceIv: 1,
      },
      isError: false,
      isPending: false,
    });
    render(<ExpectedMovePanel />);
    expect(screen.getByRole('img').textContent).not.toMatch(/Infinity|NaN/);
  });

  it('distinguishes downward band crossings from upward crossings', () => {
    const report = radarReport();
    report.current!.last = 96000;
    report.current!.low = 95000;
    hooks.daily.mockReturnValue({
      data: report,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    hooks.path.mockReturnValue({
      data: {
        candles: [{ timestamp: TEST_NOW - 600000, open: 100000, close: 100000 }],
        resolutionMs: 300000,
        asOfMs: TEST_NOW,
      },
      isError: false,
      isPending: false,
    });
    render(<ExpectedMovePanel />);
    expect(screen.getByRole('button', { name: /Crossed 1σ/ }).textContent).toContain('↘');
  });

  it('returns to the current session when a shorter lookback removes the replayed day', () => {
    const report = radarReport();
    report.history = [
      {
        ...report.current!,
        startMs: TEST_START - 86400000,
        endMs: TEST_START,
        priceAsOfMs: TEST_START,
        complete: true,
        classification: 'small',
      },
    ];
    hooks.daily.mockReturnValue({
      data: report,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    const view = render(<ExpectedMovePanel />);
    fireEvent.click(screen.getByRole('button', { name: /11-10/ }));
    hooks.daily.mockReturnValue({
      data: radarReport(),
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    view.rerender(<ExpectedMovePanel />);
    expect(screen.getByRole('img')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /Current session/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
