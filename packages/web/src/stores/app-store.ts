import { create } from 'zustand';

import type { WsConnectionState } from '@oggregator/protocol';
import { VENUE_IDS } from '@lib/venue-meta';

export interface FeedStatus {
  connectionState: WsConnectionState;
  failedVenueCount: number;
  failedVenueIds: string[];
  /** Age of the most recent snapshot in ms — proxy for data freshness. */
  staleMs: number | null;
  /** Epoch ms when the last live snapshot/delta arrived. */
  lastUpdateMs: number | null;
}

export type SessionNoticeKind = 'server-updated' | 'idle-warning' | 'idle-logout';

export interface SessionNotice {
  kind: SessionNoticeKind;
  /** Only set for 'idle-warning' — epoch ms when hard logout will fire. */
  autoLogoutAtMs?: number;
}

interface AppState {
  underlying: string;
  expiry: string;
  activeTab: 'chain' | 'surface' | 'gex' | 'flow' | 'analytics' | 'architect' | 'trading' | 'alpha';
  activeVenues: string[];
  myIv: string;
  feedStatus: FeedStatus;
  apiKey: string | null;
  userId: string | null;
  accountId: string | null;
  sessionNotice: SessionNotice | null;
  /** Monotonic counter — incremented by the warning dialog's "Stay active" button
   * so the idle-timeout hook can observe the request and cancel pending timers. */
  sessionExtendToken: number;

  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setActiveTab: (t: 'chain' | 'surface' | 'gex' | 'flow' | 'analytics' | 'architect' | 'trading' | 'alpha') => void;
  toggleVenue: (venueId: string) => void;
  setActiveVenues: (venues: string[]) => void;
  setMyIv: (iv: string) => void;
  setFeedStatus: (s: Partial<FeedStatus>) => void;
  setAuth: (apiKey: string, userId: string, accountId: string) => void;
  clearAuth: () => void;
  setSessionNotice: (notice: SessionNotice | null) => void;
  extendSession: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  underlying: 'BTC',
  expiry: '',
  activeTab: 'chain',
  activeVenues: [...VENUE_IDS],
  myIv: '',
  feedStatus: {
    connectionState: 'closed',
    failedVenueCount: 0,
    failedVenueIds: [],
    staleMs: null,
    lastUpdateMs: null,
  },
  apiKey: localStorage.getItem('paperApiKey'),
  userId: localStorage.getItem('paperUserId'),
  accountId: localStorage.getItem('paperAccountId'),
  sessionNotice: null,
  sessionExtendToken: 0,

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
  setSessionNotice: (sessionNotice) => set({ sessionNotice }),
  extendSession: () => set((s) => ({ sessionExtendToken: s.sessionExtendToken + 1 })),
}));
