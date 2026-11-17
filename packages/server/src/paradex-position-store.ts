import {
  ParadexPrivateClient,
  decodeParadexJwtClaims,
  logger,
  type LinearPosition,
  type ParadexPrivateCreds,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';
import type { EquityHistoryPoint, PortfolioAccounting } from '@oggregator/protocol';
import { NoopExchangePortfolioLedgerStore, type ExchangePortfolioLedgerStore } from '@oggregator/db';

import { carryEntryIvs, mergePersistedEntryIvs, VenuePositionPersistence } from './venue-position-persistence.js';
import { exchangePortfolioLedgerStore } from './trading-services.js';
import { portfolioFillPriceAt } from './portfolio-fill-prices.js';

export interface ParadexPositionStoreCreds extends ParadexPrivateCreds {
  accountId: string;
}

const IDLE_DISCONNECT_MS = 15 * 60 * 1000;

export class ParadexPositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly linearCache = new Map<string, LinearPosition[]>();
  private readonly ledgerAccounts = new Map<string, string>();
  private readonly lifecycle = new Map<string, Promise<void>>();
  private readonly historyTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly historyReads = new Map<string, Promise<void>>();
  private readonly historyFrom = new Map<string, number>();
  private readonly persistence: VenuePositionPersistence;
  private readonly testnetPersistence = new VenuePositionPersistence('paradex', new NoopExchangePortfolioLedgerStore());
  private readonly environments = new Map<string, 'prod' | 'test'>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly clients = new Map<string, ParadexPrivateClient>();
  private readonly positionSnapshots = new WeakSet<ParadexPrivateClient>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retainCounts = new Map<string, number>();
  private readonly keptAlive = new Set<string>();

  constructor(
    private readonly createClient: (creds: ParadexPrivateCreds) => ParadexPrivateClient = (creds) =>
      new ParadexPrivateClient(creds),
    private readonly ledger: ExchangePortfolioLedgerStore = exchangePortfolioLedgerStore,
  ) {
    this.persistence = new VenuePositionPersistence('paradex', ledger, portfolioFillPriceAt);
  }

  ledgerAccountId(accountId: string): string {
    return this.ledgerAccounts.get(accountId) ?? accountId;
  }

  environment(accountId: string): 'prod' | 'test' | null {
    return this.clients.has(accountId) ? this.environments.get(accountId) ?? 'prod' : null;
  }

  private persistenceFor(accountId: string): VenuePositionPersistence {
    return this.environments.get(accountId) === 'test' ? this.testnetPersistence : this.persistence;
  }

  listLinear(accountId: string): LinearPosition[] {
    return this.linearCache.get(accountId) ?? [];
  }

  getAccounting(accountId: string, underlying?: string): PortfolioAccounting {
    return this.persistenceFor(accountId).getAccounting(this.ledgerAccountId(accountId), this.list(accountId), underlying);
  }

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
    this.persistCurrent(accountId);
  }

  connect(creds: ParadexPositionStoreCreds): Promise<void> {
    return this.serialize(creds.accountId, () => this.connectNow(creds));
  }

  private serialize(accountId: string, work: () => Promise<void>): Promise<void> {
    const next = (this.lifecycle.get(accountId) ?? Promise.resolve()).catch(() => {}).then(work);
    this.lifecycle.set(accountId, next);
    void next.finally(() => {
      if (this.lifecycle.get(accountId) === next) this.lifecycle.delete(accountId);
    }).catch(() => {});
    return next;
  }

  private async connectNow(creds: ParadexPositionStoreCreds): Promise<void> {
    await this.disconnectClient(creds.accountId);
    const subject = decodeParadexJwtClaims(creds.readonlyToken)?.sub;
    const environment = creds.env ?? 'prod';
    const address = subject == null ? 'unknown' : /^0x[0-9a-f]+$/i.test(subject) ? BigInt(subject).toString(16) : subject;
    const identity = `${creds.accountId}:paradex:${environment}:${address}`;
    if (identity !== this.ledgerAccountId(creds.accountId)) {
      this.cache.delete(creds.accountId);
      this.linearCache.delete(creds.accountId);
      this.broadcast(creds.accountId, []);
    }
    this.ledgerAccounts.set(creds.accountId, identity);
    this.environments.set(creds.accountId, environment);
    await this.hydrate(creds.accountId);
    const client = this.createClient({ readonlyToken: creds.readonlyToken, ...(creds.env != null ? { env: creds.env } : {}) });
    const unsubscribe = client.subscribe((incoming, linear = []) => {
      if (this.clients.get(creds.accountId) !== client) return;
      this.positionSnapshots.add(client);
      this.applyLegs(creds.accountId, carryEntryIvs(this.cache.get(creds.accountId), incoming));
      const previous = this.listLinear(creds.accountId);
      this.linearCache.set(creds.accountId, linear);
      if (JSON.stringify(previous) !== JSON.stringify(linear)) this.broadcast(creds.accountId, []);
      this.persistCurrent(creds.accountId);
    });
    this.clients.set(creds.accountId, client);
    this.unsubscribes.set(creds.accountId, unsubscribe);
    try {
      await client.start();
    } catch (error) {
      await this.disconnectClient(creds.accountId);
      throw error;
    }
    if (this.ledger.enabled && environment === 'prod') {
      void this.refreshHistory(creds.accountId, client);
      const timer = setInterval(() => void this.refreshHistory(creds.accountId, client), 60_000);
      timer.unref?.();
      this.historyTimers.set(creds.accountId, timer);
    }
    this.scheduleDisconnect(creds.accountId);
  }

  disconnect(accountId: string): Promise<void> {
    return this.serialize(accountId, async () => {
      this.retainCounts.delete(accountId);
      await this.disconnectClient(accountId);
    });
  }

  private async hydrate(accountId: string): Promise<void> {
    try {
      const persisted = await this.persistenceFor(accountId).hydrate(this.ledgerAccountId(accountId));
      const current = this.list(accountId);
      this.applyLegs(accountId, current.length === 0 ? persisted : mergePersistedEntryIvs(current, persisted));
    } catch (error) {
      logger.warn({ err: String(error), venue: 'paradex' }, 'portfolio snapshot hydration failed');
    }
  }

  private persistCurrent(accountId: string): void {
    void this.persistenceFor(accountId).persistPositions(this.ledgerAccountId(accountId), this.list(accountId)).catch((error) => {
      logger.warn({ err: String(error), venue: 'paradex' }, 'portfolio snapshot persistence failed');
    });
  }

  private refreshHistory(accountId: string, client: ParadexPrivateClient): Promise<void> {
    const existing = this.historyReads.get(accountId);
    if (existing != null) return existing;
    const identity = this.ledgerAccountId(accountId);
    const isCurrent = () => this.clients.get(accountId) === client;
    const work = (async () => {
      if (!this.persistence.isHydrated(identity)) await this.hydrate(accountId);
      const fromMs = this.historyFrom.get(identity) ?? Date.now() - 90 * 86_400_000;
      const startedAt = Date.now();
      const trades = await client.fetchOptionTrades(fromMs);
      if (!isCurrent()) return;
      await this.persistence.persistTrades(identity, trades);
      if (!isCurrent()) return;
      this.historyFrom.set(identity, startedAt - 5 * 60_000);
      const anchors = await this.persistence.resolveFillEntryAnchors(identity, this.list(accountId));
      if (!isCurrent()) return;
      const legs = this.cache.get(accountId);
      for (const [legId, anchor] of anchors) {
        const leg = legs?.get(legId);
        if (leg != null) legs!.set(legId, {
          ...leg, entryIv: anchor.iv, entryIvSource: 'fill',
          entryUnderlyingUsd: anchor.underlyingUsd, entryTs: anchor.timestampMs,
        });
      }
      this.persistCurrent(accountId);
      this.broadcast(accountId, [...anchors.keys()]);
    })().catch((error) => {
      if (isCurrent()) logger.warn({ err: String(error), venue: 'paradex' }, 'portfolio fill history refresh failed');
    }).finally(() => {
      if (this.historyReads.get(accountId) === work) this.historyReads.delete(accountId);
    });
    this.historyReads.set(accountId, work);
    return work;
  }

  retain(accountId: string): void {
    const timer = this.disconnectTimers.get(accountId);
    if (timer != null) clearTimeout(timer);
    this.disconnectTimers.delete(accountId);
    this.retainCounts.set(accountId, (this.retainCounts.get(accountId) ?? 0) + 1);
  }

  /** Pins a connection open across reconnects, e.g. while it is broadcast on the leaderboard. */
  keepAlive(accountId: string, enabled: boolean): void {
    if (enabled) {
      this.keptAlive.add(accountId);
      const timer = this.disconnectTimers.get(accountId);
      if (timer != null) clearTimeout(timer);
      this.disconnectTimers.delete(accountId);
      return;
    }
    if (this.keptAlive.delete(accountId)) this.scheduleDisconnect(accountId);
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

  async fetchAccountSummary(accountId: string) {
    const client = this.clients.get(accountId);
    if (client == null) return null;
    const summary = await client.fetchAccountSummary();
    return this.clients.get(accountId) === client ? summary : null;
  }

  async fetchOpenRfqs(accountId: string, underlying: string, cursor?: string) {
    const client = this.clients.get(accountId);
    if (client == null) return null;
    const page = await client.fetchOpenRfqs(underlying, cursor);
    return this.clients.get(accountId) === client ? page : null;
  }

  async fetchEquityHistory(
    accountId: string,
    fromMs: number,
  ): Promise<EquityHistoryPoint[] | null> {
    const client = this.clients.get(accountId);
    if (client == null) return null;
    const history = await client.fetchEquityHistory(fromMs);
    return this.clients.get(accountId) === client ? history : null;
  }

  async fetchPnlHistory(accountId: string, fromMs: number) {
    const client = this.clients.get(accountId);
    if (client == null) return null;
    const history = await client.fetchPnlHistory(fromMs);
    return this.clients.get(accountId) === client ? history : null;
  }

  isConnected(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  hasPositionSnapshot(accountId: string): boolean {
    const client = this.clients.get(accountId);
    return client != null && this.positionSnapshots.has(client);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.clients.keys()].map((id) => this.disconnect(id)));
    this.listeners.clear();
  }

  private async disconnectClient(accountId: string): Promise<void> {
    const historyTimer = this.historyTimers.get(accountId);
    if (historyTimer != null) clearInterval(historyTimer);
    this.historyTimers.delete(accountId);
    const timer = this.disconnectTimers.get(accountId);
    if (timer != null) clearTimeout(timer);
    this.disconnectTimers.delete(accountId);
    this.unsubscribes.get(accountId)?.();
    this.unsubscribes.delete(accountId);
    const client = this.clients.get(accountId);
    if (client != null) {
      this.clients.delete(accountId);
      await client.dispose();
    }
    await this.historyReads.get(accountId);
    if (this.environments.get(accountId) === 'test') {
      this.cache.delete(accountId);
      this.linearCache.delete(accountId);
      this.broadcast(accountId, []);
    }
  }

  private scheduleDisconnect(accountId: string): void {
    if (
      !this.clients.has(accountId) ||
      this.keptAlive.has(accountId) ||
      (this.retainCounts.get(accountId) ?? 0) > 0
    ) {
      return;
    }
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
    this.broadcast(accountId, changedLegIds);
  }

  private broadcast(accountId: string, changedLegIds: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener({ accountId, changedLegIds });
      } catch {}
    }
  }
}

export const paradexPositionStore = new ParadexPositionStore();
