import type { TabId } from '@lib/tabs';
import {
  loadAllVenueCreds,
  removeVenueCreds as storageRemoveVenueCreds,
  saveVenueCreds as storageSaveVenueCreds,
} from '@lib/venue-credentials';
import { VENUE_IDS } from '@lib/venue-meta';
import {
  VENUE_IDS as PROTOCOL_VENUE_IDS,
  type SystemAnnouncement,
  type VenueCredentials,
  type VenueFailure,
  type VenueId,
  type WsConnectionState,
} from '@oggregator/protocol';
import { create } from 'zustand';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export type ActiveContext = { kind: 'paper' | 'challenge' | 'thalex'; runId?: string };

export type TradfiPage = 'chain' | 'gex';

function readActiveContext(): ActiveContext {
  const raw = readStorage('activeContext');
  if (!raw) return { kind: 'paper' };
  try {
    const parsed = JSON.parse(raw) as ActiveContext;
    if (
      parsed &&
      (parsed.kind === 'paper' || parsed.kind === 'challenge' || parsed.kind === 'thalex')
    ) {
      return parsed;
    }
  } catch {
    // fall through to default
  }
  return { kind: 'paper' };
}

export interface FeedStatus {
  connectionState: WsConnectionState;
  failedVenueCount: number;
  failedVenueIds: string[];
  failedVenues: VenueFailure[];
  /** Per-venue connection state from live `status` WS events. */
  venueStates: Record<string, WsConnectionState>;
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

export type ToastTone = 'info' | 'success' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  icon: string;
  text: string;
  createdAt: number;
}

export interface ToastInput {
  tone: ToastTone;
  icon: string;
  text: string;
  id?: string;
}

interface AppState {
  underlying: string;
  expiry: string;
  activeTab: TabId;
  assetMode: 'crypto' | 'tradfi';
  tradfiUnderlying: string;
  tradfiExpiry: string;
  tradfiPage: TradfiPage;
  activeVenues: string[];
  myIv: string;
  feedStatus: FeedStatus;
  accountId: string | null;
  activeContext: ActiveContext;
  venueCreds: Partial<Record<VenueId, VenueCredentials>>;
  soundEnabled: boolean;
  sessionNotice: SessionNotice | null;
  /** Monotonic counter — incremented by the warning dialog's "Stay active" button
   * so the idle-timeout hook can observe the request and cancel pending timers. */
  sessionExtendToken: number;
  announcement: SystemAnnouncement | null;
  feedDegraded: boolean;
  toasts: Toast[];
  tourActive: boolean;
  tourStep: number;

  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setActiveTab: (t: TabId) => void;
  setAssetMode: (m: 'crypto' | 'tradfi') => void;
  setTradfiUnderlying: (u: string) => void;
  setTradfiExpiry: (e: string) => void;
  setTradfiPage: (p: TradfiPage) => void;
  toggleVenue: (venueId: string) => void;
  setActiveVenues: (venues: string[]) => void;
  setMyIv: (iv: string) => void;
  setFeedStatus: (s: Partial<FeedStatus>) => void;
  setAccountId: (accountId: string) => void;
  clearAccount: () => void;
  setActiveContext: (ctx: ActiveContext) => void;
  setVenueCreds: (creds: VenueCredentials) => void;
  removeVenueCreds: (venue: VenueId) => void;
  setSessionNotice: (notice: SessionNotice | null) => void;
  extendSession: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setAnnouncement: (a: SystemAnnouncement | null) => void;
  setFeedDegraded: (degraded: boolean) => void;
  pushToast: (toast: ToastInput) => void;
  dismissToast: (id: string) => void;
  startTour: () => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  underlying: 'BTC',
  expiry: '',
  activeTab: 'chain',
  assetMode: 'crypto',
  tradfiUnderlying: '',
  tradfiExpiry: '',
  tradfiPage: 'chain',
  activeVenues: [...VENUE_IDS],
  myIv: '',
  feedStatus: {
    connectionState: 'closed',
    failedVenueCount: 0,
    failedVenueIds: [],
    failedVenues: [],
    venueStates: {},
    staleMs: null,
    lastUpdateMs: null,
  },
  accountId: readStorage('paperAccountId'),
  activeContext: readActiveContext(),
  venueCreds: loadAllVenueCreds(PROTOCOL_VENUE_IDS),
  soundEnabled: readStorage('tapeSoundEnabled') === '1',
  sessionNotice: null,
  sessionExtendToken: 0,
  announcement: null,
  feedDegraded: false,
  toasts: [],
  tourActive: false,
  tourStep: 0,

  setUnderlying: (underlying) => set({ underlying, expiry: '' }),
  setExpiry: (expiry) => set({ expiry }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setAssetMode: (assetMode) => set({ assetMode }),
  setTradfiUnderlying: (tradfiUnderlying) => set({ tradfiUnderlying, tradfiExpiry: '' }),
  setTradfiExpiry: (tradfiExpiry) => set({ tradfiExpiry }),
  setTradfiPage: (tradfiPage) => set({ tradfiPage }),
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
  setAccountId: (accountId) => {
    localStorage.setItem('paperAccountId', accountId);
    set({ accountId });
  },
  clearAccount: () => {
    localStorage.removeItem('paperAccountId');
    set({ accountId: null });
  },
  setActiveContext: (activeContext) => {
    localStorage.setItem('activeContext', JSON.stringify(activeContext));
    set({ activeContext });
  },
  setVenueCreds: (creds) => {
    storageSaveVenueCreds(creds);
    set((s) => ({ venueCreds: { ...s.venueCreds, [creds.venue]: creds } }));
  },
  removeVenueCreds: (venue) => {
    storageRemoveVenueCreds(venue);
    set((s) => {
      const next = { ...s.venueCreds };
      delete next[venue];
      return { venueCreds: next };
    });
  },
  setSessionNotice: (sessionNotice) => set({ sessionNotice }),
  extendSession: () => set((s) => ({ sessionExtendToken: s.sessionExtendToken + 1 })),
  setAnnouncement: (announcement) => set({ announcement }),
  setFeedDegraded: (feedDegraded) => set({ feedDegraded }),
  pushToast: (toast) =>
    set((prev) => {
      const now = Date.now();
      return {
        toasts: [
          ...prev.toasts,
          {
            id: toast.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
            tone: toast.tone,
            icon: toast.icon,
            text: toast.text,
            createdAt: now,
          },
        ],
      };
    }),
  dismissToast: (id) => set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),
  startTour: () => set({ tourActive: true, tourStep: 0 }),
  endTour: () => set({ tourActive: false, tourStep: 0 }),
  nextStep: () => set((s) => ({ tourStep: s.tourStep + 1 })),
  prevStep: () => set((s) => ({ tourStep: Math.max(0, s.tourStep - 1) })),
  setSoundEnabled: (enabled) => {
    if (enabled) localStorage.setItem('tapeSoundEnabled', '1');
    else localStorage.removeItem('tapeSoundEnabled');
    set({ soundEnabled: enabled });
  },
}));
