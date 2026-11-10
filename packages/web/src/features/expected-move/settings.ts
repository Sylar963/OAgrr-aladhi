import { readJson, writeRaw } from '@lib/custom-tabs';
import { VENUE_IDS } from '@oggregator/protocol';
import { create } from 'zustand';
import { z } from 'zod';

const SettingsSchema = z.object({
  asset: z.enum(['workspace', 'BTC', 'ETH', 'SPX']).default('workspace'),
  anchor: z.enum(['utc0', 'utc8']).default('utc0'),
  venue: z.enum(VENUE_IDS).default('deribit'),
  expiry: z.string().default(''),
  historyDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(14),
  showHistory: z.boolean().default(false),
  showStraddle: z.boolean().default(false),
  moveAlertRatio: z.number().finite().min(0.25).max(10).default(1),
  premiumAlertPercent: z.number().finite().min(1).max(1000).default(10),
});

export type ExpectedMoveSettings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS = SettingsSchema.parse({});
const KEY = 'ogg.expectedMovePanels.v1';

function readSettings(): Record<string, ExpectedMoveSettings> {
  const raw = z.record(z.string(), z.unknown()).safeParse(readJson(KEY));
  if (!raw.success) return {};
  return Object.fromEntries(
    Object.entries(raw.data).flatMap(([id, value]) => {
      const parsed = SettingsSchema.safeParse(value);
      return parsed.success ? [[id, parsed.data]] : [];
    }),
  );
}

export const useExpectedMoveSettings = create<{
  panels: Record<string, ExpectedMoveSettings>;
  update: (id: string, patch: Partial<ExpectedMoveSettings>) => void;
}>((set) => ({
  panels: readSettings(),
  update: (id, patch) =>
    set((state) => {
      const parsed = SettingsSchema.safeParse({
        ...(state.panels[id] ?? DEFAULT_SETTINGS),
        ...patch,
      });
      if (!parsed.success) return state;
      const panels = { ...state.panels, [id]: parsed.data };
      writeRaw(KEY, JSON.stringify(panels));
      return { panels };
    }),
}));
