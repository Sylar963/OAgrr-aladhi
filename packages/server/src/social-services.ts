import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@oggregator/core';
import { NoopSocialStore, PostgresSocialStore, type SocialStore } from '@oggregator/db';
import type { SocialProfileDto, UpdateSocialProfileRequest } from '@oggregator/protocol';
import type { FastifyBaseLogger } from 'fastify';

import { ChatService } from './social-chat.js';
import {
  captureEquitySnapshots,
  LeaderboardService,
  type MarkLookup,
  utcDay,
} from './social-leaderboard.js';
import { quoteProvider } from './trading-services.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_MINUTE_UTC = 5;
const SNAPSHOT_STARTUP_DELAY_MS = 10 * 60_000;

export const socialStore: SocialStore = process.env['DATABASE_URL']
  ? PostgresSocialStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopSocialStore();

const getMark: MarkLookup = (key) => quoteProvider.getMark(key);

export const leaderboardService = new LeaderboardService(socialStore, getMark);

const DEFAULT_PROFILE: SocialProfileDto = { handle: null, leaderboardVisible: false };

/** Profiles change rarely and are read on every chat connect, so each is loaded once per process. */
export class SocialProfileService {
  private readonly cache = new Map<string, SocialProfileDto>();

  constructor(
    private readonly store: Pick<SocialStore, 'getProfile' | 'upsertProfile'>,
    private readonly onChange: () => void,
  ) {}

  async get(userId: string): Promise<SocialProfileDto> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    const row = await this.store.getProfile(userId);
    const profile = row
      ? { handle: row.handle, leaderboardVisible: row.leaderboardVisible }
      : DEFAULT_PROFILE;
    this.cache.set(userId, profile);
    return profile;
  }

  async update(userId: string, request: UpdateSocialProfileRequest): Promise<SocialProfileDto> {
    const row = await this.store.upsertProfile({ userId, ...request });
    const profile = row
      ? { handle: row.handle, leaderboardVisible: row.leaderboardVisible }
      : { ...request };
    this.cache.set(userId, profile);
    this.onChange();
    return profile;
  }
}

export const socialProfileService = new SocialProfileService(socialStore, () =>
  leaderboardService.invalidate(),
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
  await socialStore.dispose();
}
