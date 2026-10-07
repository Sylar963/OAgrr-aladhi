import type { PositionLeg } from '@oggregator/core';
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

  constructor(
    private readonly venue: ExchangePortfolioVenue,
    private readonly ledger: ExchangePortfolioLedgerStore,
  ) {}

  async hydrate(accountId: string): Promise<PositionLeg[]> {
    if (!this.ledger.enabled) return [];
    const rows = await this.ledger.loadPositions(accountId, this.venue);
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
  persistPositions(accountId: string, legs: PositionLeg[]): Promise<void> {
    if (!this.ledger.enabled) return Promise.resolve();
    const alreadyQueued = this.queuedPositions.has(accountId);
    this.queuedPositions.set(accountId, legs);
    const inFlight = this.positionWrites.get(accountId);
    if (alreadyQueued && inFlight != null) return inFlight;
    const write = (inFlight ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        const latest = this.queuedPositions.get(accountId) ?? legs;
        this.queuedPositions.delete(accountId);
        return this.ledger.replacePositions(
          accountId,
          this.venue,
          latest.map(toPersistedPosition),
          new Date(),
        );
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
