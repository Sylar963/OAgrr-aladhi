import { z } from 'zod';
import { MAX_WIDGETS_PER_TAB, readJson, writeRaw } from './custom-tabs';
import { isWidgetKind, TABS, type TabId, type WidgetKind } from './tabs';

export interface WidgetInstance {
  id: string;
  kind: WidgetKind;
  underlying?: 'BTC' | 'ETH';
}

export interface PresetPanel extends WidgetInstance {
  group: number;
}

export const SURFACE_KINDS = [
  'surface-3d',
  'iv-rank',
  'skew-history',
  'vol-smile',
  'atm-term',
  'realized-vs-implied',
] as const satisfies readonly WidgetKind[];

const ANALYTICS_KINDS = [
  'oi-summary',
  'venue-share',
  'top-positions',
  'expiry-calendar',
  'vol-curves',
  'break-even',
  'time-at-price',
  'oi-by-strike',
  'dvol-chart',
  'dvol-heatmap',
] as const satisfies readonly WidgetKind[];

export const PRESETS: Record<TabId, readonly PresetPanel[]> = {
  ...(Object.fromEntries(TABS.map(({ id }) => [id, [{ id, kind: id, group: 0 }]])) as Record<
    TabId,
    PresetPanel[]
  >),
  chain: [
    { id: 'chain-table', kind: 'chain-table', group: 0 },
    { id: 'chain-venues', kind: 'chain-venues', group: 2 },
  ],
  analytics: ANALYTICS_KINDS.map((kind, index) => ({ id: kind, kind, group: index % 4 })),
  surface: SURFACE_KINDS.flatMap((kind, index) =>
    (['BTC', 'ETH'] as const).map((underlying, column) => ({
      id: `${kind}-${underlying.toLowerCase()}`,
      kind,
      underlying,
      group: (index % 2) * 2 + column,
    })),
  ),
};

const OVERRIDES_KEY = 'ogg.builtinLayouts.v1';
const InstanceSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/)
    .max(80),
  kind: z
    .string()
    .refine(isWidgetKind)
    .transform((value) => value as WidgetKind),
  underlying: z.enum(['BTC', 'ETH']).optional(),
});

export function builtinLayoutId(tab: TabId): string {
  return `builtin-${tab}`;
}

export function builtinTabFromLayoutId(id: string): TabId | undefined {
  return TABS.find((tab) => builtinLayoutId(tab.id) === id)?.id;
}

export function defaultPanels(tab: TabId): WidgetInstance[] {
  return PRESETS[tab].map(({ group: _group, ...panel }) => panel);
}

export function layoutCapacity(tab?: TabId): number {
  return Math.max(MAX_WIDGETS_PER_TAB, tab ? PRESETS[tab].length : 0);
}

export function matchesDestination(panel: WidgetInstance, kind: WidgetKind): boolean {
  const tab = TABS.find((entry) => entry.id === kind);
  return panel.kind === kind || (tab != null && panel.kind === PRESETS[tab.id][0]?.kind);
}

function family(kind: WidgetKind): string {
  if (kind === 'chain' || kind.startsWith('chain-')) return 'chain';
  if (kind === 'analytics' || (ANALYTICS_KINDS as readonly string[]).includes(kind))
    return 'analytics';
  if (kind === 'surface' || (SURFACE_KINDS as readonly string[]).includes(kind)) return 'surface';
  return kind;
}

export function canAddPanel(
  panels: readonly WidgetInstance[],
  candidate: WidgetInstance,
  tab?: TabId,
): boolean {
  if (panels.length >= layoutCapacity(tab) || panels.some((panel) => panel.id === candidate.id))
    return false;
  if (
    tab &&
    !panels.some((panel) => matchesDestination(panel, tab)) &&
    !matchesDestination(candidate, tab) &&
    panels.length >= layoutCapacity(tab) - 1
  )
    return false;
  const canonicalId = candidate.underlying
    ? `${candidate.kind}-${candidate.underlying.toLowerCase()}`
    : candidate.kind;
  if (candidate.id !== canonicalId) return false;
  if (candidate.underlying && !(SURFACE_KINDS as readonly string[]).includes(candidate.kind))
    return false;
  if (
    panels.length >= MAX_WIDGETS_PER_TAB &&
    !(tab && PRESETS[tab].some((panel) => panel.id === candidate.id))
  )
    return false;
  const siblings = panels.filter((panel) => family(panel.kind) === family(candidate.kind));
  const wholeView = TABS.some((entry) => entry.id === candidate.kind);
  if (
    siblings.some((panel) => TABS.some((entry) => entry.id === panel.kind)) ||
    (wholeView && siblings.length > 0)
  )
    return false;
  return !siblings.some(
    (panel) =>
      panel.kind === candidate.kind &&
      (panel.underlying === candidate.underlying || !panel.underlying || !candidate.underlying),
  );
}

export function readBuiltinLayouts(): Partial<Record<TabId, WidgetInstance[]>> {
  const raw = readJson(OVERRIDES_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Partial<Record<TabId, WidgetInstance[]>> = {};
  for (const { id } of TABS) {
    const entries = z.array(z.unknown()).safeParse(Reflect.get(raw, id));
    if (!entries.success) continue;
    const panels: WidgetInstance[] = [];
    for (const entry of entries.data) {
      const parsed = InstanceSchema.safeParse(
        entry != null && typeof entry === 'object' && Reflect.get(entry, 'kind') === 'chain-stats'
          ? { id: 'chain-table', kind: 'chain-table' }
          : entry,
      );
      if (parsed.success && canAddPanel(panels, parsed.data, id)) panels.push(parsed.data);
    }
    if (entries.data.length === 0 || panels.length > 0) result[id] = panels;
  }
  return result;
}

export function writeBuiltinLayouts(layouts: Partial<Record<TabId, WidgetInstance[]>>): void {
  writeRaw(OVERRIDES_KEY, JSON.stringify(layouts));
}
