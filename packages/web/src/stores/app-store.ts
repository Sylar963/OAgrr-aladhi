import { create } from 'zustand';

import type { WsConnectionState } from '@oggregator/protocol';
import { VENUE_IDS } from '@lib/venue-meta';

export interface FeedStatus {
  connectionState: WsConnectionState;
  failedVenueCount: number;
  staleMs: number | null;
}

interface AppState {
  underlying: string;
  expiry: string;
  activeTab: 'chain' | 'surface' | 'gex' | 'flow' | 'analytics' | 'architect' | 'trading';
  activeVenues: string[];
  myIv: string;
  feedStatus: FeedStatus;
  apiKey: string | null;
  userId: string | null;
  accountId: string | null;

  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setActiveTab: (t: 'chain' | 'surface' | 'gex' | 'flow' | 'analytics' | 'architect' | 'trading') => void;
  toggleVenue: (venueId: string) => void;
  setActiveVenues: (venues: string[]) => void;
  setMyIv: (iv: string) => void;
  setFeedStatus: (s: Partial<FeedStatus>) => void;
  setAuth: (apiKey: string, userId: string, accountId: string) => void;
  clearAuth: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  underlying: 'BTC',
  expiry: '',
  activeTab: 'chain',
  activeVenues: [...VENUE_IDS],
  myIv: '',
  feedStatus: { connectionState: 'closed', failedVenueCount: 0, staleMs: null },
  apiKey: localStorage.getItem('paperApiKey'),
  userId: localStorage.getItem('paperUserId'),
  accountId: localStorage.getItem('paperAccountId'),

  setUnderlying: (underlying) => set({ underlying, expiry: '' }),
  setExpiry: (expiry) => set({ expiry }),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleVenue: (venueId) =>
    set((s) => {
      const active = s.activeVenues.includes(venueId)
        ? s.activeVenues.filter((v) => v !== venueId)
        : [...s.activeVenues, venueId];
      return { activeVenues: active.length > 0 ? active : s.activeVenues };
    }),
  setActiveVenues: (venues) =>
    set({ activeVenues: venues.length > 0 ? venues : VENUE_IDS.slice() }),
  setMyIv: (myIv) => set({ myIv }),
  setFeedStatus: (s) => set((prev) => ({ feedStatus: { ...prev.feedStatus, ...s } })),
  setAuth: (apiKey, userId, accountId) => {
    localStorage.setItem('paperApiKey', apiKey);
    localStorage.setItem('paperUserId', userId);
    localStorage.setItem('paperAccountId', accountId);
    set({ apiKey, userId, accountId });
  },
  clearAuth: () => {
    localStorage.removeItem('paperApiKey');
    localStorage.removeItem('paperUserId');
    localStorage.removeItem('paperAccountId');
    set({ apiKey: null, userId: null, accountId: null });
  },
}));
