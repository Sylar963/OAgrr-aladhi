import type { PositionLeg } from '@oggregator/core';
import type {
  EquityHistoryPoint,
  LeaderboardEntryDto,
  LeaderboardPeriod,
  LeaderboardResponse,
  SocialVenue,
} from '@oggregator/protocol';

import {
  type Broadcaster,
  type BroadcastRegistry,
  summarizeEquity,
  type VenueEquityCache,
} from './social-broadcast.js';

const LEADERBOARD_TTL_MS = 5 * 60_000;
const LEADERBOARD_MAX_ENTRIES = 100;

export type MarkLookup = (key: {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}) => Promise<number | null>;

export interface MemberSnapshot {
  broadcaster: Broadcaster;
  points: EquityHistoryPoint[];
  openPositions: number;
}

interface RankedEntry extends Omit<LeaderboardEntryDto, 'isMe'> {
  userId: string;
}

export function rankEntries(
  members: MemberSnapshot[],
  period: LeaderboardPeriod,
  nowMs: number,
): RankedEntry[] {
  const rows: Array<Omit<RankedEntry, 'rank'>> = [];
  for (const member of members) {
    const summary = summarizeEquity(member.points, period, nowMs);
    if (!summary) continue;
    rows.push({
      userId: member.broadcaster.userId,
      handle: member.broadcaster.handle,
      venue: member.broadcaster.venue,
      equityUsd: summary.equityUsd,
      equityAsOf: new Date(summary.equityAsOf).toISOString(),
      pnlUsd: summary.pnlUsd,
      returnPct: summary.returnPct,
      since: new Date(summary.since).toISOString(),
      sharingSince: member.broadcaster.sharingSince.toISOString(),
      openPositions: member.openPositions,
    });
  }
  rows.sort((a, b) => b.returnPct - a.returnPct || b.pnlUsd - a.pnlUsd);
  return rows.slice(0, LEADERBOARD_MAX_ENTRIES).map((row, index) => ({ ...row, rank: index + 1 }));
}

interface LeaderboardCache {
  generatedAt: number;
  members: MemberSnapshot[];
}

/**
 * Ranks members by the equity history their connected venue account reports. Built on demand and
 * cached for five minutes; members whose venue is not connected are left out until it is.
 */
export class LeaderboardService {
  private current: LeaderboardCache | null = null;
  private inflight: Promise<LeaderboardCache> | null = null;
  private generation = 0;

  constructor(
    private readonly registry: Pick<BroadcastRegistry, 'live'>,
    private readonly equity: Pick<VenueEquityCache, 'get'>,
    private readonly listLegs: (accountId: string, venue: SocialVenue) => PositionLeg[],
    private readonly log: { warn: (obj: object, msg: string) => void },
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LEADERBOARD_TTL_MS,
  ) {}

  invalidate(): void {
    this.current = null;
    this.generation += 1;
  }

  async get(period: LeaderboardPeriod, viewerUserId: string | null): Promise<LeaderboardResponse> {
    const cache = await this.load();
    const entries = rankEntries(cache.members, period, cache.generatedAt);
    return {
      period,
      generatedAt: new Date(cache.generatedAt).toISOString(),
      entries: entries.map(({ userId, ...entry }) => ({ ...entry, isMe: userId === viewerUserId })),
    };
  }

  private load(): Promise<LeaderboardCache> {
    if (this.current && this.now() - this.current.generatedAt < this.ttlMs) {
      return Promise.resolve(this.current);
    }
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    this.inflight = (async () => {
      const live = await this.registry.live();
      const histories = await Promise.allSettled(
        live.map((member) => this.equity.get(member.accountId, member.venue)),
      );
      const members: MemberSnapshot[] = [];
      for (const [index, result] of histories.entries()) {
        const broadcaster = live[index]!;
        if (result.status === 'rejected') {
          this.log.warn(
            { venue: broadcaster.venue, handle: broadcaster.handle, err: String(result.reason) },
            'leaderboard equity history failed',
          );
          continue;
        }
        if (!result.value) continue;
        members.push({
          broadcaster,
          points: result.value.points,
          openPositions: this.listLegs(broadcaster.accountId, broadcaster.venue).length,
        });
      }
      const next: LeaderboardCache = { generatedAt: this.now(), members };
      // A profile change during the load must not be hidden behind this result for a full TTL.
      if (generation === this.generation) this.current = next;
      return next;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
}
