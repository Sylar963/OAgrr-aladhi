import {
  ThalexPrivateClient,
  type ThalexAccountMargin,
  type ThalexPrivateCreds,
  logger,
  type EntryAnchor,
  type PositionLeg,
  type PositionStore,
  type PositionStoreListener,
} from '@oggregator/core';
import { NoopExchangePortfolioLedgerStore } from '@oggregator/db';
import type { EquityHistoryPoint, PortfolioAccounting, VenueEnvironment } from '@oggregator/protocol';
import { exchangePortfolioLedgerStore } from './trading-services.js';
import { portfolioFillPriceAt } from './portfolio-fill-prices.js';
import {
  carryEntryIvs,
  mergePersistedEntryIvs,
  VenuePositionPersistence,
} from './venue-position-persistence.js';

export interface ThalexPositionStoreCreds extends ThalexPrivateCreds {
  accountId: string;
}

const HYDRATE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export class ThalexPositionStore implements PositionStore {
  private readonly cache = new Map<string, Map<string, PositionLeg>>();
  private readonly listeners = new Set<PositionStoreListener>();
  private readonly clients = new Map<string, ThalexPrivateClient>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly tradeUnsubscribes = new Map<string, () => void>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retainCounts = new Map<string, number>();
  private readonly keptAlive = new Set<string>();
  private readonly mainnetPersistence = new VenuePositionPersistence(
    'thalex',
    exchangePortfolioLedgerStore,
    portfolioFillPriceAt,
  );
  // The ledger is keyed by (account, venue) with no environment, so testnet positions and fills
  // stay in memory rather than mixing into the mainnet history.
  private readonly testnetPersistence = new VenuePositionPersistence(
    'thalex',
    new NoopExchangePortfolioLedgerStore(),
  );
  private readonly environments = new Map<string, VenueEnvironment>();
  private readonly lifecycle = new Map<string, Promise<void>>();
  private readonly hydrateTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private persistence(accountId: string): VenuePositionPersistence {
    return this.environments.get(accountId) === 'test'
      ? this.testnetPersistence
      : this.mainnetPersistence;
  }

  /** The connected session's network, or null when the account has no Thalex session. */
  environment(accountId: string): VenueEnvironment | null {
    return this.clients.has(accountId) ? (this.environments.get(accountId) ?? 'prod') : null;
  }

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
    return this.persistence(accountId).getAccounting(accountId, this.list(accountId), underlying);
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
    void this.persistence(accountId).persistPositions(accountId, this.list(accountId)).catch((error) => {
      logger.error({ error: String(error), venue: 'thalex' }, 'portfolio snapshot persistence failed');
    });
  }

  private async refreshFillEntryIvs(accountId: string): Promise<void> {
    let resolved: Map<string, EntryAnchor>;
    try {
      resolved = await this.persistence(accountId).resolveFillEntryAnchors(accountId, this.list(accountId));
    } catch (error) {
      logger.warn({ error: String(error), venue: 'thalex' }, 'portfolio fill entry IV resolve failed');
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
      const persisted = await this.persistence(accountId).hydrate(accountId);
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
      logger.warn({ error: String(error), venue: 'thalex' }, 'portfolio snapshot hydration failed');
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
      if (!this.clients.has(accountId) || this.persistence(accountId).isHydrated(accountId)) return;
      void this.tryHydrate(accountId).then((ok) => {
        if (!ok) this.scheduleHydrateRetry(accountId, attempt + 1);
      });
    }, delay);
    timer.unref?.();
    this.hydrateTimers.set(accountId, timer);
  }


  // Connects and disconnects for one account run one at a time. Overlapping connects (a page-load
  // reconnect racing a network switch) would otherwise leave two clients writing to one cache.
  private serialize(accountId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.lifecycle.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.lifecycle.set(accountId, next);
    void next
      .finally(() => {
        if (this.lifecycle.get(accountId) === next) this.lifecycle.delete(accountId);
      })
      .catch(() => {});
    return next;
  }

  connect(creds: ThalexPositionStoreCreds): Promise<void> {
    return this.serialize(creds.accountId, () => this.connectNow(creds));
  }

  disconnect(accountId: string): Promise<void> {
    return this.serialize(accountId, () => this.disconnectNow(accountId));
  }

  private async connectNow(creds: ThalexPositionStoreCreds): Promise<void> {
    const { accountId } = creds;
    await this.disconnectNow(accountId);
    const environment = creds.env ?? 'prod';
    if ((this.environments.get(accountId) ?? 'prod') !== environment) {
      this.cache.delete(accountId);
      this.broadcast(accountId, []);
    }
    this.environments.set(accountId, environment);
    // Pinned to this session so a callback can never reach the other network's ledger.
    const persistence = this.persistence(accountId);
    const hydrated = await this.tryHydrate(accountId);

    const client = new ThalexPrivateClient(creds);
    const isCurrent = () => this.clients.get(accountId) === client;
    const unsubscribe = client.subscribe((incoming) => {
      if (!isCurrent()) return;
      const legs = carryEntryIvs(this.cache.get(accountId), incoming);
      this.applyLegs(accountId, legs);
      void persistence.persistPositions(accountId, legs).catch((error) => {
        logger.error({ error: String(error), venue: 'thalex' }, 'portfolio snapshot persistence failed');
      });
    });
    const unsubscribeTrades = client.subscribeTrades((trades) => {
      if (!isCurrent()) return;
      void persistence.persistTrades(accountId, trades).then(
        () => {
          this.broadcast(accountId, []);
          void this.refreshFillEntryIvs(accountId);
        },
        (error) => {
          logger.error({ error: String(error), venue: 'thalex' }, 'portfolio trade persistence failed');
        },
      );
    });
    this.clients.set(accountId, client);
    this.unsubscribes.set(accountId, unsubscribe);
    this.tradeUnsubscribes.set(accountId, unsubscribeTrades);
    if (!hydrated) this.scheduleHydrateRetry(accountId, 0);
    await client.start();
    this.scheduleDisconnect(accountId);
  }

  private async disconnectNow(accountId: string): Promise<void> {
    const timer = this.disconnectTimers.get(accountId);
    if (timer != null) clearTimeout(timer);
    const hydrateTimer = this.hydrateTimers.get(accountId);
    if (hydrateTimer != null) clearTimeout(hydrateTimer);
    this.hydrateTimers.delete(accountId);
    this.disconnectTimers.delete(accountId);
    this.retainCounts.delete(accountId);
    this.unsubscribes.get(accountId)?.();
    this.unsubscribes.delete(accountId);
    this.tradeUnsubscribes.get(accountId)?.();
    this.tradeUnsubscribes.delete(accountId);
    const client = this.clients.get(accountId);
    this.clients.delete(accountId);
    // Testnet legs are never persisted, so nothing should keep showing them once the session ends.
    if (this.environments.get(accountId) === 'test' && this.cache.delete(accountId)) {
      this.broadcast(accountId, []);
    }
    if (client != null) await client.dispose();
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

  async fetchEquityHistory(accountId: string, fromMs: number): Promise<EquityHistoryPoint[] | null> {
    const client = this.clients.get(accountId);
    return client == null ? null : client.fetchEquityHistory(fromMs);
  }

  isConnected(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  getMargin(accountId: string): ThalexAccountMargin | null | undefined {
    const client = this.clients.get(accountId);
    return client == null ? undefined : client.getLatestMargin();
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

/**
 * The exchange ledger holds mainnet fills only. While an account's Thalex session is on testnet,
 * those fills don't describe the positions on screen.
 */
export function ledgerMatchesSession(accountId: string, venue: string): boolean {
  return venue !== 'thalex' || thalexPositionStore.environment(accountId) !== 'test';
}
