import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_CUSTOM_TABS,
  MAX_WIDGETS_PER_TAB,
  readCustomTabs,
  readLayout,
  removeLayout,
  writeCustomTabs,
  writeLayout,
} from './custom-tabs';
import { VENUE_IDS } from './venue-meta';

const TABS_KEY = 'ogg.customTabs.v1';
const validTab = {
  id: 'abc123',
  name: 'Vol desk',
  kinds: ['chain', 'gex'],
  underlying: 'ETH',
  activeVenues: ['deribit'],
};

function storeTabs(tabs: unknown): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
}

describe('readCustomTabs', () => {
  beforeEach(() => localStorage.clear());

  it('returns nothing when storage is empty or not a list', () => {
    expect(readCustomTabs()).toEqual([]);
    localStorage.setItem(TABS_KEY, '{not json');
    expect(readCustomTabs()).toEqual([]);
    storeTabs({ tabs: [] });
    expect(readCustomTabs()).toEqual([]);
  });

  it('round-trips a saved tab', () => {
    writeCustomTabs([{ ...validTab, kinds: ['chain', 'gex'] }]);
    expect(readCustomTabs()).toEqual([validTab]);
  });

  it('drops only the tab that fails to parse', () => {
    storeTabs([validTab, { id: 'has/slash', name: 'x', kinds: [] }, { nonsense: true }]);
    expect(readCustomTabs().map((tab) => tab.id)).toEqual(['abc123']);
  });

  it('drops widget kinds that no longer exist and repeats', () => {
    storeTabs([{ ...validTab, kinds: ['chain', 'retired', 'chain'] }]);
    expect(readCustomTabs()[0]!.kinds).toEqual(['chain']);
  });

  it.each([
    ['chain-table', 'chain-stats', 'vol-smile'],
    ['chain-stats', 'vol-smile'],
  ])('merges legacy stats into a single table: %j', (...kinds) => {
    storeTabs([{ ...validTab, kinds }]);
    expect(readCustomTabs()[0]).toEqual({ ...validTab, kinds: ['chain-table', 'vol-smile'] });
  });

  it('falls back to every venue when none of the saved ones exist', () => {
    storeTabs([{ ...validTab, activeVenues: ['gone'] }]);
    expect(readCustomTabs()[0]!.activeVenues).toEqual([...VENUE_IDS]);
  });

  it('enforces the tab and widget limits on tampered storage', () => {
    const many = Array.from({ length: MAX_CUSTOM_TABS + 5 }, (_, i) => ({
      ...validTab,
      id: `tab${i}`,
    }));
    storeTabs(many);
    expect(readCustomTabs()).toHaveLength(MAX_CUSTOM_TABS);

    const allKinds = ['chain', 'alpha', 'architect', 'trading', 'portfolio', 'social', 'surface'];
    storeTabs([{ ...validTab, kinds: [...allKinds, 'flow', 'analytics', 'gex', 'news'] }]);
    expect(readCustomTabs()[0]!.kinds).toHaveLength(MAX_WIDGETS_PER_TAB);
  });
});

describe('readLayout', () => {
  const layout = {
    grid: { root: {} },
    panels: { chain: { id: 'chain', params: { kind: 'chain' } } },
  };

  beforeEach(() => localStorage.clear());

  it('round-trips a saved layout and removes it', () => {
    writeLayout('abc', layout);
    expect(readLayout('abc')).toEqual(layout);

    removeLayout('abc');
    expect(readLayout('abc')).toBeNull();
  });

  it('rejects malformed layouts', () => {
    localStorage.setItem('ogg.customTabLayout.v1.abc', '{not json');
    expect(readLayout('abc')).toBeNull();

    writeLayout('abc', { panels: {} });
    expect(readLayout('abc')).toBeNull();
  });

  it('rejects a layout naming a widget that no longer exists', () => {
    writeLayout('abc', {
      grid: { root: {} },
      panels: { old: { id: 'old', params: { kind: 'retired' } } },
    });
    expect(readLayout('abc')).toBeNull();
  });
});
