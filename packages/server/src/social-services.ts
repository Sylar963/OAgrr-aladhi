import { logger } from '@oggregator/core';
import { NoopSocialStore, PostgresSocialStore, type SocialStore } from '@oggregator/db';
import { type SocialVenue, SocialVenueSchema } from '@oggregator/protocol';

import { fetchClerkUsername } from './clerk-users.js';
import { derivePositionStore } from './derive-position-store.js';
import { paradexPositionStore } from './paradex-position-store.js';
import { isVenueConnected, restoreStoredVenue } from './routes/portfolio/venue-credentials.js';
import {
  BroadcastRegistry,
  type VenueAccountAccess,
  VenueEquityCache,
} from './social-broadcast.js';
import { ChatService } from './social-chat.js';
import { LeaderboardService, type MarkLookup } from './social-leaderboard.js';
import { SocialProfileService } from './social-profile.js';
import { TraderStreamService } from './social-trader-stream.js';
import { thalexPositionStore } from './thalex-position-store.js';
import {
  exchangePortfolioLedgerStore,
  quoteProvider,
  venueCredentialsStore,
} from './trading-services.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const LEDGER_LOAD_LIMIT = 500;
const CLOSED_TRADES_LIMIT = 50;

export const socialStore: SocialStore = process.env['DATABASE_URL']
  ? PostgresSocialStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopSocialStore();

const getMark: MarkLookup = (key) => quoteProvider.getMark(key);

const VENUE_STORES = {
  derive: derivePositionStore,
  thalex: thalexPositionStore,
  paradex: paradexPositionStore,
} as const;

const venueAccess: VenueAccountAccess = {
  isConnected: (accountId, venue) => isVenueConnected(accountId, venue),
  restore: (accountId, venue) => restoreStoredVenue(accountId, venue),
  keepAlive: (accountId, venue, enabled) => VENUE_STORES[venue].keepAlive(accountId, enabled),
  listLegs: (accountId, venue) => VENUE_STORES[venue].list(accountId),
  fetchEquityHistory: (accountId, venue, fromMs) =>
    VENUE_STORES[venue].fetchEquityHistory(accountId, fromMs),
  loadTrades: async (accountId, venue, limit) => {
    if (venue === 'paradex' || !exchangePortfolioLedgerStore.enabled) return null;
    return exchangePortfolioLedgerStore.loadTrades(accountId, venue, limit);
  },
  subscribe: (listener) => {
    const unsubscribes = (Object.keys(VENUE_STORES) as SocialVenue[]).map((venue) =>
      VENUE_STORES[venue].subscribe((event) => listener(event.accountId, venue)),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  },
};

const equityCache = new VenueEquityCache(venueAccess);

export const broadcastRegistry = new BroadcastRegistry(socialStore, venueAccess, logger, () =>
  leaderboardService.invalidate(),
);

export const leaderboardService = new LeaderboardService(
  broadcastRegistry,
  equityCache,
  venueAccess.listLegs,
  logger,
);

export const traderStreamService = new TraderStreamService({
  isConnected: (target) => venueAccess.isConnected(target.accountId, target.venue),
  loadEquity: (target) => equityCache.get(target.accountId, target.venue),
  listLegs: (target) => venueAccess.listLegs(target.accountId, target.venue),
  loadClosedTrades: async (target) => {
    const trades = await venueAccess.loadTrades(target.accountId, target.venue, LEDGER_LOAD_LIMIT);
    if (trades == null) return null;
    return trades
      .filter((trade) => trade.realizedPnlUsd != null && trade.realizedPnlUsd !== 0)
      .slice(0, CLOSED_TRADES_LIMIT)
      .map((trade) => ({
        id: trade.tradeId,
        underlying: trade.underlying,
        expiry: trade.expiry,
        strike: trade.strike,
        optionRight: trade.optionRight,
        direction: trade.direction,
        amount: trade.amount,
        priceUsd: trade.priceUsd,
        realizedPnlUsd: trade.realizedPnlUsd ?? 0,
        feeUsd: trade.feeUsd,
        closedAt: new Date(trade.timestampMs).toISOString(),
      }));
  },
  getMark,
});

venueAccess.subscribe((accountId, venue) => traderStreamService.onAccountEvent(accountId, venue));

async function listSocialVenues(accountId: string) {
  if (!venueCredentialsStore.enabled) return [];
  const stored = await venueCredentialsStore.listVenues(accountId);
  return stored.flatMap((raw) => {
    const parsed = SocialVenueSchema.safeParse(raw);
    return parsed.success
      ? [{ venue: parsed.data, connected: isVenueConnected(accountId, parsed.data) }]
      : [];
  });
}

export const socialProfileService = new SocialProfileService(
  socialStore,
  (clerkUserId) => fetchClerkUsername(clerkUserId),
  listSocialVenues,
  (userId) => {
    broadcastRegistry.invalidate();
    leaderboardService.invalidate();
    traderStreamService.revoke(userId);
  },
);

export const chatService = new ChatService(
  socialStore,
  {
    cachePath: process.env['SOCIAL_CHAT_CACHE_PATH'] ?? '.cache/social-chat.ndjson',
    flushIntervalMs: DAY_MS,
    historyLimit: 200,
    maxPendingMessages: 50_000,
    anonSecret: process.env['SOCIAL_CHAT_ANON_SECRET'] ?? null,
    minIntervalMs: 1_500,
    maxPerMinute: 12,
  },
  logger,
);

export function isSocialEnabled(): boolean {
  return socialStore.enabled;
}

export function startSocialServices(): void {
  if (!socialStore.enabled) return;
  chatService.start();
  broadcastRegistry.start();
}

export async function disposeSocialServices(): Promise<void> {
  chatService.dispose();
  traderStreamService.dispose();
  broadcastRegistry.dispose();
  await socialStore.dispose();
}
