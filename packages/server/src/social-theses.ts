import type { PublicThesisDto, PublicThesisFeed } from "@oggregator/protocol";

import type { SharedThesis } from "./thesis-service.js";

type FeedEntry = Omit<PublicThesisDto, "isMe"> & { userId: string };

export interface SocialThesisFeedOptions {
  shared: (limit: number) => Promise<SharedThesis[]>;
  handleOf: (userId: string) => Promise<string | null>;
  limit: number;
  ttlMs: number;
  now?: () => number;
}

/**
 * Every viewer reads the same feed, and building it re-evaluates each active thesis against
 * candles, so one build is shared for `ttlMs`. Authors without a username drop out of the feed.
 */
export class SocialThesisFeed {
  private cached: { at: number; entries: FeedEntry[] } | null = null;
  private building: Promise<FeedEntry[]> | null = null;
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: SocialThesisFeedOptions) {
    this.now = options.now ?? Date.now;
  }

  async get(viewerId: string): Promise<PublicThesisFeed> {
    const entries = await this.entries();
    return {
      generatedAt: this.cached?.at ?? this.now(),
      theses: entries.map(({ userId, ...entry }) => ({
        ...entry,
        isMe: userId === viewerId,
      })),
    };
  }

  invalidate(): void {
    this.cached = null;
    this.building = null;
    this.generation += 1;
  }

  private entries(): Promise<FeedEntry[]> {
    if (this.cached && this.now() - this.cached.at < this.options.ttlMs) {
      return Promise.resolve(this.cached.entries);
    }
    if (this.building) return this.building;
    const building = this.build(this.generation).finally(() => {
      if (this.building === building) this.building = null;
    });
    this.building = building;
    return building;
  }

  private async build(generation: number): Promise<FeedEntry[]> {
    const startedAt = this.now();
    const shared = await this.options.shared(this.options.limit);
    const handles = new Map<string, string | null>();
    for (const { thesis } of shared) {
      if (!handles.has(thesis.share.userId)) {
        handles.set(
          thesis.share.userId,
          await this.options.handleOf(thesis.share.userId),
        );
      }
    }
    const entries = shared.flatMap(
      ({ thesis, status, spotUsd }): FeedEntry[] => {
        const handle = handles.get(thesis.share.userId);
        if (!handle) return [];
        return [
          {
            id: thesis.id,
            userId: thesis.share.userId,
            handle,
            underlying: thesis.underlying,
            direction: thesis.direction,
            horizonExpiry: thesis.horizonExpiry,
            level: thesis.level,
            confirmSec: thesis.confirmSec,
            reason: thesis.reason,
            state: thesis.state,
            status: status?.status ?? null,
            roomPct: status?.roomPct ?? null,
            spotAtCreation: thesis.contextAtCreation.spotUsd,
            spotUsd,
            createdAt: thesis.createdAt,
            sharedAt: thesis.share.sharedAt,
            endedAt: thesis.endedAt,
            endNote: thesis.endNote,
          },
        ];
      },
    );
    if (generation === this.generation)
      this.cached = { at: startedAt, entries };
    return entries;
  }
}
