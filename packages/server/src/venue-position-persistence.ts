import { entryIvFromFills, type EntryFill, type PositionLeg } from '@oggregator/core';
import type {
  ExchangePortfolioTrade,
  PortfolioAccounting,
} from '@oggregator/protocol';
import type {
  ExchangePortfolioLedgerStore,
  ExchangePortfolioVenue,
  ExchangeTradeSummary,
  PersistedExchangePosition,
  PersistedExchangeTrade,
} from '@oggregator/db';

const ALL_UNDERLYINGS = '*';

function summaryKey(accountId: string, underlying?: string): string {
  return `${accountId}|${underlying ?? ALL_UNDERLYINGS}`;
}

function toPersistedPosition(leg: PositionLeg): PersistedExchangePosition {
  return {
    legId: leg.legId,
    underlying: leg.underlying,
    expiry: leg.expiry,
    strike: leg.strike,
    optionRight: leg.optionRight,
    size: leg.size,
    entryPriceUsd: leg.entryPriceUsd,
    entryIv: leg.entryIv,
    realizedPnlUsd: leg.realizedPnlUsd,
    entryTs: leg.entryTs,
  };
}

// entryTs is excluded: the Thalex codec restamps it on every push.
function positionsSignature(positions: PersistedExchangePosition[]): string {
  return JSON.stringify(
    positions
      .map((p) => [p.legId, p.size, p.entryPriceUsd, p.entryIv, p.realizedPnlUsd])
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
  );
}

// Venue codecs never carry an entry IV, so each push would wipe the one captured from
// the first live mark. Keep it while the leg stays open on the same side.
export function carryEntryIvs(
  prior: ReadonlyMap<string, PositionLeg> | undefined,
  legs: PositionLeg[],
): PositionLeg[] {
  if (prior == null) return legs;
  return legs.map((leg) => {
    if (leg.entryIv != null) return leg;
    const previous = prior.get(leg.legId);
    if (previous?.entryIv == null || Math.sign(previous.size) !== Math.sign(leg.size)) return leg;
    return {
      ...leg,
      entryIv: previous.entryIv,
      ...(previous.entryIvSource != null ? { entryIvSource: previous.entryIvSource } : {}),
    };
  });
}

// A late hydration must not lose the older persisted anchor to an IV this process
// only just first-saw; fill-derived IVs are recomputed separately and always win.
export function mergePersistedEntryIvs(
  current: PositionLeg[],
  persisted: PositionLeg[],
): PositionLeg[] {
  const byLegId = new Map(persisted.map((leg) => [leg.legId, leg]));
  return current.map((leg) => {
    if (leg.entryIvSource === 'fill') return leg;
    const stored = byLegId.get(leg.legId);
    if (stored?.entryIv == null || Math.sign(stored.size) !== Math.sign(leg.size)) return leg;
    return { ...leg, entryIv: stored.entryIv, entryIvSource: stored.entryIvSource ?? 'first_seen' };
  });
}

export type PriceAtLookup = (underlying: string, timestampMs: number) => Promise<number | null>;

const FILL_HISTORY_LIMIT = 5_000;

function instrumentKey(leg: {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}): string {
  return `${leg.underlying}|${leg.expiry}|${leg.strike}|${leg.optionRight}`;
}

function toPersistedTrade(trade: ExchangePortfolioTrade): PersistedExchangeTrade {
  return {
    tradeId: trade.tradeId,
    orderId: trade.orderId,
    groupId: trade.groupId,
    instrumentName: trade.instrumentName,
    underlying: trade.underlying,
    expiry: trade.expiry,
    strike: trade.strike,
    optionRight: trade.optionRight,
    direction: trade.direction,
    amount: trade.amount,
    priceUsd: trade.priceUsd,
    feeUsd: trade.feeUsd,
    realizedPnlUsd: trade.realizedPnlUsd,
    liquidityRole: trade.liquidityRole,
    timestampMs: trade.timestampMs,
  };
}

export class VenuePositionPersistence {
  private readonly summaries = new Map<string, ExchangeTradeSummary>();
  private readonly positionWrites = new Map<string, Promise<void>>();
  private readonly queuedPositions = new Map<string, PositionLeg[]>();
  // Venue pushes repeat unchanged positions on every mark move; only write when the
  // persisted fields differ so the Neon compute is not kept awake.
  private readonly persistedSignatures = new Map<string, string>();
  private readonly hydrated = new Set<string>();

  constructor(
    private readonly venue: ExchangePortfolioVenue,
    private readonly ledger: ExchangePortfolioLedgerStore,
    private readonly priceAt: PriceAtLookup | null = null,
  ) {}

  isHydrated(accountId: string): boolean {
    return this.hydrated.has(accountId);
  }

  // legId → IV back-solved from the persisted opening fills of each open leg.
  async resolveFillEntryIvs(
    accountId: string,
    legs: PositionLeg[],
  ): Promise<Map<string, number>> {
    const resolved = new Map<string, number>();
    const priceAt = this.priceAt;
    if (!this.ledger.enabled || priceAt == null || legs.length === 0) return resolved;

    const trades = await this.ledger.loadTrades(accountId, this.venue, FILL_HISTORY_LIMIT);
    const tradesByInstrument = new Map<string, PersistedExchangeTrade[]>();
    for (const trade of trades) {
      const key = instrumentKey(trade);
      const bucket = tradesByInstrument.get(key);
      if (bucket == null) tradesByInstrument.set(key, [trade]);
      else bucket.push(trade);
    }

    for (const leg of legs) {
      const legTrades = tradesByInstrument.get(instrumentKey(leg));
      if (legTrades == null) continue;
      const fills: EntryFill[] = await Promise.all(
        legTrades.map(async (trade) => ({
          direction: trade.direction,
          amount: trade.amount,
          priceUsd: trade.priceUsd,
          timestampMs: trade.timestampMs,
          underlyingPriceUsd: await priceAt(trade.underlying, trade.timestampMs).catch(() => null),
        })),
      );
      const entryIv = entryIvFromFills(leg, fills);
      if (entryIv != null) resolved.set(leg.legId, entryIv);
    }
    return resolved;
  }

  async hydrate(accountId: string): Promise<PositionLeg[]> {
    if (!this.ledger.enabled) return [];
    const rows = await this.ledger.loadPositions(accountId, this.venue);
    this.persistedSignatures.set(accountId, positionsSignature(rows));
    this.hydrated.add(accountId);
    const underlyings = [...new Set(rows.map((row) => row.underlying))];
    await Promise.all([
      this.refreshSummary(accountId),
      ...underlyings.map((underlying) => this.refreshSummary(accountId, underlying)),
    ]);
    return rows.map((row) => ({
      ...row,
      venueHint: this.venue,
      source: this.venue,
    }));
  }

  // replacePositions is DELETE + INSERT in one transaction; two overlapping runs for the same
  // account both miss each other's uncommitted rows and the second INSERT hits the primary key.
  // Venues emit a REST bootstrap and a WS snapshot back to back, so writes are serialized per
  // account and a write still waiting in the queue just takes the newest legs.
  // Writes wait for a successful hydrate: replacePositions is a full replace, so
  // writing before the stored rows were read would drop their entry IVs.
  persistPositions(accountId: string, legs: PositionLeg[]): Promise<void> {
    if (!this.ledger.enabled || !this.hydrated.has(accountId)) return Promise.resolve();
    const alreadyQueued = this.queuedPositions.has(accountId);
    this.queuedPositions.set(accountId, legs);
    const inFlight = this.positionWrites.get(accountId);
    if (alreadyQueued && inFlight != null) return inFlight;
    const write = (inFlight ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        const latest = this.queuedPositions.get(accountId) ?? legs;
        this.queuedPositions.delete(accountId);
        const positions = latest.map(toPersistedPosition);
        const signature = positionsSignature(positions);
        if (this.persistedSignatures.get(accountId) === signature) return;
        return this.ledger
          .replacePositions(accountId, this.venue, positions, new Date())
          .then(() => {
            this.persistedSignatures.set(accountId, signature);
          });
      })
      .finally(() => {
        if (this.positionWrites.get(accountId) === write) this.positionWrites.delete(accountId);
      });
    this.positionWrites.set(accountId, write);
    return write;
  }

  async persistTrades(accountId: string, trades: ExchangePortfolioTrade[]): Promise<void> {
    if (!this.ledger.enabled) return;
    await this.ledger.upsertTrades(
      accountId,
      this.venue,
      trades.map(toPersistedTrade),
      new Date(),
    );
    const underlyings = [...new Set(trades.map((trade) => trade.underlying))];
    await Promise.all([
      this.refreshSummary(accountId),
      ...underlyings.map((underlying) => this.refreshSummary(accountId, underlying)),
    ]);
  }

  getAccounting(
    accountId: string,
    positions: PositionLeg[],
    underlying?: string,
  ): PortfolioAccounting {
    let openGrossDebitUsd = 0;
    let openGrossCreditUsd = 0;
    let positionRealizedPnlUsd = 0;
    for (const leg of positions) {
      if (underlying != null && leg.underlying !== underlying) continue;
      const premium = leg.entryPriceUsd * Math.abs(leg.size);
      if (leg.size > 0) openGrossDebitUsd += premium;
      else openGrossCreditUsd += premium;
      positionRealizedPnlUsd += leg.realizedPnlUsd;
    }
    const summary = this.summaries.get(summaryKey(accountId, underlying));
    const hasVenueHistory = summary?.lastSyncedAtMs != null;
    return {
      openGrossDebitUsd,
      openGrossCreditUsd,
      openNetPremiumUsd: openGrossDebitUsd - openGrossCreditUsd,
      lifetimeGrossDebitUsd: hasVenueHistory ? summary.grossBuyPremiumUsd : null,
      lifetimeGrossCreditUsd: hasVenueHistory ? summary.grossSellPremiumUsd : null,
      knownFeesUsd: hasVenueHistory ? summary.knownFeesUsd : null,
      realizedPnlUsd: hasVenueHistory ? summary.realizedPnlUsd : positionRealizedPnlUsd,
      persistedTradeCount: hasVenueHistory ? summary.tradeCount : null,
      historyFromMs: hasVenueHistory ? summary.historyFromMs : null,
      lastSyncedAtMs: summary?.lastSyncedAtMs ?? null,
      persistence: hasVenueHistory
        ? 'venue_history'
        : this.ledger.enabled
          ? 'position_snapshot'
          : 'unavailable',
    };
  }

  private async refreshSummary(accountId: string, underlying?: string): Promise<void> {
    const summary = await this.ledger.loadTradeSummary(accountId, this.venue, underlying);
    this.summaries.set(summaryKey(accountId, underlying), summary);
  }
}
