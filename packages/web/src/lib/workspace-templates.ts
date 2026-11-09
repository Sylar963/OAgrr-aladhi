import type { WidgetKind } from './tabs';
import type { PresetPanel } from './workspace-layouts';

export const WORKSPACE_TEMPLATE_IDS = [
  'overview',
  'planning',
  'volatility',
  'flow',
  'portfolio',
  'blank',
] as const;
export type WorkspaceTemplateId = (typeof WORKSPACE_TEMPLATE_IDS)[number];

function panels(kinds: readonly WidgetKind[]): PresetPanel[] {
  return kinds.map((kind, index) => ({ id: kind, kind, group: index % 4 }));
}

export const WORKSPACE_TEMPLATES: Record<WorkspaceTemplateId, { panels: readonly PresetPanel[] }> =
  {
    overview: { panels: panels(['chain-table', 'oi-summary', 'vol-smile']) },
    planning: { panels: panels(['chain-table', 'architect', 'vol-smile']) },
    volatility: {
      panels: panels([
        'vol-smile',
        'iv-rank',
        'atm-term',
        'realized-vs-implied',
        'skew-history',
        'surface-3d',
      ]),
    },
    flow: { panels: panels(['flow', 'gex', 'oi-by-strike', 'top-positions']) },
    portfolio: { panels: panels(['portfolio', 'chain-table', 'gex']) },
    blank: { panels: [] },
  };
