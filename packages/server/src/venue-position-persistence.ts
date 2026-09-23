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

  async persistPositions(accountId: string, legs: PositionLeg[]): Promise<void> {
    if (!this.ledger.enabled) return;
    await this.ledger.replacePositions(
      accountId,
      this.venue,
      legs.map(toPersistedPosition),
      new Date(),
    );
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
