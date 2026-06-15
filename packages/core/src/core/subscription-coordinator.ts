import type { OptionVenueAdapter, StreamHandlers } from '../feeds/shared/types.js';
import { getAdapter } from './registry.js';
import { parseOptionSymbol } from './symbol.js';
import type { ChainRequest, VenueDelta, VenueStatus } from './types.js';
import type { VenueId } from '../types/common.js';

export interface VenueSubscriptionListener {
  onDelta?: (deltas: VenueDelta[]) => void;
  onStatus?: (status: VenueStatus) => void;
}

export interface VenueSubscriptionHandle {
  release(): Promise<void>;
}

interface CoordinatedRequestEntry {
  request: ChainRequest;
  refCount: number;
  listeners: Set<VenueSubscriptionListener>;
  upstreamRelease: () => Promise<void>;
}

interface CoordinatedVenueEntry {
  handlers: StreamHandlers;
  requestEntries: Map<string, CoordinatedRequestEntry>;
}

interface SubscriptionCoordinatorOptions {
  getAdapter?: (venue: VenueId) => OptionVenueAdapter;
}

function isRequestScopedStatus(status: VenueStatus): boolean {
  return status.message === 'no instruments for request';
}

function requestKey(request: ChainRequest): string {
  return `${request.underlying}:${request.expiry}`;
}

function symbolUnderlying(symbol: string): { underlying: string; base: string; expiry: string } | null {
  const parsed = parseOptionSymbol(symbol);
  if (parsed == null) return null;
  return {
    underlying: parsed.settle === parsed.base ? parsed.base : `${parsed.base}_${parsed.settle}`,
    base: parsed.base,
    expiry: parsed.expiry,
  };
}

export class VenueSubscriptionCoordinator {
  private readonly venueEntries = new Map<VenueId, CoordinatedVenueEntry>();
  private readonly pendingVenueOperations = new Map<VenueId, Promise<void>>();
  private readonly resolveAdapter: (venue: VenueId) => OptionVenueAdapter;

  constructor(options: SubscriptionCoordinatorOptions = {}) {
    this.resolveAdapter = options.getAdapter ?? getAdapter;
  }

  async acquire(
    venue: VenueId,
    request: ChainRequest,
    listener?: VenueSubscriptionListener,
  ): Promise<VenueSubscriptionHandle> {
    await this.runVenueOperation(venue, async () => {
      const entry = this.getOrCreateVenueEntry(venue);
      const key = requestKey(request);
      const requestEntry = entry.requestEntries.get(key);

      if (requestEntry != null) {
        requestEntry.refCount += 1;
        if (listener != null) requestEntry.listeners.add(listener);
        return;
      }

      const nextRequestEntry: CoordinatedRequestEntry = {
        request,
        refCount: 1,
        listeners: listener != null ? new Set([listener]) : new Set(),
        upstreamRelease: async () => {},
      };
      entry.requestEntries.set(key, nextRequestEntry);

      const adapter = this.resolveAdapter(venue);
      try {
        nextRequestEntry.upstreamRelease =
          adapter.subscribe != null
            ? await adapter.subscribe(request, {
                onDelta: entry.handlers.onDelta,
                onStatus: (status: VenueStatus) => {
                  if (isRequestScopedStatus(status)) {
                    for (const currentListener of nextRequestEntry.listeners) {
                      try {
                        currentListener.onStatus?.(status);
                      } catch {}
                    }
                    return;
                  }

                  entry.handlers.onStatus(status);
                },
              })
            : async () => {};
      } catch (error: unknown) {
        entry.requestEntries.delete(key);
        throw error;
      }
    });

    let released = false;

    return {
      release: async () => {
        if (released) return;
        released = true;
        await this.release(venue, request, listener);
      },
    };
  }

  async dispose(): Promise<void> {
    for (const venue of this.venueEntries.keys()) {
      await this.runVenueOperation(venue, async () => {
        const entry = this.venueEntries.get(venue);
        if (entry == null) return;

        this.venueEntries.delete(venue);
        const requestEntries = [...entry.requestEntries.values()];
        entry.requestEntries.clear();

        await Promise.allSettled(
          requestEntries.map(async (requestEntry) => requestEntry.upstreamRelease()),
        );
      });
    }
  }

  private async release(
    venue: VenueId,
    request: ChainRequest,
    listener?: VenueSubscriptionListener,
  ): Promise<void> {
    await this.runVenueOperation(venue, async () => {
      const entry = this.venueEntries.get(venue);
      if (entry == null) return;

      const key = requestKey(request);
      const requestEntry = entry.requestEntries.get(key);
      if (requestEntry == null) return;

      if (listener != null) requestEntry.listeners.delete(listener);
      requestEntry.refCount -= 1;

      if (requestEntry.refCount > 0) {
        return;
      }

      entry.requestEntries.delete(key);
      await requestEntry.upstreamRelease();

      if (entry.requestEntries.size === 0) {
        this.venueEntries.delete(venue);
      }
    });
  }

  private getOrCreateVenueEntry(venue: VenueId): CoordinatedVenueEntry {
    const existing = this.venueEntries.get(venue);
    if (existing != null) return existing;

    const entry: CoordinatedVenueEntry = {
      requestEntries: new Map(),
      handlers: {
        onDelta: (deltas: VenueDelta[]) => {
          const currentEntry = this.venueEntries.get(venue);
          if (currentEntry == null) return;

          // requestEntries is keyed by `${underlying}:${expiry}`, so routing is two
          // O(1) lookups per delta instead of scanning every request: the exact
          // underlying, plus a base-family fallback for alias symbols (e.g. BTC_USDC
          // delta → "BTC" request) that only applies when no specific alias request
          // has claimed that underlying.
          const requestEntries = currentEntry.requestEntries;
          const grouped = new Map<CoordinatedRequestEntry, VenueDelta[]>();
          const route = (requestEntry: CoordinatedRequestEntry, delta: VenueDelta): void => {
            const group = grouped.get(requestEntry);
            if (group != null) {
              group.push(delta);
            } else {
              grouped.set(requestEntry, [delta]);
            }
          };

          for (const delta of deltas) {
            const parsed = symbolUnderlying(delta.symbol);
            if (parsed == null) continue;

            const exactEntry = requestEntries.get(`${parsed.underlying}:${parsed.expiry}`);
            if (exactEntry != null) route(exactEntry, delta);

            if (parsed.underlying !== parsed.base && exactEntry == null) {
              const baseEntry = requestEntries.get(`${parsed.base}:${parsed.expiry}`);
              if (baseEntry != null) route(baseEntry, delta);
            }
          }

          for (const [requestEntry, matchedDeltas] of grouped) {
            for (const currentListener of requestEntry.listeners) {
              try {
                currentListener.onDelta?.(matchedDeltas);
              } catch {}
            }
          }
        },
        onStatus: (status: VenueStatus) => {
          const currentEntry = this.venueEntries.get(venue);
          if (currentEntry == null) return;

          for (const requestEntry of currentEntry.requestEntries.values()) {
            for (const currentListener of requestEntry.listeners) {
              try {
                currentListener.onStatus?.(status);
              } catch {}
            }
          }
        },
      },
    };

    this.venueEntries.set(venue, entry);
    return entry;
  }

  private async runVenueOperation(venue: VenueId, operation: () => Promise<void>): Promise<void> {
    const previous = this.pendingVenueOperations.get(venue) ?? Promise.resolve();
    const next = previous.then(operation);
    const guarded = next.finally(() => {
      if (this.pendingVenueOperations.get(venue) === guarded) {
        this.pendingVenueOperations.delete(venue);
      }
    });

    this.pendingVenueOperations.set(venue, guarded);
    await guarded;
  }
}
