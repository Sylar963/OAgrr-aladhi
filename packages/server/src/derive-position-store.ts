import {
  DerivePrivateClient,
  type DerivePrivateCreds,
  logger,
  type EntryAnchor,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';
import type { PortfolioAccounting } from '@oggregator/protocol';
import { exchangePortfolioLedgerStore } from './trading-services.js';
import { portfolioFillPriceAt } from './portfolio-fill-prices.js';
import {
  carryEntryIvs,
  mergePersistedEntryIvs,
  VenuePositionPersistence,
} from './venue-position-persistence.js';

export interface DerivePositionStoreCreds extends DerivePrivateCreds {
  accountId: string;
}

const HYDRATE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export class DerivePositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly clients = new Map<string, DerivePrivateClient>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly tradeUnsubscribes = new Map<string, () => void>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retainCounts = new Map<string, number>();
  private readonly persistence = new VenuePositionPersistence(
    'derive',
    exchangePortfolioLedgerStore,
    portfolioFillPriceAt,
  );
  private readonly hydrateTimers = new Map<string, ReturnType<typeof setTimeout>>();


  list(accountId: string): PositionLeg[] {
    const legs = this.cache.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.cache.get(accountId)?.get(legId) ?? null;
  }

  upsert(): PositionLeg {
    throw new Error('derive positions are read-only');
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
  getAccounting(accountId: string, underlying?: string): PortfolioAccounting {
    return this.persistence.getAccounting(accountId, this.list(accountId), underlying);
  }

  recordEntryIvs(accountId: string, entryIvs: ReadonlyMap<string, number>): void {
    const legs = this.cache.get(accountId);
    if (legs == null) return;
    let changed = false;
    for (const [legId, entryIv] of entryIvs) {
      const leg = legs.get(legId);
      if (leg == null || leg.entryIv != null) continue;
      legs.set(legId, { ...leg, entryIv, entryIvSource: 'first_seen' });
      changed = true;
    }
    if (changed) this.persistCurrent(accountId);
  }

  private persistCurrent(accountId: string): void {
    void this.persistence.persistPositions(accountId, this.list(accountId)).catch((error) => {
      logger.error({ error: String(error), venue: 'derive' }, 'portfolio snapshot persistence failed');
    });
  }

  private async refreshFillEntryIvs(accountId: string): Promise<void> {
    let resolved: Map<string, EntryAnchor>;
    try {
      resolved = await this.persistence.resolveFillEntryAnchors(accountId, this.list(accountId));
    } catch (error) {
      logger.warn({ error: String(error), venue: 'derive' }, 'portfolio fill entry IV resolve failed');
      return;
    }
    const legs = this.cache.get(accountId);
    if (legs == null) return;
    const changedLegIds: string[] = [];
    for (const [legId, anchor] of resolved) {
      const leg = legs.get(legId);
      if (
        leg == null ||
        (leg.entryIvSource === 'fill' &&
          leg.entryIv === anchor.iv &&
          leg.entryUnderlyingUsd === anchor.underlyingUsd &&
          leg.entryTs === anchor.timestampMs)
      ) {
        continue;
      }
      legs.set(legId, {
        ...leg,
        entryIv: anchor.iv,
        entryIvSource: 'fill',
        entryUnderlyingUsd: anchor.underlyingUsd,
        entryTs: anchor.timestampMs,
      });
      changedLegIds.push(legId);
    }
    if (changedLegIds.length === 0) return;
    this.broadcast(accountId, changedLegIds);
    this.persistCurrent(accountId);
  }

  private async tryHydrate(accountId: string): Promise<boolean> {
    try {
      const persisted = await this.persistence.hydrate(accountId);
      const current = this.list(accountId);
      if (current.length === 0) {
        this.applyLegs(accountId, persisted);
      } else {
        this.applyLegs(accountId, mergePersistedEntryIvs(current, persisted));
        this.persistCurrent(accountId);
      }
      void this.refreshFillEntryIvs(accountId);
      return true;
    } catch (error) {
      logger.warn({ error: String(error), venue: 'derive' }, 'portfolio snapshot hydration failed');
      return false;
    }
  }

  // Neon cold starts can time out the first read; until a hydrate succeeds, snapshot
  // writes stay off so the stored entry IVs are not replaced.
  private scheduleHydrateRetry(accountId: string, attempt: number): void {
    const delay = HYDRATE_RETRY_DELAYS_MS[attempt];
    if (delay == null) return;
    const timer = setTimeout(() => {
      this.hydrateTimers.delete(accountId);
      if (!this.clients.has(accountId) || this.persistence.isHydrated(accountId)) return;
      void this.tryHydrate(accountId).then((ok) => {
        if (!ok) this.scheduleHydrateRetry(accountId, attempt + 1);
      });
    }, delay);
    timer.unref?.();
    this.hydrateTimers.set(accountId, timer);
  }


  async connect(creds: DerivePositionStoreCreds): Promise<void> {
    await this.disconnect(creds.accountId);
    const hydrated = await this.tryHydrate(creds.accountId);


    const client = new DerivePrivateClient(creds);
    const unsubscribe = client.subscribe((incoming) => {
      const legs = carryEntryIvs(this.cache.get(creds.accountId), incoming);
      this.applyLegs(creds.accountId, legs);
      void this.persistence.persistPositions(creds.accountId, legs).catch((error) => {
        logger.error({ error: String(error), venue: 'derive' }, 'portfolio snapshot persistence failed');
      });
    });
    this.clients.set(creds.accountId, client);
    if (!hydrated) this.scheduleHydrateRetry(creds.accountId, 0);
    const unsubscribeTrades = client.subscribeTrades((trades) => {
      void this.persistence.persistTrades(creds.accountId, trades).then(
        () => {
          this.broadcast(creds.accountId, []);
          void this.refreshFillEntryIvs(creds.accountId);
        },
        (error) => {
          logger.error({ error: String(error), venue: 'derive' }, 'portfolio trade persistence failed');
        },
      );
    });
    this.unsubscribes.set(creds.accountId, unsubscribe);
    await client.start();
    this.scheduleDisconnect(creds.accountId);
    this.tradeUnsubscribes.set(creds.accountId, unsubscribeTrades);
  }

  async disconnect(accountId: string): Promise<void> {
    const timer = this.disconnectTimers.get(accountId);
    if (timer != null) clearTimeout(timer);
    const hydrateTimer = this.hydrateTimers.get(accountId);
    if (hydrateTimer != null) clearTimeout(hydrateTimer);
    this.hydrateTimers.delete(accountId);
    this.disconnectTimers.delete(accountId);
    this.retainCounts.delete(accountId);
    const unsubscribe = this.unsubscribes.get(accountId);
    if (unsubscribe != null) {
      unsubscribe();
      this.unsubscribes.delete(accountId);
    }
    const client = this.clients.get(accountId);
    if (client != null) {
    const tradeUnsubscribe = this.tradeUnsubscribes.get(accountId);
    if (tradeUnsubscribe != null) {
      tradeUnsubscribe();
      this.tradeUnsubscribes.delete(accountId);
    }
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

  private scheduleDisconnect(accountId: string): void {
    if (!this.clients.has(accountId) || (this.retainCounts.get(accountId) ?? 0) > 0) return;
    const current = this.disconnectTimers.get(accountId);
    if (current != null) clearTimeout(current);
    const timer = setTimeout(
      () => {
        this.disconnectTimers.delete(accountId);
        void this.disconnect(accountId);
      },
      15 * 60 * 1000,
    );
    timer.unref?.();
    this.disconnectTimers.set(accountId, timer);
  }

  isConnected(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  async dispose(): Promise<void> {
    const accountIds = [...this.clients.keys()];
    await Promise.allSettled(accountIds.map((id) => this.disconnect(id)));
    this.listeners.clear();
  }

  private applyLegs(accountId: string, legs: PositionLeg[]): void {
    const next = new Map<string, PositionLeg>(legs.map((leg) => [leg.legId, leg]));
    const prev = this.cache.get(accountId) ?? new Map<string, PositionLeg>();
    const changedLegIds: string[] = [];
    for (const [legId, leg] of next) {
      const prior = prev.get(legId);
      if (prior == null || prior.size !== leg.size || prior.entryPriceUsd !== leg.entryPriceUsd) {
        changedLegIds.push(legId);
      }
    }
    for (const legId of prev.keys()) {
      if (!next.has(legId)) changedLegIds.push(legId);
    }
    this.cache.set(accountId, next);
    if (changedLegIds.length > 0 || prev.size !== next.size) {
      this.broadcast(accountId, changedLegIds);
    }
  }

  private broadcast(accountId: string, changedLegIds: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener({ accountId, changedLegIds });
      } catch {}
    }
  }
}

export const derivePositionStore = new DerivePositionStore();
