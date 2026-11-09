import { MAX_CUSTOM_TABS, readCustomTabs, readLayout, writeLayout } from '@lib/custom-tabs';
import { builtinLayoutId } from '@lib/workspace-layouts';
import { WORKSPACE_TEMPLATES } from '@lib/workspace-templates';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAIN_MARKET_ID, selectActiveMarket, selectLayoutPreset, useAppStore } from './app-store';

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    customTabs: [],
    builtinLayouts: {},
    activeMarketId: MAIN_MARKET_ID,
    activeTab: 'chain',
  });
});

describe('template-backed custom tabs', () => {
  it('creates a named setup without changing the source layout or its market', () => {
    const store = useAppStore.getState();
    store.setUnderlying('ETH');
    store.setExpiry('2027-01-29');
    store.setLayoutPanels(builtinLayoutId('chain'), []);
    expect(store.createCustomTab('Trade planning', 'planning')).toBe(true);
    const state = useAppStore.getState();
    const tab = state.customTabs[0]!;
    expect(tab).toMatchObject({
      name: 'Trade planning',
      templateId: 'planning',
      kinds: ['chain-table', 'architect', 'vol-smile'],
    });
    expect(state.builtinLayouts.chain).toEqual([]);
    expect(selectActiveMarket(state)).toMatchObject({ underlying: 'ETH', expiry: '2027-01-29' });
    expect(selectLayoutPreset(state, tab.id)).toBe(WORKSPACE_TEMPLATES.planning.panels);
    expect(readCustomTabs()[0]?.templateId).toBe('planning');
  });

  it('fills only an empty tab, keeping its name, ticker, and slot', () => {
    const store = useAppStore.getState();
    store.createCustomTab('My ETH desk');
    const id = useAppStore.getState().activeMarketId;
    store.setUnderlying('ETH');
    writeLayout(id, { grid: {}, panels: {} });
    expect(store.applyTemplateToEmptyTab(id, 'volatility')).toBe(true);
    expect(useAppStore.getState().customTabs).toHaveLength(1);
    expect(useAppStore.getState().customTabs[0]).toMatchObject({
      id,
      name: 'My ETH desk',
      templateId: 'volatility',
    });
    expect(selectActiveMarket(useAppStore.getState()).underlying).toBe('ETH');
    expect(readLayout(id)).toBeNull();
    expect(store.applyTemplateToEmptyTab(id, 'planning')).toBe(false);
    expect(useAppStore.getState().customTabs[0]?.templateId).toBe('volatility');
  });

  it('restores template membership and arrangement on reset without renaming the tab', () => {
    const store = useAppStore.getState();
    store.createCustomTab('My desk', 'overview');
    const id = useAppStore.getState().activeMarketId;
    store.setLayoutPanels(id, [{ id: 'news', kind: 'news' }]);
    writeLayout(id, { grid: {}, panels: {} });
    store.resetActiveLayout();
    expect(useAppStore.getState().customTabs[0]).toMatchObject({
      name: 'My desk',
      kinds: WORKSPACE_TEMPLATES.overview.panels.map((panel) => panel.kind),
    });
    expect(readLayout(id)).toBeNull();
  });

  it('enforces tab capacity while allowing an existing empty tab to receive a template', () => {
    const store = useAppStore.getState();
    for (let i = 0; i < MAX_CUSTOM_TABS; i++) store.createCustomTab(`Desk ${i}`);
    const id = useAppStore.getState().activeMarketId;
    expect(store.createCustomTab('Extra', 'planning')).toBe(false);
    expect(store.applyTemplateToEmptyTab(id, 'planning')).toBe(true);
    expect(useAppStore.getState().customTabs).toHaveLength(MAX_CUSTOM_TABS);
  });
});
