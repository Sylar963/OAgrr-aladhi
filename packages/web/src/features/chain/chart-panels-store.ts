import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VenueId, InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';

export type ChartMode = 'price' | 'attribution';

export interface ChartPanel {
  id: string;
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
  x: number;
  y: number;
  w: number;
  h: number;
  range: InstrumentCandleRange;
  interval: InstrumentCandleInterval;
  overlays: { mark: boolean; ma9: boolean; ma20: boolean };
  chartMode: ChartMode;
  minimized: boolean;
  zSeq: number;
}

interface OpenPanelArgs {
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
}

interface ChartPanelsState {
  panels: ChartPanel[];
  zCounter: number;
  openPanel: (args: OpenPanelArgs) => string;
  closePanel: (id: string) => void;
  updatePanel: (id: string, patch: Partial<ChartPanel>) => void;
  bringToFront: (id: string) => void;
  clampToViewport: (vw: number, vh: number) => void;
}

const DEFAULT_W = 560;
const DEFAULT_H = 360;
const DEFAULT_OVERLAYS = { mark: true, ma9: true, ma20: true } as const;

function makeId(venue: VenueId, symbol: string): string {
  return `${venue}:${symbol}`;
}

export const useChartPanelsStore = create<ChartPanelsState>()(
  persist(
    (set, get) => ({
      panels: [],
      zCounter: 0,
      openPanel: (args) => {
        const id = makeId(args.venue, args.symbol);
        const existing = get().panels.find((p) => p.id === id);
        if (existing) {
          get().bringToFront(id);
          return id;
        }
        const z = get().zCounter + 1;
        const offset = (get().panels.length % 6) * 24;
        const panel: ChartPanel = {
          id,
          ...args,
          x: 80 + offset,
          y: 80 + offset,
          w: DEFAULT_W,
          h: DEFAULT_H,
          range: '7d',
          interval: '1h',
          overlays: { ...DEFAULT_OVERLAYS },
          chartMode: 'price',
          minimized: false,
          zSeq: z,
        };
        set({ panels: [...get().panels, panel], zCounter: z });
        return id;
      },
      closePanel: (id) =>
        set({ panels: get().panels.filter((p) => p.id !== id) }),
      updatePanel: (id, patch) =>
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }),
      bringToFront: (id) => {
        const z = get().zCounter + 1;
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, zSeq: z } : p)),
          zCounter: z,
        });
      },
      clampToViewport: (vw, vh) =>
        set({
          panels: get().panels.map((p) => {
            const VISIBLE_MARGIN = 32;
            const fullyOffScreen =
              p.x > vw - VISIBLE_MARGIN ||
              p.x + p.w < VISIBLE_MARGIN ||
              p.y > vh - VISIBLE_MARGIN ||
              p.y + p.h < VISIBLE_MARGIN;
            if (!fullyOffScreen) return p;
            return {
              ...p,
              x: Math.max(0, Math.min(p.x, vw - p.w)),
              y: Math.max(0, Math.min(p.y, vh - p.h)),
            };
          }),
        }),
    }),
    {
      name: 'chartPanels.v2',
      version: 2,
      migrate: (persisted: unknown) => {
        if (persisted && typeof persisted === 'object' && 'panels' in persisted) {
          const state = persisted as { panels: ChartPanel[]; zCounter: number };
          return {
            ...state,
            panels: state.panels.map((p) => ({ ...p, chartMode: p.chartMode ?? 'price' })),
          };
        }
        return persisted as Partial<ChartPanelsState>;
      },
    },
  ),
);
