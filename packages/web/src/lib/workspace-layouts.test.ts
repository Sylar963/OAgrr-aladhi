import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_WIDGETS_PER_TAB } from './custom-tabs';
import { TABS, type WidgetKind } from './tabs';
import {
  builtinLayoutId,
  builtinTabFromLayoutId,
  canAddPanel,
  defaultPanels,
  PRESETS,
  readBuiltinLayouts,
  SURFACE_KINDS,
  writeBuiltinLayouts,
} from './workspace-layouts';

beforeEach(() => localStorage.clear());

describe('built-in presets', () => {
  it('replaces desktop compositions while preserving the complete analytics and comparison coverage', () => {
    expect(defaultPanels('chain').map((panel) => panel.kind)).toEqual([
      'chain-table',
      'chain-stats',
      'chain-venues',
    ]);
    expect(defaultPanels('analytics')).toHaveLength(10);
    expect(new Set(defaultPanels('analytics').map((panel) => panel.kind)).size).toBe(10);
    expect(defaultPanels('surface')).toHaveLength(12);
    for (const kind of SURFACE_KINDS) {
      expect(
        defaultPanels('surface')
          .filter((panel) => panel.kind === kind)
          .map((panel) => panel.underlying),
      ).toEqual(['BTC', 'ETH']);
    }
    for (const tab of TABS) {
      expect(builtinTabFromLayoutId(builtinLayoutId(tab.id))).toBe(tab.id);
    }
    expect(builtinTabFromLayoutId('unknown')).toBeUndefined();
  });

  it('starts analytics and volatility with only four visible groups and at most two 3D surfaces', () => {
    for (const tab of ['analytics', 'surface'] as const) {
      expect(new Set(PRESETS[tab].map((panel) => panel.group)).size).toBe(4);
    }
    expect(defaultPanels('surface').filter((panel) => panel.kind === 'surface-3d')).toHaveLength(2);
  });

  it('prevents duplicate singleton views and overlapping complete views and cards', () => {
    expect(canAddPanel(defaultPanels('chain'), { id: 'chain', kind: 'chain' }, 'chain')).toBe(
      false,
    );
    expect(
      canAddPanel([{ id: 'analytics', kind: 'analytics' }], {
        id: 'oi-summary',
        kind: 'oi-summary',
      }),
    ).toBe(false);
    expect(
      canAddPanel([{ id: 'architect', kind: 'architect' }], { id: 'second', kind: 'architect' }),
    ).toBe(false);
    expect(
      canAddPanel(defaultPanels('surface'), { id: 'surface-3d', kind: 'surface-3d' }, 'surface'),
    ).toBe(false);
    expect(canAddPanel([], { id: 'chain-eth', kind: 'chain', underlying: 'ETH' })).toBe(false);
  });

  it('keeps optional widgets within the custom-tab budget even on larger built-in presets', () => {
    const panels = defaultPanels('analytics').slice(0, MAX_WIDGETS_PER_TAB);
    expect(canAddPanel(panels, { id: 'flow', kind: 'flow' }, 'analytics')).toBe(false);
    expect(canAddPanel(panels, { id: 'dvol-chart', kind: 'dvol-chart' }, 'analytics')).toBe(true);
    expect(canAddPanel(panels, { id: 'dvol-chart', kind: 'dvol-chart' })).toBe(false);
  });

  it('reserves space to reopen the destination after its primary panel was closed', () => {
    const kinds: WidgetKind[] = [
      'chain-table',
      'gex',
      'flow',
      'portfolio',
      'social',
      'news',
      'alpha',
    ];
    const panels = kinds.map((kind) => ({ id: kind, kind }));
    expect(canAddPanel(panels, { id: 'sectors', kind: 'sectors' }, 'architect')).toBe(false);
    expect(canAddPanel(panels, { id: 'architect', kind: 'architect' }, 'architect')).toBe(true);
  });
});

describe('built-in persistence', () => {
  it('round-trips full presets and intentional empty layouts', () => {
    const saved = {
      analytics: defaultPanels('analytics'),
      surface: defaultPanels('surface'),
      chain: [],
    };
    writeBuiltinLayouts(saved);
    expect(readBuiltinLayouts()).toEqual(saved);
  });

  it('isolates malformed overrides and removes unsupported instances', () => {
    localStorage.setItem(
      'ogg.builtinLayouts.v1',
      JSON.stringify({
        chain: 'bad',
        analytics: [{ id: 'gone', kind: 'retired' }],
        surface: [
          ...defaultPanels('surface'),
          { id: 'third', kind: 'surface-3d', underlying: 'SOL' },
        ],
        gex: [
          { id: 'gex', kind: 'gex' },
          { id: 'gex', kind: 'gex' },
        ],
      }),
    );
    expect(readBuiltinLayouts()).toEqual({
      surface: defaultPanels('surface'),
      gex: defaultPanels('gex'),
    });
    localStorage.setItem('ogg.builtinLayouts.v1', '{broken');
    expect(readBuiltinLayouts()).toEqual({});
  });
});
