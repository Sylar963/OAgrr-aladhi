import { create } from 'zustand';
import type { HedgeLeg, Leg } from './payoff';

let _nextLegId = 1;
let _nextHedgeId = 1;

interface StrategyState {
  underlying: string;
  legs: Leg[];
  hedges: HedgeLeg[];
  addLeg: (leg: Omit<Leg, 'id'>, underlying: string) => void;
  removeLeg: (id: string) => void;
  updateLeg: (id: string, patch: Partial<Leg>) => void;
  addHedge: (hedge: Omit<HedgeLeg, 'id'>, underlying: string) => void;
  removeHedge: (id: string) => void;
  updateHedge: (id: string, patch: Partial<HedgeLeg>) => void;
  replaceLegs: (legs: Leg[], underlying: string, hedges?: HedgeLeg[]) => void;
  clearLegs: () => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
  underlying: '',
  legs: [],
  hedges: [],

  addLeg: (leg, underlying) =>
    set((s) => {
      const sameUnderlying = s.underlying === underlying;
      return {
        underlying,
        legs: [...(sameUnderlying ? s.legs : []), { ...leg, id: `leg-${_nextLegId++}` }],
        hedges: sameUnderlying ? s.hedges : [],
      };
    }),

  removeLeg: (id) =>
    set((s) => ({
      legs: s.legs.filter((l) => l.id !== id),
    })),

  updateLeg: (id, patch) =>
    set((s) => ({
      legs: s.legs.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  addHedge: (hedge, underlying) =>
    set((s) => {
      const sameUnderlying = s.underlying === underlying;
      return {
        underlying,
        legs: sameUnderlying ? s.legs : [],
        hedges: [
          ...(sameUnderlying ? s.hedges : []),
          { ...hedge, id: `hedge-${_nextHedgeId++}` },
        ],
      };
    }),

  removeHedge: (id) =>
    set((s) => ({
      hedges: s.hedges.filter((h) => h.id !== id),
    })),

  updateHedge: (id, patch) =>
    set((s) => ({
      hedges: s.hedges.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    })),

  replaceLegs: (legs, underlying, hedges = []) => set({ legs, underlying, hedges }),

  clearLegs: () => set({ legs: [], hedges: [] }),
}));
