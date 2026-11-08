import { isWidgetKind, type WidgetKind } from '@lib/tabs';
import { VENUE_IDS } from '@lib/venue-meta';
import { z } from 'zod';

export const MAX_CUSTOM_TABS = 10;
export const MAX_WIDGETS_PER_TAB = 8;
export const MAX_TAB_NAME_LENGTH = 40;

const TABS_KEY = 'ogg.customTabs.v1';
const LAYOUT_KEY_PREFIX = 'ogg.customTabLayout.v1.';

function layoutKey(id: string): string {
  return id.startsWith('builtin-') ? `ogg.builtinLayout.v1.${id.slice(8)}` : LAYOUT_KEY_PREFIX + id;
}

export interface CustomTab {
  id: string;
  name: string;
  kinds: WidgetKind[];
}

export interface PersistedCustomTab extends CustomTab {
  underlying: string;
  activeVenues: string[];
}

const PersistedTabSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+$/),
  name: z.string().min(1).max(MAX_TAB_NAME_LENGTH),
  kinds: z.array(z.string()),
  underlying: z.string().min(1),
  activeVenues: z.array(z.string()),
});

const LayoutSchema = z.looseObject({
  grid: z.looseObject({}),
  panels: z.record(
    z.string(),
    z.looseObject({
      params: z.looseObject({ kind: z.string(), underlying: z.enum(['BTC', 'ETH']).optional() }),
    }),
  ),
});

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be full or blocked; the layout still works for this session.
  }
}

/** Drops whatever no longer parses one tab at a time, so saved state can never block startup. */
export function readCustomTabs(): PersistedCustomTab[] {
  const raw = readJson(TABS_KEY);
  if (!Array.isArray(raw)) return [];

  const tabs = new Map<string, PersistedCustomTab>();
  for (const entry of raw) {
    const parsed = PersistedTabSchema.safeParse(entry);
    if (!parsed.success || tabs.has(parsed.data.id)) continue;
    const venues = parsed.data.activeVenues.filter((venue) =>
      (VENUE_IDS as readonly string[]).includes(venue),
    );
    tabs.set(parsed.data.id, {
      ...parsed.data,
      kinds: [...new Set(parsed.data.kinds.filter(isWidgetKind))].slice(0, MAX_WIDGETS_PER_TAB),
      activeVenues: venues.length > 0 ? venues : [...VENUE_IDS],
    });
  }
  return [...tabs.values()].slice(0, MAX_CUSTOM_TABS);
}

let lastWritten: string | null = null;

export function writeCustomTabs(tabs: PersistedCustomTab[]): void {
  const json = JSON.stringify(tabs);
  if (json === lastWritten) return;
  lastWritten = json;
  writeRaw(TABS_KEY, json);
}

export function readLayout(id: string): unknown {
  const parsed = LayoutSchema.safeParse(readJson(layoutKey(id)));
  if (!parsed.success) return null;
  const known = Object.values(parsed.data.panels).every((panel) => isWidgetKind(panel.params.kind));
  return known ? parsed.data : null;
}

export function writeLayout(id: string, layout: unknown): void {
  writeRaw(layoutKey(id), JSON.stringify(layout));
}

export function removeLayout(id: string): void {
  try {
    localStorage.removeItem(layoutKey(id));
  } catch {
    // Same as writeRaw: nothing useful to do when storage is unavailable.
  }
}
