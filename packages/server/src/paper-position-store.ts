import {
  naturalKeyOf,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';
import type { Position } from '@oggregator/trading';

import { positionRepository } from './trading-services.js';
import { paperEvents } from './routes/paper/events.js';

function paperToLeg(p: Position): PositionLeg {
  return {
    legId: naturalKeyOf({
      underlying: p.key.underlying,
      expiry: p.key.expiry,
      strike: p.key.strike,
      optionRight: p.key.optionRight,
      source: 'paper',
    }),
    underlying: p.key.underlying,
    expiry: p.key.expiry,
    strike: p.key.strike,
    optionRight: p.key.optionRight,
    size: p.netQuantity,
    entryPriceUsd: p.avgEntryPriceUsd,
    entryIv: p.avgEntryIv,
    realizedPnlUsd: p.realizedPnlUsd,
    entryTs: p.openedAt.getTime(),
    venueHint: null,
    source: 'paper',
  };
}

export class PaperPositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly tracked = new Set<string>();
  private readonly refreshScheduled = new Set<string>();
  private readonly refreshQueued = new Set<string>();
  private readonly refreshPromises = new Map<string, Promise<void>>();
  private busEventUnsubscribe: (() => void) | null = null;

  constructor() {
    this.busEventUnsubscribe = paperEvents.subscribe((accountId) => {
      if (!this.tracked.has(accountId) || this.refreshScheduled.has(accountId)) return;
      this.refreshScheduled.add(accountId);
      queueMicrotask(() => {
        this.refreshScheduled.delete(accountId);
        void this.refreshAccount(accountId);
      });
    });
  }

  track(accountId: string): void {
    if (this.tracked.has(accountId)) return;
    this.tracked.add(accountId);
    void this.refreshAccount(accountId);
  }

  list(accountId: string): PositionLeg[] {
    this.track(accountId);
    const legs = this.cache.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.cache.get(accountId)?.get(legId) ?? null;
  }

  upsert(): PositionLeg {
    throw new Error('paper positions are read-only');
  }

  remove(): boolean {
    return false;
  }

  subscribe(listener: PositionStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.busEventUnsubscribe?.();
    this.busEventUnsubscribe = null;
    this.cache.clear();
    this.tracked.clear();
    this.refreshScheduled.clear();
    this.refreshQueued.clear();
    this.refreshPromises.clear();
    this.listeners.clear();
  }

  private async refreshAccount(accountId: string): Promise<void> {
    this.refreshQueued.add(accountId);
    const active = this.refreshPromises.get(accountId);
    if (active != null) return active;

    const refresh = this.refreshAccountUntilCurrent(accountId).finally(() => {
      this.refreshPromises.delete(accountId);
    });
    this.refreshPromises.set(accountId, refresh);
    return refresh;
  }

  private async refreshAccountUntilCurrent(accountId: string): Promise<void> {
    while (this.refreshQueued.delete(accountId)) await this.loadAccount(accountId);
  }

  private async loadAccount(accountId: string): Promise<void> {
    let positions: Position[];
    try {
      positions = await positionRepository.listPositions(accountId);
    } catch {
      return;
    }
    const open = positions.filter((p) => p.netQuantity !== 0);
    const next = new Map<string, PositionLeg>(
      open.map((p) => {
        const leg = paperToLeg(p);
        return [leg.legId, leg];
      }),
    );
    const prev = this.cache.get(accountId) ?? new Map();

    const changedLegIds: string[] = [];
    for (const [legId, leg] of next) {
      const prior = prev.get(legId);
      if (
        prior == null ||
        prior.size !== leg.size ||
        prior.entryPriceUsd !== leg.entryPriceUsd ||
        prior.entryIv !== leg.entryIv ||
        prior.realizedPnlUsd !== leg.realizedPnlUsd
      ) {
        changedLegIds.push(legId);
      }
    }
    for (const legId of prev.keys()) {
      if (!next.has(legId)) changedLegIds.push(legId);
    }
    if (changedLegIds.length === 0 && prev.size === next.size) return;

    this.cache.set(accountId, next);
    for (const listener of this.listeners) {
      try {
        listener({ accountId, changedLegIds });
      } catch {}
    }
  }
}

export const paperPositionStore = new PaperPositionStore();
