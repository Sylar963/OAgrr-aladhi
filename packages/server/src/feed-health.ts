// Aggregates per-venue liveness across all live data runtimes (spot, flow,
// block-flow) into a single shape the health/ready routes can consume. The
// underlying runtimes already track lastMessageAt / lastSuccessAt per stream;
// this module rolls them up per-venue and computes a global liveness signal so
// /api/ready can fail loudly when the process is alive but every feed is silent
// — the silent-failure mode that the 2h restart cron was masking.

import type { SpotRuntime } from '@oggregator/core';
import type { BlockTradeRuntime, OptionVenueAdapter, TradeRuntime } from '@oggregator/core';

export type FeedSource = 'spot' | 'flow' | 'blockFlow' | 'chain';

export interface VenueFeedHealth {
  venue: string;
  sources: FeedSource[];
  connected: boolean;
  lastMessageAt: number | null;
  lastMessageAgeMs: number | null;
  reconnects: number;
  errors: number;
}

export interface FeedHealthSummary {
  totalVenues: number;
  connectedVenues: number;
  // Newest `lastMessageAt` across every (venue, source) pair, expressed as age
  // in ms. This is the canonical liveness signal — if it grows unbounded, the
  // process is alive but no feed is producing data anywhere.
  lastAnyMessageAgeMs: number | null;
}

export interface FeedHealthSnapshot {
  summary: FeedHealthSummary;
  venues: VenueFeedHealth[];
}

export interface FeedHealthSources {
  spot: Pick<SpotRuntime, 'getHealth'>;
  flow: Pick<TradeRuntime, 'getHealth'>;
  blockFlow: Pick<BlockTradeRuntime, 'getHealth'>;
  chain?: ReadonlyArray<Pick<OptionVenueAdapter, 'venue' | 'getFeedDiagnostics'>>;
}

// Bybit's REST spot poller is venue-agnostic upstream but it's the only source
// of spot prices in this server, so attribute it to bybit for the rollup.
const SPOT_VENUE = 'bybit';

interface PerVenueAccumulator {
  sources: Set<FeedSource>;
  connected: boolean;
  lastMessageAt: number | null;
  reconnects: number;
  errors: number;
}

export function getFeedHealthSnapshot(
  sources: FeedHealthSources,
  now: number = Date.now(),
): FeedHealthSnapshot {
  const byVenue = new Map<string, PerVenueAccumulator>();

  const upsert = (
    venue: string,
    source: FeedSource,
    patch: {
      connected: boolean;
      lastMessageAt: number | null;
      reconnects?: number;
      errors?: number;
    },
  ) => {
    const current = byVenue.get(venue) ?? {
      sources: new Set<FeedSource>(),
      connected: false,
      lastMessageAt: null,
      reconnects: 0,
      errors: 0,
    };
    current.sources.add(source);
    current.connected = current.connected || patch.connected;
    if (
      patch.lastMessageAt != null &&
      (current.lastMessageAt == null || patch.lastMessageAt > current.lastMessageAt)
    ) {
      current.lastMessageAt = patch.lastMessageAt;
    }
    current.reconnects += patch.reconnects ?? 0;
    current.errors += patch.errors ?? 0;
    byVenue.set(venue, current);
  };

  // Spot is a single REST poller; lastSuccessAt is the only liveness field.
  const spotHealth = sources.spot.getHealth();
  upsert(SPOT_VENUE, 'spot', {
    connected: spotHealth.connected,
    lastMessageAt: spotHealth.lastSuccessAt,
    errors: spotHealth.errors,
  });

  // Flow is per (venue, underlying). Multiple rows per venue — fold them by
  // taking the freshest lastMessageAt and OR'ing connected flags.
  for (const row of sources.flow.getHealth()) {
    upsert(row.venue, 'flow', {
      connected: row.connected,
      lastMessageAt: row.lastMessageAt,
      reconnects: row.reconnects,
      errors: row.errors,
    });
  }

  // Block-flow is per venue (single row per venue).
  for (const row of sources.blockFlow.getHealth()) {
    upsert(row.venue, 'blockFlow', {
      connected: row.connected,
      lastMessageAt: row.lastSuccessAt,
      reconnects: row.reconnects,
      errors: row.errors,
    });
  }

  // Chain WS adapters surface JsonRpcWsClient health directly so ops can
  // verify the socket is alive, not infer from message timestamps alone.
  for (const adapter of sources.chain ?? []) {
    const diag = adapter.getFeedDiagnostics?.();
    if (diag == null) continue;
    upsert(adapter.venue, 'chain', {
      connected: diag.connected,
      lastMessageAt: diag.lastActivityAt > 0 ? diag.lastActivityAt : null,
      reconnects: diag.reconnectAttempts,
    });
  }

  const venues: VenueFeedHealth[] = [...byVenue.entries()]
    .map(([venue, acc]) => ({
      venue,
      sources: [...acc.sources].sort(),
      connected: acc.connected,
      lastMessageAt: acc.lastMessageAt,
      lastMessageAgeMs: acc.lastMessageAt == null ? null : Math.max(0, now - acc.lastMessageAt),
      reconnects: acc.reconnects,
      errors: acc.errors,
    }))
    .sort((a, b) => a.venue.localeCompare(b.venue));

  let connectedVenues = 0;
  let newestLastMessageAt: number | null = null;
  for (const v of venues) {
    if (v.connected) connectedVenues += 1;
    if (v.lastMessageAt != null && (newestLastMessageAt == null || v.lastMessageAt > newestLastMessageAt)) {
      newestLastMessageAt = v.lastMessageAt;
    }
  }

  return {
    summary: {
      totalVenues: venues.length,
      connectedVenues,
      lastAnyMessageAgeMs:
        newestLastMessageAt == null ? null : Math.max(0, now - newestLastMessageAt),
    },
    venues,
  };
}

// Default: 5 minutes without any feed message anywhere. Matches a 5-min
// candle; long enough to ride out venue maintenance and low-volume gaps,
// short enough that a stuck process gets recycled before the user reaches
// for the refresh button. Override with FEED_LIVENESS_MAX_MS.
const DEFAULT_LIVENESS_MAX_MS = 300_000;

export function getLivenessMaxMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['FEED_LIVENESS_MAX_MS'];
  if (!raw) return DEFAULT_LIVENESS_MAX_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIVENESS_MAX_MS;
  return parsed;
}

export function isFeedLivenessStale(snapshot: FeedHealthSnapshot, maxAgeMs: number): boolean {
  const age = snapshot.summary.lastAnyMessageAgeMs;
  // Null = no feed has ever produced data. Bootstrap path covers this; we only
  // flag staleness once data was seen at least once and then dried up.
  if (age == null) return false;
  return age > maxAgeMs;
}
