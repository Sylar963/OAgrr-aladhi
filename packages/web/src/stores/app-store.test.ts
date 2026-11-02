import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectActiveMarket, useAppStore, useMarket } from './app-store';
import { setTestMarket } from '@/test/market-state';

describe('app-store', () => {
  beforeEach(() => {
    setTestMarket({ underlying: 'BTC', expiry: '', myIv: '' });
    useAppStore.setState({ activeTab: 'chain' });
  });

  it('setUnderlying clears expiry to prevent invalid pairs', () => {
    useAppStore.getState().setExpiry('2026-03-21');
    expect(selectActiveMarket(useAppStore.getState()).expiry).toBe('2026-03-21');

    useAppStore.getState().setUnderlying('ETH');

    expect(selectActiveMarket(useAppStore.getState()).underlying).toBe('ETH');
    expect(selectActiveMarket(useAppStore.getState()).expiry).toBe('');
  });

  it('setExpiry does not change underlying', () => {
    useAppStore.getState().setExpiry('2026-03-28');

    expect(selectActiveMarket(useAppStore.getState()).underlying).toBe('BTC');
    expect(selectActiveMarket(useAppStore.getState()).expiry).toBe('2026-03-28');
  });

  it('toggleVenue removes active venue', () => {
    const initial = selectActiveMarket(useAppStore.getState()).activeVenues;
    expect(initial).toContain('deribit');

    useAppStore.getState().toggleVenue('deribit');

    expect(selectActiveMarket(useAppStore.getState()).activeVenues).not.toContain('deribit');
  });

  it('toggleVenue prevents removing last venue', () => {
    const state = useAppStore.getState();
    const venues = [...selectActiveMarket(state).activeVenues];
    for (const v of venues.slice(1)) {
      useAppStore.getState().toggleVenue(v);
    }

    const remaining = selectActiveMarket(useAppStore.getState()).activeVenues;
    expect(remaining).toHaveLength(1);

    useAppStore.getState().toggleVenue(remaining[0]!);
    expect(selectActiveMarket(useAppStore.getState()).activeVenues).toHaveLength(1);
  });

  it('changing underlying then setting expiry produces valid pair', () => {
    useAppStore.getState().setUnderlying('SOL');
    expect(selectActiveMarket(useAppStore.getState()).expiry).toBe('');

    useAppStore.getState().setExpiry('2026-04-10');

    expect(selectActiveMarket(useAppStore.getState()).underlying).toBe('SOL');
    expect(selectActiveMarket(useAppStore.getState()).expiry).toBe('2026-04-10');
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

describe('tradfi state slice', () => {
  afterEach(() => {
    useAppStore.setState({
      assetMode: 'crypto',
      tradfiUnderlying: '',
      tradfiExpiry: '',
      tradfiPage: 'chain',
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

  it('tradfiPage defaults to chain and can switch pages', () => {
    expect(useAppStore.getState().tradfiPage).toBe('chain');
    useAppStore.getState().setTradfiPage('builder');
    expect(useAppStore.getState().tradfiPage).toBe('builder');
    useAppStore.getState().setTradfiPage('gex');
    expect(useAppStore.getState().tradfiPage).toBe('gex');
  });
});

describe('navigateToWidget', () => {
  beforeEach(() => {
    setTestMarket({ underlying: 'BTC', expiry: '2026-03-21' });
    useAppStore.setState({ activeTab: 'alpha' });
  });

  it('jumps without touching the market when no target is given', () => {
    useAppStore.getState().navigateToWidget('architect');

    const state = useAppStore.getState();
    expect(state.activeTab).toBe('architect');
    expect(selectActiveMarket(state).underlying).toBe('BTC');
    expect(selectActiveMarket(state).expiry).toBe('2026-03-21');
  });

  it('carries the expiry with the jump', () => {
    useAppStore.getState().navigateToWidget('architect', { expiry: '2026-04-24' });

    const state = useAppStore.getState();
    expect(state.activeTab).toBe('architect');
    expect(selectActiveMarket(state).expiry).toBe('2026-04-24');
  });

  it('clears the expiry when the ticker changes without one', () => {
    useAppStore.getState().navigateToWidget('chain', { underlying: 'ETH' });

    const market = selectActiveMarket(useAppStore.getState());
    expect(market.underlying).toBe('ETH');
    expect(market.expiry).toBe('');
  });

  it('applies a ticker and expiry together', () => {
    useAppStore.getState().navigateToWidget('architect', {
      underlying: 'SOL',
      expiry: '2026-05-29',
    });

    const market = selectActiveMarket(useAppStore.getState());
    expect(market.underlying).toBe('SOL');
    expect(market.expiry).toBe('2026-05-29');
  });
});

describe('useMarket', () => {
  afterEach(cleanup);

  it('does not re-render a ticker reader when another market field changes', () => {
    setTestMarket({ underlying: 'BTC', myIv: '' });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useMarket((m) => m.underlying);
    });
    const before = renders;

    act(() => useAppStore.getState().setMyIv('55'));
    expect(renders).toBe(before);

    act(() => useAppStore.getState().setUnderlying('ETH'));
    expect(result.current).toBe('ETH');
    expect(renders).toBe(before + 1);
  });
});
