import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_WIDGETS_PER_TAB, readCustomTabs, writeCustomTabs } from './custom-tabs';
import { canAddPanel, type WidgetInstance } from './workspace-layouts';
import { WORKSPACE_TEMPLATE_IDS, WORKSPACE_TEMPLATES } from './workspace-templates';

beforeEach(() => localStorage.clear());

describe('curated workspace templates', () => {
  it.each(WORKSPACE_TEMPLATE_IDS)('keeps %s within the widget and visible-group budgets', (id) => {
    const template = WORKSPACE_TEMPLATES[id];
    expect(template.panels.length).toBeLessThanOrEqual(MAX_WIDGETS_PER_TAB);
    expect(new Set(template.panels.map((panel) => panel.kind)).size).toBe(template.panels.length);
    expect(new Set(template.panels.map((panel) => panel.group)).size).toBeLessThanOrEqual(4);
    const accepted: WidgetInstance[] = [];
    for (const panel of template.panels) {
      expect(panel.id).toBe(panel.kind);
      expect(panel.underlying).toBeUndefined();
      expect(canAddPanel(accepted, panel)).toBe(true);
      accepted.push(panel);
    }
  });

  it('preserves template identity alongside the existing custom-tab format', () => {
    const tab = {
      id: 'desk',
      name: 'My desk',
      kinds: ['chain-table'] as const,
      underlying: 'ETH',
      activeVenues: ['deribit'],
    };
    writeCustomTabs([{ ...tab, kinds: [...tab.kinds], templateId: 'overview' }]);
    expect(readCustomTabs()[0]).toEqual({ ...tab, templateId: 'overview' });
  });

  it('keeps a saved tab usable when its template is unknown', () => {
    localStorage.setItem(
      'ogg.customTabs.v1',
      JSON.stringify([
        {
          id: 'desk',
          name: 'My desk',
          kinds: ['chain-table'],
          underlying: 'ETH',
          activeVenues: ['deribit'],
          templateId: 'retired',
        },
      ]),
    );
    expect(readCustomTabs()[0]).toMatchObject({ id: 'desk', kinds: ['chain-table'] });
    expect(readCustomTabs()[0]?.templateId).toBeUndefined();
  });
});
