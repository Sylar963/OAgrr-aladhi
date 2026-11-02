import type { TabId } from '@lib/tabs';
import { VENUE_IDS } from '@lib/venue-meta';
import type {
  SystemAnnouncement,
  VenueFailure,
  VenueId,
  WsConnectionState,
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

export type TradfiPage = 'chain' | 'builder' | 'gex' | 'alpha' | 'vol' | 'sectors';
export type BuilderVariant = 'v1' | 'v2' | 'v3';

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
  /** Age of the newest quote on the slowest venue, in ms. */
  staleMs: number | null;
  /** Age of each venue's newest quote, in ms. */
  venueLagMs: Record<string, number>;
  /** Epoch ms when the last live snapshot/delta arrived. */
  lastUpdateMs: number | null;
}

export type SessionNoticeKind = 'server-updated' | 'idle-warning' | 'idle-logout';

export interface SessionNotice {
  kind: SessionNoticeKind;
  /** Only set for 'idle-warning' — epoch ms when hard logout will fire. */
  autoLogoutAtMs?: number;
  /** Only set for 'server-updated' — epoch ms when the page auto-reloads. */
  reloadAtMs?: number;
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

export interface MarketContext {
  underlying: string;
  expiry: string;
  activeVenues: string[];
  myIv: string;
}

/** Fixed tabs share this context so the ticker carries between them. */
export const MAIN_MARKET_ID = 'main';

export interface MarketTarget {
  underlying?: string;
  expiry?: string;
}

interface AppState {
  markets: { [MAIN_MARKET_ID]: MarketContext; [id: string]: MarketContext };
  activeMarketId: string;
  activeTab: TabId;
  assetMode: 'crypto' | 'tradfi';
  tradfiUnderlying: string;
  tradfiExpiry: string;
  tradfiPage: TradfiPage;
  builderVariant: BuilderVariant;
  feedStatus: FeedStatus;
  accountId: string | null;
  activeContext: ActiveContext;
  configuredVenueIds: VenueId[];
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
  /** Jump to a widget from inside a feature, carrying any market change along with the jump. */
  navigateToWidget: (kind: TabId, target?: MarketTarget) => void;
  setAssetMode: (m: 'crypto' | 'tradfi') => void;
  setTradfiUnderlying: (u: string) => void;
  setTradfiExpiry: (e: string) => void;
  setTradfiPage: (p: TradfiPage) => void;
  setBuilderVariant: (variant: BuilderVariant) => void;
  toggleVenue: (venueId: string) => void;
  setActiveVenues: (venues: string[]) => void;
  setMyIv: (iv: string) => void;
  setFeedStatus: (s: Partial<FeedStatus>) => void;
  activateAccountSession: (accountId: string, configuredVenueIds: VenueId[]) => void;
  clearAccountSession: () => void;
  setActiveContext: (ctx: ActiveContext) => void;
  markVenueConfigured: (venue: VenueId) => void;
  markVenueUnconfigured: (venue: VenueId) => void;
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

export function selectActiveMarket(s: Pick<AppState, 'markets' | 'activeMarketId'>): MarketContext {
  return s.markets[s.activeMarketId] ?? s.markets[MAIN_MARKET_ID];
}

function patchActiveMarket(
  s: Pick<AppState, 'markets' | 'activeMarketId'>,
  patch: Partial<MarketContext>,
): Pick<AppState, 'markets'> {
  return { markets: { ...s.markets, [s.activeMarketId]: { ...selectActiveMarket(s), ...patch } } };
}

function marketPatchFromTarget(target: MarketTarget): Partial<MarketContext> {
  if (target.underlying != null) {
    return { underlying: target.underlying, expiry: target.expiry ?? '' };
  }
  return target.expiry != null ? { expiry: target.expiry } : {};
}

export const useAppStore = create<AppState>((set) => ({
  markets: {
    [MAIN_MARKET_ID]: { underlying: 'BTC', expiry: '', activeVenues: [...VENUE_IDS], myIv: '' },
  },
  activeMarketId: MAIN_MARKET_ID,
  activeTab: 'chain',
  assetMode: 'crypto',
  tradfiUnderlying: '',
  tradfiExpiry: '',
  tradfiPage: 'chain',
  builderVariant: 'v1',
  feedStatus: {
    connectionState: 'closed',
    failedVenueCount: 0,
    failedVenueIds: [],
    failedVenues: [],
    venueStates: {},
    staleMs: null,
    venueLagMs: {},
    lastUpdateMs: null,
  },
  accountId: null,
  activeContext: readActiveContext(),
  configuredVenueIds: [],
  soundEnabled: readStorage('tapeSoundEnabled') === '1',
  sessionNotice: null,
  sessionExtendToken: 0,
  announcement: null,
  feedDegraded: false,
  toasts: [],
  tourActive: false,
  tourStep: 0,

  setUnderlying: (underlying) => set((s) => patchActiveMarket(s, { underlying, expiry: '' })),
  setExpiry: (expiry) => set((s) => patchActiveMarket(s, { expiry })),
  setActiveTab: (activeTab) => set({ activeTab }),
  navigateToWidget: (kind, target) =>
    set((s) => ({
      activeTab: kind,
      ...(target ? patchActiveMarket(s, marketPatchFromTarget(target)) : {}),
    })),
  setAssetMode: (assetMode) => set({ assetMode }),
  setTradfiUnderlying: (tradfiUnderlying) => set({ tradfiUnderlying, tradfiExpiry: '' }),
  setTradfiExpiry: (tradfiExpiry) => set({ tradfiExpiry }),
  setTradfiPage: (tradfiPage) => set({ tradfiPage }),
  setBuilderVariant: (builderVariant) => set({ builderVariant }),
  toggleVenue: (venueId) =>
    set((s) => {
      const { activeVenues } = selectActiveMarket(s);
      const active = activeVenues.includes(venueId)
        ? activeVenues.filter((v) => v !== venueId)
        : [...activeVenues, venueId];
      return active.length > 0 ? patchActiveMarket(s, { activeVenues: active }) : {};
    }),
  setActiveVenues: (venues) =>
    set((s) =>
      patchActiveMarket(s, { activeVenues: venues.length > 0 ? venues : VENUE_IDS.slice() }),
    ),
  setMyIv: (myIv) => set((s) => patchActiveMarket(s, { myIv })),
  setFeedStatus: (s) => set((prev) => ({ feedStatus: { ...prev.feedStatus, ...s } })),
  activateAccountSession: (accountId, configuredVenueIds) => {
    set({ accountId, configuredVenueIds });
  },
  clearAccountSession: () => {
    try {
      localStorage.removeItem('activeContext');
    } catch {}
    set({ accountId: null, configuredVenueIds: [], activeContext: { kind: 'paper' } });
  },
  setActiveContext: (activeContext) => {
    localStorage.setItem('activeContext', JSON.stringify(activeContext));
    set({ activeContext });
  },
  markVenueConfigured: (venue) => {
    set((state) => ({
      configuredVenueIds: state.configuredVenueIds.includes(venue)
        ? state.configuredVenueIds
        : [...state.configuredVenueIds, venue],
    }));
  },
  markVenueUnconfigured: (venue) => {
    set((state) => ({
      configuredVenueIds: state.configuredVenueIds.filter((configured) => configured !== venue),
    }));
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

/** Subscribes to one field of the active market, so unrelated market edits don't re-render. */
export function useMarket<T>(selector: (market: MarketContext) => T): T {
  return useAppStore((s) => selector(selectActiveMarket(s)));
}
