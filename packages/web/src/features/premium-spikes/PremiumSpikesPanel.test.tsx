import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PremiumSpikeResponse } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import PremiumSpikesPanel from './PremiumSpikesPanel';
const mocks = vi.hoisted(() => ({ query: vi.fn(), sound: vi.fn() }));
vi.mock('./queries', () => ({ usePremiumSpikes: mocks.query }));
vi.mock('@lib/audio', () => ({ playTradeCue: mocks.sound }));
const now = Date.parse('2026-11-20T18:00:00Z');
function report(): PremiumSpikeResponse {
  const sample = {
    observedAt: now,
    quoteAt: now,
    putIv: { bid: 0.65, ask: 0.67 },
    callIv: { bid: 0.5, ask: 0.52 },
    putSkew: { bid: 0.13, ask: 0.17 },
    callSkew: { bid: -0.17, ask: -0.13 },
  };
  return {
    underlying: 'BTC',
    venue: 'deribit',
    delta: 0.25,
    timeZone: 'America/Los_Angeles',
    sessionStartMs: Date.parse('2026-11-20T08:00:00Z'),
    sessionEndMs: Date.parse('2026-11-21T08:00:00Z'),
    monitorStartedAt: now - 60_000,
    lastScanAt: now,
    error: null,
    tenors: (['1M', '3M', '6M', '1Y'] as const).map((tenor, i) => ({
      tenor,
      targetDays: [30, 90, 180, 365][i]!,
      expiry: '2026-12-20',
      expiryTs: Date.parse('2026-12-20T08:00:00Z'),
      trackingSince: now - 60_000,
      sample,
      putHigh: sample.putSkew,
      callHigh: sample.callSkew,
    })),
    alerts: [
      {
        id: '1:2',
        timestamp: now,
        tenor: '1M',
        expiry: '2026-12-20',
        expiryTs: Date.parse('2026-12-20T08:00:00Z'),
        side: 'put',
        previousHigh: { bid: 0.08, ask: 0.12 },
        sample,
      },
      {
        id: '1:1',
        timestamp: now - 1000,
        tenor: '3M',
        expiry: '2026-12-20',
        expiryTs: Date.parse('2026-12-20T08:00:00Z'),
        side: 'call',
        previousHigh: { bid: -0.2, ask: -0.18 },
        sample,
      },
    ],
    alertCount: 2,
  };
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  useAppStore.setState((s) => ({
    activeMarketId: 'main',
    markets: { ...s.markets, main: { ...s.markets.main, underlying: 'BTC' } },
  }));
  mocks.query.mockReturnValue({ data: report(), isError: false, refetch: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Spike Premium Alerts', () => {
  it('shows four tenors, real expiry, Pacific reset, both sides and comparison highs', () => {
    render(<PremiumSpikesPanel />);
    expect(screen.getByRole('heading', { name: 'Spike Premium Alerts' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('10s samples');
    expect(screen.getByText(/midnight Pacific/).textContent).toContain('PST');
    const log = screen.getByRole('log');
    expect(log.textContent).toContain('13.00 / 17.00');
    expect(log.textContent).toContain('8.00 / 12.00');
    expect(log.textContent).toContain('2026-12-20');
    expect(mocks.query).toHaveBeenLastCalledWith('BTC', 'deribit');
    expect(mocks.sound).not.toHaveBeenCalled();
  });
  it('filters by tenor and side without changing the server monitor', () => {
    render(<PremiumSpikesPanel />);
    fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'put' } });
    expect(screen.getByRole('log').children).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Tenor'), { target: { value: '3M' } });
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.getByText('No alerts match these filters.')).toBeDefined();
    expect(mocks.query).toHaveBeenLastCalledWith('BTC', 'deribit');
  });
  it('hides stale current readings while retaining observed highs and past alerts', () => {
    const data = report();
    data.lastScanAt = now - 60_000;
    mocks.query.mockReturnValue({ data, isError: false });
    render(<PremiumSpikesPanel />);
    expect(screen.getByRole('status').textContent).toContain('fresh scan');
    expect(screen.getAllByText('— / —')).toHaveLength(8);
    expect(screen.getByRole('log').children).toHaveLength(2);
  });
  it('does not show yesterday’s highs or events after midnight while a response is delayed', () => {
    const data = report();
    data.sessionEndMs = now - 1;
    mocks.query.mockReturnValue({ data, isError: false });
    render(<PremiumSpikesPanel />);
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.getByText('No confirmed skew breakouts yet')).toBeDefined();
    expect(screen.getAllByText('Baseline not seeded')).toHaveLength(4);
  });
  it('allows an explicit supported asset when the workspace asset is unsupported', () => {
    useAppStore.setState((s) => ({
      markets: { ...s.markets, main: { ...s.markets.main, underlying: 'SOL' } },
    }));
    render(<PremiumSpikesPanel />);
    expect(screen.getByText(/Choose BTC or ETH/)).toBeDefined();
    expect(mocks.query).toHaveBeenLastCalledWith(null, 'deribit');
    fireEvent.change(screen.getByLabelText('Asset'), { target: { value: 'ETH' } });
    expect(mocks.query).toHaveBeenLastCalledWith('ETH', 'deribit');
  });
  it('sounds only for newly received matching alerts after enabling sound', () => {
    const data = report();
    mocks.query.mockReturnValue({ data, isError: false });
    const view = render(<PremiumSpikesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Sound/ }));
    mocks.sound.mockClear();
    const next = structuredClone(data);
    next.alertCount++;
    next.alerts.unshift({ ...next.alerts[0]!, id: '1:3' });
    mocks.query.mockReturnValue({ data: next, isError: false });
    view.rerender(<PremiumSpikesPanel />);
    expect(mocks.sound).toHaveBeenCalledTimes(1);
    view.rerender(<PremiumSpikesPanel />);
    expect(mocks.sound).toHaveBeenCalledTimes(1);
  });
});
