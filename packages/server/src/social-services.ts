import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@oggregator/core';
import {
  NoopSocialStore,
  PostgresSocialStore,
  type SocialStore,
  type UserProfileRow,
} from '@oggregator/db';
import type { SocialProfileDto } from '@oggregator/protocol';
import type { FastifyBaseLogger } from 'fastify';

import { fetchClerkUsername } from './clerk-users.js';
import { paperEvents } from './routes/paper/events.js';
import { listTradeSummaries } from './routes/paper/workspace.js';
import { ChatService } from './social-chat.js';
import {
  captureEquitySnapshots,
  LeaderboardService,
  type MarkLookup,
  utcDay,
} from './social-leaderboard.js';
import { TraderStreamService } from './social-trader-stream.js';
import { quoteProvider } from './trading-services.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_MINUTE_UTC = 5;
const SNAPSHOT_STARTUP_DELAY_MS = 10 * 60_000;
const CLOSED_TRADES_LIMIT = 50;

export const socialStore: SocialStore = process.env['DATABASE_URL']
  ? PostgresSocialStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopSocialStore();

const getMark: MarkLookup = (key) => quoteProvider.getMark(key);

export const leaderboardService = new LeaderboardService(socialStore, getMark);

const DEFAULT_PROFILE: SocialProfileDto = {
  handle: null,
  leaderboardVisible: false,
  consentedAt: null,
};

export class UsernameRequiredError extends Error {
  constructor() {
    super('Set a username on your account to join the leaderboard');
    this.name = 'UsernameRequiredError';
  }
}

export interface SocialUser {
  id: string;
  clerkUserId: string;
}

type UsernameLookup = (clerkUserId: string) => Promise<string | null | undefined>;

function toDto(row: UserProfileRow): SocialProfileDto {
  return {
    handle: row.handle,
    leaderboardVisible: row.leaderboardVisible,
    consentedAt: row.consentedAt?.toISOString() ?? null,
  };
}

/**
 * The handle is the account username, re-read from Clerk whenever the Social tab loads; the
 * database is written only when it or the leaderboard opt-in changes. Profiles are cached per
 * process because every chat connect and named post reads one.
 */
export class SocialProfileService {
  private readonly cache = new Map<string, SocialProfileDto>();

  constructor(
    private readonly store: Pick<SocialStore, 'getProfile' | 'upsertProfile'>,
    private readonly lookupUsername: UsernameLookup,
    private readonly onChange: (userId: string, profile: SocialProfileDto) => void,
  ) {}

  async get(userId: string): Promise<SocialProfileDto> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    const row = await this.store.getProfile(userId);
    const profile = row ? toDto(row) : DEFAULT_PROFILE;
    this.cache.set(userId, profile);
    return profile;
  }

  async sync(user: SocialUser): Promise<SocialProfileDto> {
    const current = await this.get(user.id);
    const username = await this.lookupUsername(user.clerkUserId);
    if (username === undefined || username === current.handle) return current;
    return this.save(user.id, username, username ? current.leaderboardVisible : false);
  }

  async setLeaderboardVisible(user: SocialUser, visible: boolean): Promise<SocialProfileDto> {
    const current = await this.sync(user);
    if (visible && !current.handle) throw new UsernameRequiredError();
    if (current.leaderboardVisible === visible) return current;
    return this.save(user.id, current.handle, visible);
  }

  private async save(
    userId: string,
    handle: string | null,
    leaderboardVisible: boolean,
  ): Promise<SocialProfileDto> {
    const row = await this.store.upsertProfile({ userId, handle, leaderboardVisible });
    const profile = row ? toDto(row) : { ...DEFAULT_PROFILE, handle, leaderboardVisible };
    if (handle) {
      const wanted = handle.toLowerCase();
      for (const [otherId, other] of this.cache) {
        if (otherId !== userId && other.handle?.toLowerCase() === wanted)
          this.cache.delete(otherId);
      }
    }
    this.cache.set(userId, profile);
    this.onChange(userId, profile);
    return profile;
  }
}

export const traderStreamService = new TraderStreamService({
  loadBook: (accountId) => socialStore.getAccountBook(accountId),
  loadClosedTrades: async (accountId) =>
    (await listTradeSummaries('closed', CLOSED_TRADES_LIMIT, accountId)).map((trade) => ({
      id: trade.id,
      underlying: trade.underlying,
      label: trade.label,
      strategyName: trade.strategyName,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      realizedPnlUsd: trade.realizedPnlUsd,
      feesUsd: trade.feesUsd,
    })),
  loadEquityHistory: (accountId) => socialStore.listEquityHistory(accountId),
  getMark,
});

paperEvents.subscribe((accountId) => traderStreamService.onAccountEvent(accountId));

export const socialProfileService = new SocialProfileService(
  socialStore,
  (clerkUserId) => fetchClerkUsername(clerkUserId),
  (userId) => {
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

const snapshotMarkerPath =
  process.env['SOCIAL_EQUITY_SNAPSHOT_MARKER_PATH'] ?? '.cache/paper-equity-snapshot.last';
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function lastSnapshotDay(): string | null {
  if (!existsSync(snapshotMarkerPath)) return null;
  return readFileSync(snapshotMarkerPath, 'utf8').trim() || null;
}

export function nextSnapshotBoundary(nowMs: number): number {
  const now = new Date(nowMs);
  const boundary = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    SNAPSHOT_MINUTE_UTC,
  );
  return boundary > nowMs ? boundary : boundary + DAY_MS;
}

async function runSnapshot(log: FastifyBaseLogger): Promise<void> {
  const nowMs = Date.now();
  try {
    const written = await captureEquitySnapshots(socialStore, getMark, nowMs);
    mkdirSync(dirname(snapshotMarkerPath), { recursive: true });
    writeFileSync(snapshotMarkerPath, `${utcDay(nowMs)}\n`);
    log.info({ day: utcDay(nowMs), written }, 'paper equity snapshots captured');
  } catch (err) {
    log.warn({ err: String(err) }, 'paper equity snapshot failed');
  }
}

function scheduleSnapshot(log: FastifyBaseLogger, delayMs: number): void {
  snapshotTimer = setTimeout(() => {
    void runSnapshot(log).finally(() =>
      scheduleSnapshot(log, nextSnapshotBoundary(Date.now()) - Date.now()),
    );
  }, delayMs);
  snapshotTimer.unref?.();
}

/** One equity snapshot batch per UTC day, caught up shortly after boot if today's was missed. */
export function startSocialServices(log: FastifyBaseLogger): void {
  if (!socialStore.enabled) return;
  chatService.start();
  if (snapshotTimer) return;
  const nowMs = Date.now();
  const missedToday = lastSnapshotDay() !== utcDay(nowMs);
  scheduleSnapshot(
    log,
    missedToday ? SNAPSHOT_STARTUP_DELAY_MS : nextSnapshotBoundary(nowMs) - nowMs,
  );
}

export async function disposeSocialServices(): Promise<void> {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  chatService.dispose();
  traderStreamService.dispose();
  await socialStore.dispose();
}
