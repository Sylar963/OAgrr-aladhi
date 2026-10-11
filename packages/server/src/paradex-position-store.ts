import {
  ParadexPrivateClient,
  type ParadexPrivateCreds,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';

import { carryEntryIvs } from './venue-position-persistence.js';

export interface ParadexPositionStoreCreds extends ParadexPrivateCreds {
  accountId: string;
}

const IDLE_DISCONNECT_MS = 15 * 60 * 1000;

// Paradex legs live in memory only: the venue reports entry price and realized P&L
// itself, so nothing is written to the exchange ledger.
export class ParadexPositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly clients = new Map<string, ParadexPrivateClient>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retainCounts = new Map<string, number>();

  constructor(
    private readonly createClient: (creds: ParadexPrivateCreds) => ParadexPrivateClient = (creds) =>
      new ParadexPrivateClient(creds),
  ) {}

  list(accountId: string): PositionLeg[] {
    const legs = this.cache.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.cache.get(accountId)?.get(legId) ?? null;
  }

  upsert(): PositionLeg {
    throw new Error('paradex positions are read-only');
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

  recordEntryIvs(accountId: string, entryIvs: ReadonlyMap<string, number>): void {
    const legs = this.cache.get(accountId);
    if (legs == null) return;
    for (const [legId, entryIv] of entryIvs) {
      const leg = legs.get(legId);
      if (leg == null || leg.entryIv != null) continue;
      legs.set(legId, { ...leg, entryIv, entryIvSource: 'first_seen' });
    }
  }

  async connect(creds: ParadexPositionStoreCreds): Promise<void> {
    await this.disconnect(creds.accountId);
    const client = this.createClient({ readonlyToken: creds.readonlyToken });
    const unsubscribe = client.subscribe((incoming) => {
      this.applyLegs(creds.accountId, carryEntryIvs(this.cache.get(creds.accountId), incoming));
    });
    this.clients.set(creds.accountId, client);
    this.unsubscribes.set(creds.accountId, unsubscribe);
    try {
      await client.start();
    } catch (error) {
      await this.disconnect(creds.accountId);
      throw error;
    }
    this.scheduleDisconnect(creds.accountId);
  }

  async disconnect(accountId: string): Promise<void> {
    const timer = this.disconnectTimers.get(accountId);
    if (timer != null) clearTimeout(timer);
    this.disconnectTimers.delete(accountId);
    this.retainCounts.delete(accountId);
    this.unsubscribes.get(accountId)?.();
    this.unsubscribes.delete(accountId);
    const client = this.clients.get(accountId);
    if (client != null) {
      this.clients.delete(accountId);
      await client.dispose();
    }
  }

  retain(accountId: string): void {
    const timer = this.disconnectTimers.get(accountId);
    if (timer != null) clearTimeout(timer);
    this.disconnectTimers.delete(accountId);
    this.retainCounts.set(accountId, (this.retainCounts.get(accountId) ?? 0) + 1);
  }

  release(accountId: string): void {
    const nextCount = Math.max(0, (this.retainCounts.get(accountId) ?? 0) - 1);
    if (nextCount > 0) {
      this.retainCounts.set(accountId, nextCount);
      return;
    }
    this.retainCounts.delete(accountId);
    this.scheduleDisconnect(accountId);
  }

  isConnected(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.clients.keys()].map((id) => this.disconnect(id)));
    this.listeners.clear();
  }

  private scheduleDisconnect(accountId: string): void {
    if (!this.clients.has(accountId) || (this.retainCounts.get(accountId) ?? 0) > 0) return;
    const current = this.disconnectTimers.get(accountId);
    if (current != null) clearTimeout(current);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(accountId);
      void this.disconnect(accountId);
    }, IDLE_DISCONNECT_MS);
    timer.unref?.();
    this.disconnectTimers.set(accountId, timer);
  }

  private applyLegs(accountId: string, legs: PositionLeg[]): void {
    const next = new Map<string, PositionLeg>(legs.map((leg) => [leg.legId, leg]));
    const prev = this.cache.get(accountId) ?? new Map<string, PositionLeg>();
    const changedLegIds: string[] = [];
    for (const [legId, leg] of next) {
      const prior = prev.get(legId);
      if (
        prior == null ||
        prior.size !== leg.size ||
        prior.entryPriceUsd !== leg.entryPriceUsd ||
        prior.venueMarkPriceUsd !== leg.venueMarkPriceUsd
      ) {
        changedLegIds.push(legId);
      }
    }
    for (const legId of prev.keys()) {
      if (!next.has(legId)) changedLegIds.push(legId);
    }
    this.cache.set(accountId, next);
    if (changedLegIds.length === 0) return;
    for (const listener of this.listeners) {
      try {
        listener({ accountId, changedLegIds });
      } catch {}
    }
  }
}

export const paradexPositionStore = new ParadexPositionStore();
