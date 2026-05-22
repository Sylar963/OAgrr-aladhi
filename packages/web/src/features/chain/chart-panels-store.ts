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
  range: InstrumentCandleRange;
  interval: InstrumentCandleInterval;
  overlays: { mark: boolean; ma9: boolean; ma20: boolean };
  chartMode: ChartMode;
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
  openPanel: (args: OpenPanelArgs) => string;
  closePanel: (id: string) => void;
  updatePanel: (id: string, patch: Partial<ChartPanel>) => void;
}

const DEFAULT_OVERLAYS = { mark: true, ma9: true, ma20: true } as const;

function makeId(venue: VenueId, symbol: string): string {
  return `${venue}:${symbol}`;
}

// State shape is intentionally minimal: desktop opens charts in separate OS
// windows via `openChartPopout`, so position/size/z-order don't live in
// React. This store now backs the mobile full-screen modal only.
export const useChartPanelsStore = create<ChartPanelsState>()(
  persist(
    (set, get) => ({
      panels: [],
      openPanel: (args) => {
        const id = makeId(args.venue, args.symbol);
        const existing = get().panels.find((p) => p.id === id);
        if (existing) return id;
        const panel: ChartPanel = {
          id,
          ...args,
          range: '7d',
          interval: '1h',
          overlays: { ...DEFAULT_OVERLAYS },
          chartMode: 'price',
        };
        set({ panels: [...get().panels, panel] });
        return id;
      },
      closePanel: (id) =>
        set({ panels: get().panels.filter((p) => p.id !== id) }),
      updatePanel: (id, patch) =>
        set({
          panels: get().panels.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }),
    }),
    {
      name: 'chartPanels.v3',
      version: 3,
    },
  ),
);
