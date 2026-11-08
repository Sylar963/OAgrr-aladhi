import { readCustomTabs, readLayout, writeLayout } from '@lib/custom-tabs';
import { builtinLayoutId, defaultPanels, readBuiltinLayouts } from '@lib/workspace-layouts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAIN_MARKET_ID,
  selectActiveLayoutId,
  selectActiveMarket,
  selectIsWidgetOpen,
  selectLayoutPanels,
  useAppStore,
} from './app-store';

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    builtinLayouts: {},
    customTabs: [],
    activeMarketId: MAIN_MARKET_ID,
    activeTab: 'chain',
    widgetFocusRequest: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

const activePanels = () =>
  selectLayoutPanels(useAppStore.getState(), selectActiveLayoutId(useAppStore.getState()));

describe('editable default layouts', () => {
  it('keeps built-in layouts independent from market contexts and custom-tab slots', () => {
    const store = useAppStore.getState();
    store.setUnderlying('ETH');
    store.addWidget({ id: 'architect', kind: 'architect' });
    expect(activePanels().some((panel) => panel.kind === 'architect')).toBe(true);
    expect(readBuiltinLayouts().chain).toEqual(activePanels());
    store.setActiveTab('surface');
    expect(activePanels()).toHaveLength(12);
    expect(selectActiveMarket(useAppStore.getState()).underlying).toBe('ETH');
    expect(useAppStore.getState().customTabs).toEqual([]);
    expect(Object.keys(useAppStore.getState().markets)).toEqual([MAIN_MARKET_ID]);
  });

  it('focuses Builder inside a built-in layout and carries the intended market change', () => {
    const store = useAppStore.getState();
    store.addWidget({ id: 'architect', kind: 'architect' });
    store.navigateToWidget('architect', { underlying: 'ETH', expiry: '2027-01-29' });
    expect(useAppStore.getState()).toMatchObject({
      activeTab: 'chain',
      widgetFocusRequest: 'architect',
    });
    expect(selectActiveMarket(useAppStore.getState())).toMatchObject({
      underlying: 'ETH',
      expiry: '2027-01-29',
    });
  });

  it('recognizes a standalone chain table as the Chain destination in a custom tab', () => {
    const store = useAppStore.getState();
    store.createCustomTab('Desk');
    const id = useAppStore.getState().activeMarketId;
    store.addWidget({ id: 'chain-table', kind: 'chain-table' });
    store.navigateToWidget('chain', { underlying: 'SOL' });
    expect(useAppStore.getState()).toMatchObject({
      activeMarketId: id,
      widgetFocusRequest: 'chain-table',
    });
    expect(selectIsWidgetOpen(useAppStore.getState(), 'chain')).toBe(true);
    expect(readCustomTabs()[0]?.kinds).toEqual(['chain-table']);
  });

  it('restores a closed destination panel without replacing the remaining user panels', () => {
    const store = useAppStore.getState();
    store.setLayoutPanels(builtinLayoutId('architect'), [{ id: 'flow', kind: 'flow' }]);
    store.navigateToWidget('architect');
    expect(activePanels().map((panel) => panel.id)).toEqual(['flow', 'architect']);
    expect(useAppStore.getState().widgetFocusRequest).toBe('architect');
  });

  it('keeps an intentionally empty layout empty until reset and isolates reset from other layouts', () => {
    const store = useAppStore.getState();
    store.setLayoutPanels(builtinLayoutId('chain'), []);
    store.setLayoutPanels(builtinLayoutId('gex'), []);
    writeLayout(builtinLayoutId('chain'), { grid: {}, panels: {} });
    expect(activePanels()).toEqual([]);
    expect(readBuiltinLayouts().chain).toEqual([]);
    store.resetActiveLayout();
    expect(activePanels()).toEqual(defaultPanels('chain'));
    expect(readLayout(builtinLayoutId('chain'))).toBeNull();
    expect(readBuiltinLayouts()).toEqual({ gex: [] });
  });

  it('does not write layouts on price, feed, expiry, or My IV updates', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const store = useAppStore.getState();
    store.setFeedStatus({ lastUpdateMs: 123 });
    store.setExpiry('2027-01-29');
    store.setMyIv('55');
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps hidden desktop widgets out of mobile navigation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const store = useAppStore.getState();
    store.addWidget({ id: 'architect', kind: 'architect' });
    expect(selectIsWidgetOpen(useAppStore.getState(), 'architect', false)).toBe(false);
    store.navigateToWidget('architect', { underlying: 'ETH' });
    expect(useAppStore.getState()).toMatchObject({
      activeTab: 'architect',
      activeMarketId: MAIN_MARKET_ID,
      widgetFocusRequest: null,
    });
    expect(selectIsWidgetOpen(useAppStore.getState(), 'architect', false)).toBe(true);
  });
});
