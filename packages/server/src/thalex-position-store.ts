import {
  ThalexPrivateClient,
  type ThalexPrivateCreds,
  logger,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';
import type { PortfolioAccounting } from '@oggregator/protocol';
import { exchangePortfolioLedgerStore } from './trading-services.js';
import { VenuePositionPersistence } from './venue-position-persistence.js';

export interface ThalexPositionStoreCreds extends ThalexPrivateCreds {
  accountId: string;
}

export class ThalexPositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly clients = new Map<string, ThalexPrivateClient>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly tradeUnsubscribes = new Map<string, () => void>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retainCounts = new Map<string, number>();
  private readonly persistence = new VenuePositionPersistence('thalex', exchangePortfolioLedgerStore);


  list(accountId: string): PositionLeg[] {
    const legs = this.cache.get(accountId);
    return legs == null ? [] : [...legs.values()];
  }

  get(accountId: string, legId: string): PositionLeg | null {
    return this.cache.get(accountId)?.get(legId) ?? null;
  }

  upsert(): PositionLeg {
    throw new Error('thalex positions are read-only');
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


  async connect(creds: ThalexPositionStoreCreds): Promise<void> {
    await this.disconnect(creds.accountId);
    try {
      const persisted = await this.persistence.hydrate(creds.accountId);
      this.applyLegs(creds.accountId, persisted);
    } catch (error) {
      logger.warn({ error: String(error), venue: 'thalex' }, 'portfolio snapshot hydration failed');
    }


    const client = new ThalexPrivateClient(creds);
    const unsubscribe = client.subscribe((legs) => {
      this.applyLegs(creds.accountId, legs);
      void this.persistence.persistPositions(creds.accountId, legs).catch((error) => {
        logger.error({ error: String(error), venue: 'thalex' }, 'portfolio snapshot persistence failed');
      });
    });
    this.clients.set(creds.accountId, client);
    const unsubscribeTrades = client.subscribeTrades((trades) => {
      void this.persistence.persistTrades(creds.accountId, trades).then(
        () => this.broadcast(creds.accountId, []),
        (error) => {
          logger.error({ error: String(error), venue: 'thalex' }, 'portfolio trade persistence failed');
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

export const thalexPositionStore = new ThalexPositionStore();
