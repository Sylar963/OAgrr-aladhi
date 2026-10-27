import { analyzeBlockTrade, analyzeFlowTrade, getVenueContractMultiplier, type BlockTradeEvent } from '@oggregator/core';
import type { PersistedTradeRecord } from '@oggregator/db';
import { ExchangeTradeEvidenceSchema, VenueIdSchema, type FlowAnalysis, type FlowTrade } from '@oggregator/protocol';

export function storedFlowTrade(row: PersistedTradeRecord): FlowTrade | null {
  const venue = VenueIdSchema.safeParse(row.venue);
  if (!venue.success) return null;
  const evidence = ExchangeTradeEvidenceSchema.safeParse(row.raw['exchangeEvidence']);
  const trade: FlowTrade = {
    venue: venue.data, tradeUid: row.tradeUid,
    tradeId: typeof row.raw['tradeId'] === 'string' ? row.raw['tradeId']
      : row.tradeUid.startsWith(`${row.venue}:`) ? row.tradeUid.split(':').at(-1) ?? null : null,
    instrument: row.instrumentName, underlying: row.underlying, side: row.direction,
    price: row.price ?? 0,
    size: typeof row.raw['size'] === 'number' ? row.raw['size']
      : row.contracts / getVenueContractMultiplier(row.venue, row.underlying),
    iv: row.iv, markPrice: row.markPrice,
    indexPrice: typeof row.raw['indexPrice'] === 'number' ? row.raw['indexPrice'] : null,
    premiumUsd: row.premiumUsd, notionalUsd: row.notionalUsd,
    referencePriceUsd: row.referencePriceUsd, isBlock: row.isBlock,
    timestamp: row.tradeTs.getTime(),
    ...(evidence.success ? { exchangeEvidence: evidence.data } : {}),
  };
  return { ...trade, analysis: analyzeFlowTrade(trade) };
}

export interface AnalyzedBlockTrade extends BlockTradeEvent {
  tradeUid: string;
  premiumUsd: number | null;
  referencePriceUsd: number | null;
  analysis: FlowAnalysis;
}

export function storedBlockTrade(row: PersistedTradeRecord): AnalyzedBlockTrade | null {
  const venue = VenueIdSchema.safeParse(row.venue);
  if (!venue.success) return null;
  const evidence = ExchangeTradeEvidenceSchema.safeParse(row.raw['exchangeEvidence']);
  const trade: BlockTradeEvent = {
    venue: venue.data, source: row.raw['source'] === 'otc' ? 'otc' : 'rfq',
    tradeId: typeof row.raw['tradeId'] === 'string' ? row.raw['tradeId'] : row.tradeUid,
    timestamp: row.tradeTs.getTime(), underlying: row.underlying,
    direction: row.direction, strategy: row.strategyLabel, legs: row.legs ?? [],
    totalSize: typeof row.raw['totalSize'] === 'number' ? row.raw['totalSize'] : row.contracts,
    notionalUsd: row.notionalUsd ?? 0,
    indexPrice: typeof row.raw['indexPrice'] === 'number' ? row.raw['indexPrice'] : null,
    ...(evidence.success ? { exchangeEvidence: evidence.data } : {}),
  };
  return {
    ...trade, tradeUid: row.tradeUid, premiumUsd: row.premiumUsd,
    referencePriceUsd: row.referencePriceUsd, analysis: analyzeBlockTrade(trade),
  };
}
