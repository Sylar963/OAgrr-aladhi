import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PremiumSpikeResponse } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import PremiumSpikesPanel from './PremiumSpikesPanel';
const mocks = vi.hoisted(() => ({ query: vi.fn(), sound: vi.fn() }));
vi.mock('./queries', () => ({ usePremiumSpikes: mocks.query }));
vi.mock('@lib/audio', async (original) => ({
  ...(await original<typeof import('@lib/audio')>()),
  playTradeCue: mocks.sound,
}));
const now = Date.parse('2026-11-20T18:00:00Z');
function report(): PremiumSpikeResponse {
  const sample = {
    observedAt: now,
    quoteAt: now,
    putIv: { bid: 0.65, ask: 0.67 },
    callIv: { bid: 0.5, ask: 0.52 },
    putSkew: { bid: 0.13, ask: 0.17 },
    callSkew: { bid: -0.17, ask: -0.13 },
    money: {
      referencePriceUsd: 100000,
      putPremiumUsdPerBase: { bid: 2500, ask: 2700 },
      callPremiumUsdPerBase: { bid: 1500, ask: 1700 },
    },
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
    soundEnabled: false,
    markets: { ...s.markets, main: { ...s.markets.main, underlying: 'BTC' } },
  }));
  localStorage.removeItem('tapeSoundEnabled');
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
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sounds' }));
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

describe('Flow sound and USD quote context', () => {
  it('uses the shared Flow mute preference and persisted speaker control', () => {
    const view = render(<PremiumSpikesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sounds' }));
    expect(useAppStore.getState().soundEnabled).toBe(true);
    expect(localStorage.getItem('tapeSoundEnabled')).toBe('1');
    view.unmount();
    render(<PremiumSpikesPanel />);
    expect(screen.getByRole('button', { name: 'Mute alert sounds' }).textContent).toContain('🔊');
    fireEvent.click(screen.getByRole('button', { name: 'Mute alert sounds' }));
    expect(useAppStore.getState().soundEnabled).toBe(false);
    expect(localStorage.getItem('tapeSoundEnabled')).toBeNull();
  });
  it('shows premiums and underlying notional for the selected base size without changing skew or replaying sounds', () => {
    render(<PremiumSpikesPanel />);
    const log = screen.getByRole('log');
    expect(log.textContent).toContain('$100,000.00');
    expect(log.textContent).toContain('$2,500.00 / $2,700.00');
    expect(log.textContent).toContain('$1,500.00 / $1,700.00');
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sounds' }));
    mocks.sound.mockClear();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quote size' }), {
      target: { value: '2' },
    });
    expect(log.textContent).toContain('$200,000.00');
    expect(log.textContent).toContain('$5,000.00 / $5,400.00');
    expect(log.textContent).toContain('13.00 / 17.00');
    expect(mocks.sound).not.toHaveBeenCalled();
  });
  it('does not backfill historical quote amounts using current prices', () => {
    const data = report();
    data.alerts[0]!.sample = { ...data.alerts[0]!.sample, money: null };
    mocks.query.mockReturnValue({ data, isError: false });
    render(<PremiumSpikesPanel />);
    const oldEvent = screen.getByRole('log').children[0]!;
    expect(oldEvent.textContent).not.toContain('$');
    expect(oldEvent.textContent).toContain('13.00 / 17.00');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quote size' }), {
      target: { value: '' },
    });
    expect(screen.getByRole('alert').textContent).toContain('greater than 0');
    expect(screen.getByRole('log').textContent).not.toContain('$');
  });
  it('uses Flow size tiers, caps a burst at three cues, and never sounds muted or filtered-out records', () => {
    const data = report();
    mocks.query.mockReturnValue({ data, isError: false });
    const view = render(<PremiumSpikesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sounds' }));
    mocks.sound.mockClear();
    const next = structuredClone(data);
    next.alertCount += 5;
    next.alerts.unshift(
      ...Array.from({ length: 5 }, (_, i) => ({ ...next.alerts[0]!, id: `1:${i + 3}` })),
    );
    mocks.query.mockReturnValue({ data: next, isError: false });
    view.rerender(<PremiumSpikesPanel />);
    expect(mocks.sound).toHaveBeenCalledTimes(3);
    expect(mocks.sound).toHaveBeenCalledWith('sell', 'whale');
    mocks.sound.mockClear();
    fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'call' } });
    const unmatched = structuredClone(next);
    unmatched.alertCount++;
    unmatched.alerts.unshift({ ...next.alerts[0]!, id: '1:8' });
    mocks.query.mockReturnValue({ data: unmatched, isError: false });
    view.rerender(<PremiumSpikesPanel />);
    expect(mocks.sound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mute alert sounds' }));
    const muted = structuredClone(unmatched);
    muted.alertCount++;
    muted.alerts.unshift({ ...next.alerts[0]!, side: 'call', id: '1:9' });
    mocks.query.mockReturnValue({ data: muted, isError: false });
    view.rerender(<PremiumSpikesPanel />);
    expect(mocks.sound).not.toHaveBeenCalled();
  });
  it('still sounds a basic cue for small notionals', () => {
    const data = report();
    data.alerts.forEach((a) => {
      a.sample = { ...a.sample, money: { ...a.sample.money!, referencePriceUsd: 2000 } };
    });
    mocks.query.mockReturnValue({ data, isError: false });
    const view = render(<PremiumSpikesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sounds' }));
    mocks.sound.mockClear();
    const next = structuredClone(data);
    next.alertCount++;
    next.alerts.unshift({ ...next.alerts[0]!, id: '1:3' });
    mocks.query.mockReturnValue({ data: next, isError: false });
    view.rerender(<PremiumSpikesPanel />);
    expect(mocks.sound).toHaveBeenCalledWith('sell', 'shark');
  });
});
