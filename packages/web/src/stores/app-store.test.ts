import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';

describe('app-store', () => {
  beforeEach(() => {
    useAppStore.setState({
      underlying: 'BTC',
      expiry: '',
      activeTab: 'chain',
      myIv: '',
    });
  });

  it('setUnderlying clears expiry to prevent invalid pairs', () => {
    useAppStore.getState().setExpiry('2026-03-21');
    expect(useAppStore.getState().expiry).toBe('2026-03-21');

    useAppStore.getState().setUnderlying('ETH');

    expect(useAppStore.getState().underlying).toBe('ETH');
    expect(useAppStore.getState().expiry).toBe('');
  });

  it('setExpiry does not change underlying', () => {
    useAppStore.getState().setExpiry('2026-03-28');

    expect(useAppStore.getState().underlying).toBe('BTC');
    expect(useAppStore.getState().expiry).toBe('2026-03-28');
  });

  it('toggleVenue removes active venue', () => {
    const initial = useAppStore.getState().activeVenues;
    expect(initial).toContain('deribit');

    useAppStore.getState().toggleVenue('deribit');

    expect(useAppStore.getState().activeVenues).not.toContain('deribit');
  });

  it('toggleVenue prevents removing last venue', () => {
    const state = useAppStore.getState();
    const venues = [...state.activeVenues];
    for (const v of venues.slice(1)) {
      useAppStore.getState().toggleVenue(v);
    }

    const remaining = useAppStore.getState().activeVenues;
    expect(remaining).toHaveLength(1);

    useAppStore.getState().toggleVenue(remaining[0]!);
    expect(useAppStore.getState().activeVenues).toHaveLength(1);
  });

  it('changing underlying then setting expiry produces valid pair', () => {
    useAppStore.getState().setUnderlying('SOL');
    expect(useAppStore.getState().expiry).toBe('');

    useAppStore.getState().setExpiry('2026-04-10');

    expect(useAppStore.getState().underlying).toBe('SOL');
    expect(useAppStore.getState().expiry).toBe('2026-04-10');
  });
});

describe('activeContext slice', () => {
  afterEach(() => {
    localStorage.clear();
    useAppStore.setState({ activeContext: { kind: 'paper' } });
  });

  it('defaults to paper context', () => {
    expect(useAppStore.getState().activeContext).toEqual({ kind: 'paper' });
  });

  it('setActiveContext persists to localStorage and updates state', () => {
    useAppStore.getState().setActiveContext({ kind: 'challenge', runId: 'run_1' });
    expect(useAppStore.getState().activeContext).toEqual({ kind: 'challenge', runId: 'run_1' });
    expect(localStorage.getItem('activeContext')).toBe(
      JSON.stringify({ kind: 'challenge', runId: 'run_1' }),
    );
  });

  it('setActiveContext can switch to thalex', () => {
    useAppStore.getState().setActiveContext({ kind: 'thalex' });
    expect(useAppStore.getState().activeContext).toEqual({ kind: 'thalex' });
  });
});

describe('system notification slices', () => {
  beforeEach(() => {
    useAppStore.setState({ announcement: null, feedDegraded: false, toasts: [] });
  });

  it('sets and clears the announcement', () => {
    useAppStore
      .getState()
      .setAnnouncement({ id: 'm1', severity: 'info', blocking: false, title: 'Hi' });
    expect(useAppStore.getState().announcement).toMatchObject({ id: 'm1' });
    useAppStore.getState().setAnnouncement(null);
    expect(useAppStore.getState().announcement).toBeNull();
  });

  it('toggles feedDegraded', () => {
    useAppStore.getState().setFeedDegraded(true);
    expect(useAppStore.getState().feedDegraded).toBe(true);
    useAppStore.getState().setFeedDegraded(false);
    expect(useAppStore.getState().feedDegraded).toBe(false);
  });

  it('pushes and dismisses toasts', () => {
    useAppStore.getState().pushToast({ tone: 'success', icon: '✓', text: 'Feed restored' });
    const toasts = useAppStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: 'success', text: 'Feed restored' });
    useAppStore.getState().dismissToast(toasts[0]!.id);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });
});

it('toggles assetMode and tracks tradfi underlying/expiry', () => {
  const s = useAppStore.getState();
  expect(s.assetMode).toBe('crypto');
  s.setAssetMode('tradfi');
  expect(useAppStore.getState().assetMode).toBe('tradfi');
  useAppStore.getState().setTradfiUnderlying('AAPL');
  expect(useAppStore.getState().tradfiUnderlying).toBe('AAPL');
  expect(useAppStore.getState().tradfiExpiry).toBe(''); // reset on underlying change
  useAppStore.getState().setTradfiExpiry('2026-06-17');
  expect(useAppStore.getState().tradfiExpiry).toBe('2026-06-17');
});

it('tradfiPage defaults to chain and can switch to gex', () => {
  expect(useAppStore.getState().tradfiPage).toBe('chain');
  useAppStore.getState().setTradfiPage('gex');
  expect(useAppStore.getState().tradfiPage).toBe('gex');
  useAppStore.getState().setTradfiPage('chain'); // reset for other tests
});
