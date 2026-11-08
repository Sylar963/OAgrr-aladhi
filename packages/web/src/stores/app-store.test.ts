import {
  MAX_CUSTOM_TABS,
  MAX_WIDGETS_PER_TAB,
  readCustomTabs,
  writeLayout,
} from '@lib/custom-tabs';
import { TABS } from '@lib/tabs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestMarket } from '@/test/market-state';
import {
  MAIN_MARKET_ID,
  selectActiveCustomTab,
  selectActiveMarket,
  selectIsWidgetOpen,
  useAppStore,
  useMarket,
} from './app-store';

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

describe('custom tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    setTestMarket({ underlying: 'BTC', expiry: '2026-03-21' });
    useAppStore.setState({ activeTab: 'chain', customTabs: [], widgetFocusRequest: null });
  });

  function openNewTab(name = 'Desk'): string {
    useAppStore.getState().createCustomTab(name);
    return useAppStore.getState().activeMarketId;
  }

  it('opens a new tab holding a copy of the current market', () => {
    const id = openNewTab();

    const state = useAppStore.getState();
    expect(selectActiveCustomTab(state)?.name).toBe('Desk');
    expect(selectActiveMarket(state).underlying).toBe('BTC');
    expect(state.markets[id]).not.toBe(state.markets[MAIN_MARKET_ID]);
  });

  it('keeps ticker changes inside the custom tab', () => {
    openNewTab();
    useAppStore.getState().setUnderlying('ETH');

    const state = useAppStore.getState();
    expect(selectActiveMarket(state).underlying).toBe('ETH');
    expect(state.markets[MAIN_MARKET_ID].underlying).toBe('BTC');
  });

  it('carries the main ticker between fixed tabs', () => {
    useAppStore.getState().setUnderlying('SOL');
    useAppStore.getState().setActiveTab('gex');
    expect(selectActiveMarket(useAppStore.getState()).underlying).toBe('SOL');
  });

  it('returns to the main market when a fixed tab is chosen', () => {
    openNewTab();
    useAppStore.getState().setUnderlying('ETH');
    useAppStore.getState().setActiveTab('flow');

    const state = useAppStore.getState();
    expect(state.activeMarketId).toBe(MAIN_MARKET_ID);
    expect(selectActiveMarket(state).underlying).toBe('BTC');
  });

  it('adds each widget kind once, up to the limit', () => {
    openNewTab();
    const { addWidget } = useAppStore.getState();
    addWidget({ id: 'chain', kind: 'chain' });
    addWidget({ id: 'chain', kind: 'chain' });
    expect(selectActiveCustomTab(useAppStore.getState())?.kinds).toEqual(['chain']);

    for (const kind of TABS.map((tab) => tab.id)) addWidget({ id: kind, kind });
    expect(selectActiveCustomTab(useAppStore.getState())?.kinds).toHaveLength(MAX_WIDGETS_PER_TAB);
  });

  it('stops creating tabs at the limit', () => {
    for (let i = 0; i < MAX_CUSTOM_TABS + 3; i += 1) openNewTab(`Tab ${i}`);
    expect(useAppStore.getState().customTabs).toHaveLength(MAX_CUSTOM_TABS);
  });

  it('removes the market and saved layout when a tab closes', () => {
    const id = openNewTab();
    writeLayout(id, { grid: {}, panels: {} });

    useAppStore.getState().closeCustomTab(id);

    const state = useAppStore.getState();
    expect(state.customTabs).toEqual([]);
    expect(state.markets[id]).toBeUndefined();
    expect(state.activeMarketId).toBe(MAIN_MARKET_ID);
    expect(localStorage.getItem(`ogg.customTabLayout.v1.${id}`)).toBeNull();
  });

  it('saves tabs with their ticker and venues but not their expiry', () => {
    const id = openNewTab();
    useAppStore.getState().setUnderlying('ETH');
    useAppStore.getState().setExpiry('2026-06-26');

    expect(readCustomTabs()).toEqual([
      expect.objectContaining({ id, name: 'Desk', underlying: 'ETH' }),
    ]);
    expect(localStorage.getItem('ogg.customTabs.v1')).not.toContain('2026-06-26');
  });

  describe('navigateToWidget from a custom tab', () => {
    it('focuses a widget already in the tab and stays there', () => {
      const id = openNewTab();
      useAppStore.getState().addWidget({ id: 'architect', kind: 'architect' });

      useAppStore.getState().navigateToWidget('architect', { expiry: '2026-09-25' });

      const state = useAppStore.getState();
      expect(state.activeMarketId).toBe(id);
      expect(state.widgetFocusRequest).toBe('architect');
      expect(selectActiveMarket(state).expiry).toBe('2026-09-25');
      expect(state.markets[MAIN_MARKET_ID].expiry).toBe('2026-03-21');
    });

    it('asks for focus again after the last request was handled', () => {
      openNewTab();
      useAppStore.getState().addWidget({ id: 'architect', kind: 'architect' });

      useAppStore.getState().navigateToWidget('architect');
      useAppStore.getState().clearWidgetFocus();
      expect(useAppStore.getState().widgetFocusRequest).toBeNull();

      useAppStore.getState().navigateToWidget('architect');
      expect(useAppStore.getState().widgetFocusRequest).toBe('architect');
    });

    it('goes to the fixed tab carrying the custom market when the widget is absent', () => {
      openNewTab();
      useAppStore.getState().setUnderlying('ETH');
      useAppStore.getState().setExpiry('2026-06-26');

      useAppStore.getState().navigateToWidget('architect');

      const state = useAppStore.getState();
      expect(state.activeMarketId).toBe(MAIN_MARKET_ID);
      expect(state.activeTab).toBe('architect');
      expect(state.markets[MAIN_MARKET_ID].underlying).toBe('ETH');
      expect(state.markets[MAIN_MARKET_ID].expiry).toBe('2026-06-26');
    });
  });

  describe('selectIsWidgetOpen', () => {
    it('follows the fixed tab, then the custom tab contents', () => {
      useAppStore.setState({ activeTab: 'architect' });
      expect(selectIsWidgetOpen(useAppStore.getState(), 'architect')).toBe(true);

      openNewTab();
      expect(selectIsWidgetOpen(useAppStore.getState(), 'architect')).toBe(false);

      useAppStore.getState().addWidget({ id: 'architect', kind: 'architect' });
      expect(selectIsWidgetOpen(useAppStore.getState(), 'architect')).toBe(true);
    });
  });

  describe('claimMainFeed', () => {
    it('counts claims and releases them', () => {
      useAppStore.setState({ mainFeedClaims: 0 });
      const releaseFirst = useAppStore.getState().claimMainFeed();
      const releaseSecond = useAppStore.getState().claimMainFeed();
      expect(useAppStore.getState().mainFeedClaims).toBe(2);

      releaseFirst();
      releaseSecond();
      expect(useAppStore.getState().mainFeedClaims).toBe(0);
    });
  });
});

describe('moveCustomTab', () => {
  beforeEach(() => {
    localStorage.clear();
    setTestMarket({ underlying: 'BTC' });
    useAppStore.setState({ customTabs: [] });
    for (const name of ['A', 'B', 'C']) useAppStore.getState().createCustomTab(name);
  });

  const names = () => useAppStore.getState().customTabs.map((tab) => tab.name);
  const idOf = (name: string) => useAppStore.getState().customTabs.find((t) => t.name === name)!.id;

  it('moves a tab to the new position', () => {
    useAppStore.getState().moveCustomTab(idOf('A'), 2);
    expect(names()).toEqual(['B', 'C', 'A']);
  });

  it('keeps the same array when nothing moves, so nothing re-renders or saves', () => {
    const before = useAppStore.getState().customTabs;
    useAppStore.getState().moveCustomTab(idOf('B'), 1);
    expect(useAppStore.getState().customTabs).toBe(before);
  });

  it('ignores an unknown tab', () => {
    useAppStore.getState().moveCustomTab('nope', 0);
    expect(names()).toEqual(['A', 'B', 'C']);
  });

  it('saves the new order', () => {
    useAppStore.getState().moveCustomTab(idOf('C'), 0);
    expect(readCustomTabs().map((tab) => tab.name)).toEqual(['C', 'A', 'B']);
  });
});
