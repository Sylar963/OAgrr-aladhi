import { getAdapter, getRegisteredVenues } from '../../core/registry.js';
import type { BookLookup } from '../../core/dealer-book.js';
import type { EnrichedChainResponse } from '../../core/enrichment.js';
import type {
  SnapshotMeta,
  VenueDelta,
  VenueStatus,
  WsSubscriptionRequest,
} from '../../core/types.js';
import {
  VenueSubscriptionCoordinator,
  type VenueSubscriptionHandle,
  type VenueSubscriptionListener,
} from '../../core/subscription-coordinator.js';
import type { VenueId } from '../../types/common.js';
import { ChainProjection } from './projection.js';
import { VenueHealthManager } from './health.js';

const PUSH_INTERVAL_MS = 500;
const MAX_PENDING_DELTAS = 5_000;
const GEX_DELTA_MIN_INTERVAL_MS = 2_000;
const MISSED_SYMBOL_REBUILD_MIN_INTERVAL_MS = 10_000;

interface FailedVenue {
  venue: VenueId;
  reason: string;
}

interface PendingDeltaEntry {
  delta: VenueDelta;
  version: number;
}

interface SnapshotBuildResult {
  chains: Array<Awaited<ReturnType<ReturnType<typeof getAdapter>['fetchOptionChain']>> | null>;
  pendingVersionCutoff: number;
  buildVersion: number;
}

export interface ChainRuntimeSnapshotEvent {
  type: 'snapshot';
  seq: number;
  request: WsSubscriptionRequest;
  meta: SnapshotMeta;
  data: EnrichedChainResponse;
}

export interface ChainRuntimeDeltaEvent {
  type: 'delta';
  seq: number;
  request: WsSubscriptionRequest;
  meta: SnapshotMeta;
  deltas: VenueDelta[];
  patch: {
    stats: EnrichedChainResponse['stats'];
    strikes: EnrichedChainResponse['strikes'];
    gex?: EnrichedChainResponse['gex'];
  };
}

export interface ChainRuntimeStatusEvent {
  type: 'status';
  status: VenueStatus;
}

export type ChainRuntimeEvent =
  | ChainRuntimeSnapshotEvent
  | ChainRuntimeDeltaEvent
  | ChainRuntimeStatusEvent;

export interface ChainRuntimeListener {
  onEvent(event: ChainRuntimeEvent): void;
}

export interface ChainRuntimeOptions {
  coordinator?: VenueSubscriptionCoordinator;
  venueHealth?: VenueHealthManager;
  log?: {
    warn: (obj: object, msg: string) => void;
  };
  bookLookup?: BookLookup;
}

function mergeDelta(left: VenueDelta | undefined, right: VenueDelta): VenueDelta {
  if (left == null) return right;

  const merged: VenueDelta = {
    venue: right.venue,
    symbol: right.symbol,
    ts: Math.max(left.ts, right.ts),
  };

  if (left.quote != null || right.quote != null) {
    merged.quote = { ...(left.quote ?? {}), ...(right.quote ?? {}) };
  }
  if (left.greeks != null || right.greeks != null) {
    merged.greeks = { ...(left.greeks ?? {}), ...(right.greeks ?? {}) };
  }

  return merged;
}

/** Replace strikes in a strike-sorted list with patched rows; rows for unseen strikes are inserted in order. */
export function mergeEnrichedStrikes(
  existing: EnrichedChainResponse['strikes'],
  incoming: EnrichedChainResponse['strikes'],
): EnrichedChainResponse['strikes'] {
  if (incoming.length === 0) return existing;
  const incomingByStrike = new Map(incoming.map((strike) => [strike.strike, strike]));

  let replaced = 0;
  const merged = existing.map((strike) => {
    const next = incomingByStrike.get(strike.strike);
    if (next == null) return strike;
    replaced += 1;
    return next;
  });
  if (replaced === incomingByStrike.size) return merged;

  const byStrike = new Map(merged.map((strike) => [strike.strike, strike]));
  for (const strike of incoming) byStrike.set(strike.strike, strike);
  return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}

export class ChainRuntime {
  private readonly projection: ChainProjection;
  private readonly venueListener: VenueSubscriptionListener;
  private readonly handles: VenueSubscriptionHandle[] = [];
  private readonly listeners = new Set<ChainRuntimeListener>();
  private readonly pendingBySymbol = new Map<string, PendingDeltaEntry>();
  private readonly coordinator: VenueSubscriptionCoordinator;
  private readonly venueHealth: VenueHealthManager;
  private readonly log: { warn: (obj: object, msg: string) => void };
  private pushTimer: ReturnType<typeof setInterval> | null = null;
  private currentSnapshot: ChainRuntimeSnapshotEvent | null = null;
  private activeRequest: WsSubscriptionRequest;
  private failedVenues: FailedVenue[] = [];
  private seq = 0;
  private readyPromise: Promise<void> | null = null;
  private needsResync = false;
  private started = false;
  private disposed = false;
  private pendingDeltaVersion = 0;
  private snapshotBuildVersion = 0;
  private lastGexComputedAt = 0;
  private lastSnapshotBuiltAt = 0;
  private resumeBuild: Promise<void> | null = null;

  constructor(
    readonly key: string,
    readonly request: WsSubscriptionRequest,
    options: ChainRuntimeOptions = {},
  ) {
    this.activeRequest = request;
    this.projection = new ChainProjection(request.underlying, request.expiry, options.bookLookup);
    this.coordinator = options.coordinator ?? new VenueSubscriptionCoordinator();
    this.venueHealth = options.venueHealth ?? new VenueHealthManager();
    this.log = options.log ?? { warn: () => {} };
    this.venueListener = {
      onDelta: (deltas) => {
        // Drop ticks while no listener is attached — otherwise an idle engine
        // keeps buffering + re-projecting for the full idle-TTL window.
        if (this.listeners.size === 0) return;
        const firstDelta = deltas[0];
        if (firstDelta != null) {
          const lastDeltaTs = deltas.reduce((latest, delta) => Math.max(latest, delta.ts), 0);
          this.venueHealth.touch(firstDelta.venue, lastDeltaTs);
        }

        if (this.pendingBySymbol.size + deltas.length > MAX_PENDING_DELTAS) {
          this.pendingBySymbol.clear();
          this.needsResync = true;
          return;
        }

        for (const delta of deltas) {
          const deltaKey = `${delta.venue}:${delta.symbol}`;
          const version = ++this.pendingDeltaVersion;
          this.pendingBySymbol.set(deltaKey, {
            delta: mergeDelta(this.pendingBySymbol.get(deltaKey)?.delta, delta),
            version,
          });
        }
      },
      onStatus: (status) => {
        if (this.disposed) return;
        const effective = this.venueHealth.ingest(status);
        if (effective == null) return;
        this.broadcast({ type: 'status', status: effective });
      },
    };
  }

  async start(): Promise<void> {
    await this.ready();
  }

  async ready(): Promise<void> {
    if (this.readyPromise == null) {
      this.readyPromise = this.initialize();
    }
    await this.readyPromise;
  }

  subscribe(listener: ChainRuntimeListener): () => void {
    this.listeners.add(listener);
    this.ensurePushTimer();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.pausePushTimer();
    };
  }

  getSnapshot(): ChainRuntimeSnapshotEvent | null {
    return this.currentSnapshot;
  }

  getActiveRequest(): WsSubscriptionRequest {
    return this.activeRequest;
  }

  getFailedVenues(): FailedVenue[] {
    return [...this.failedVenues];
  }

  getHealth(): VenueStatus[] {
    return this.venueHealth.list();
  }

  async fetchSnapshotData(): Promise<EnrichedChainResponse> {
    await this.ready();
    // A live engine keeps currentSnapshot current via deltas; rebuilding here
    // would push a full snapshot frame to every attached listener.
    if (this.resumeBuild != null) await this.resumeBuild;
    if (this.pushTimer != null && this.currentSnapshot != null && !this.needsResync) {
      return this.currentSnapshot.data;
    }
    await this.buildSnapshot();
    const refreshed = this.currentSnapshot;
    return refreshed != null ? refreshed.data : this.projection.loadSnapshot([]);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.pushTimer != null) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }

    const handles = this.handles.splice(0, this.handles.length);
    await Promise.allSettled(handles.map(async (handle) => handle.release()));
    this.listeners.clear();
    this.pendingBySymbol.clear();
    this.currentSnapshot = null;
  }

  private async initialize(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;

    const registered = new Set(getRegisteredVenues());
    const liveVenues = this.request.venues.filter((venue) => registered.has(venue));
    this.failedVenues = this.request.venues
      .filter((venue) => !registered.has(venue))
      .map((venue) => ({ venue, reason: 'not loaded — failed during bootstrap' }));

    this.activeRequest = { ...this.request, venues: liveVenues };

    // Acquire all venues concurrently — each call may do a WS subscribe
    // round-trip, and serializing them stacks the cold-start latency. The
    // coordinator's per-venue operation queue still serializes against any
    // single venue (different runtimes acquiring the same venue), so this
    // does not slam an upstream socket.
    const acquired = await Promise.allSettled(
      liveVenues.map((venueId) =>
        this.coordinator.acquire(
          venueId,
          { underlying: this.request.underlying, expiry: this.request.expiry },
          this.venueListener,
        ),
      ),
    );

    // Release anything that resolved after dispose() — same guarantee the
    // sequential version provided.
    if (this.disposed) {
      await Promise.allSettled(
        acquired
          .filter(
            (r): r is PromiseFulfilledResult<VenueSubscriptionHandle> =>
              r.status === 'fulfilled',
          )
          .map(async (r) => r.value.release()),
      );
      return;
    }

    acquired.forEach((result, idx) => {
      const venueId = liveVenues[idx]!;
      if (result.status === 'fulfilled') {
        this.handles.push(result.value);
      } else {
        const reason =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.failedVenues.push({ venue: venueId, reason });
        this.log.warn({ venue: venueId, err: reason }, 'venue subscribe failed');
      }
    });

    await this.buildSnapshot();
    // Re-projection starts only when a listener subscribes (ensurePushTimer);
    // an engine with no consumers stays idle instead of looping every 100ms.
  }

  private ensurePushTimer(): void {
    if (this.pushTimer != null || this.disposed || this.listeners.size === 0) return;
    // Resuming after idle: ticks were dropped while paused, so refresh from the
    // venue quote stores before streaming live patches.
    const resumeBuild = this.buildSnapshot()
      .catch((error: unknown) => {
        this.log.warn({ err: String(error) }, 'snapshot rebuild failed');
      })
      .finally(() => {
        if (this.resumeBuild === resumeBuild) this.resumeBuild = null;
      });
    this.resumeBuild = resumeBuild;
    this.pushTimer = setInterval(() => {
      if (this.disposed) return;
      if (this.needsResync) {
        this.needsResync = false;
        void this.buildSnapshot();
        return;
      }
      if (this.pendingBySymbol.size > 0) {
        this.pushDelta();
      }
    }, PUSH_INTERVAL_MS);
  }

  private pausePushTimer(): void {
    if (this.pushTimer != null) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }
    this.pendingBySymbol.clear();
  }

  private async buildSnapshot(): Promise<void> {
    const result = await this.fetchSnapshotBuildResult();
    if (result == null || this.disposed) return;
    if (result.buildVersion !== this.snapshotBuildVersion) return;

    for (const chain of result.chains) {
      if (chain == null) continue;
      let latestQuoteTs = 0;
      for (const contract of Object.values(chain.contracts)) {
        const ts = contract.quote.timestamp ?? 0;
        if (ts > latestQuoteTs) latestQuoteTs = ts;
      }
      if (latestQuoteTs > 0) {
        this.venueHealth.touch(chain.venue, latestQuoteTs);
      }
    }

    for (const [key, entry] of this.pendingBySymbol) {
      if (entry.version <= result.pendingVersionCutoff) {
        this.pendingBySymbol.delete(key);
      }
    }

    this.needsResync = false;
    const enriched = this.projection.loadSnapshot(result.chains.filter((chain) => chain != null));
    this.seq += 1;
    this.lastGexComputedAt = Date.now();
    this.lastSnapshotBuiltAt = this.lastGexComputedAt;

    const snapshot: ChainRuntimeSnapshotEvent = {
      type: 'snapshot',
      seq: this.seq,
      request: this.activeRequest,
      meta: this.projection.buildSnapshotMeta(),
      data: enriched,
    };

    this.currentSnapshot = snapshot;
    this.broadcast(snapshot);
  }

  private async fetchSnapshotBuildResult(): Promise<SnapshotBuildResult | null> {
    if (this.disposed) return null;

    const buildVersion = ++this.snapshotBuildVersion;
    const pendingVersionCutoff = this.pendingDeltaVersion;
    const chains = await Promise.all(
      this.activeRequest.venues.map(async (venueId) => {
        try {
          return await getAdapter(venueId).fetchOptionChain(this.activeRequest);
        } catch {
          return null;
        }
      }),
    );

    return {
      chains,
      pendingVersionCutoff,
      buildVersion,
    };
  }

  private pushDelta(): void {
    if (this.disposed || this.pendingBySymbol.size === 0) return;

    const entries = [...this.pendingBySymbol.entries()];
    const deltas = entries.map(([, entry]) => entry.delta);
    for (const [key, entry] of entries) {
      if (this.pendingBySymbol.get(key)?.version === entry.version) {
        this.pendingBySymbol.delete(key);
      }
    }
    const now = Date.now();
    const includeGex = now - this.lastGexComputedAt >= GEX_DELTA_MIN_INTERVAL_MS;
    const patch = this.projection.applyDeltas(deltas, { includeGex });

    if (
      this.projection.needsReload() &&
      now - this.lastSnapshotBuiltAt >= MISSED_SYMBOL_REBUILD_MIN_INTERVAL_MS
    ) {
      this.lastSnapshotBuiltAt = now;
      void this.buildSnapshot().catch((error: unknown) => {
        this.log.warn({ err: String(error) }, 'snapshot rebuild failed');
      });
    }
    if (patch == null) return;
    if (patch.patch.gex != null) this.lastGexComputedAt = now;

    this.seq += 1;
    const snapshot = this.currentSnapshot;
    const event: ChainRuntimeDeltaEvent = {
      type: 'delta',
      seq: this.seq,
      request: this.activeRequest,
      meta: patch.meta,
      deltas: patch.deltas,
      patch: patch.patch,
    };

    this.currentSnapshot =
      snapshot == null
        ? null
        : {
            type: 'snapshot',
            seq: this.seq,
            request: this.activeRequest,
            meta: patch.meta,
            data: {
              ...snapshot.data,
              stats: patch.patch.stats,
              strikes: mergeEnrichedStrikes(snapshot.data.strikes, patch.patch.strikes),
              gex: patch.patch.gex ?? snapshot.data.gex,
            },
          };

    this.broadcast(event);
  }

  private broadcast(event: ChainRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onEvent(event);
      } catch {}
    }
  }
}
