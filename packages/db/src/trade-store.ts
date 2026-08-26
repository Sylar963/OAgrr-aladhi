import type { PersistedTradeMode, PersistedTradeRecord } from './types.js';

export interface TradeFilterQuery {
  mode?: PersistedTradeMode;
  underlying?: string;
  venues?: string[];
  instrumentName?: string;
  startTs?: Date;
  endTs?: Date;
}

export interface RecentTradeQuery extends TradeFilterQuery {
  limit: number;
}

export interface TradeHistoryQuery extends TradeFilterQuery {
  mode: PersistedTradeMode;
  beforeTs?: Date;
  beforeUid?: string;
  limit: number;
}

export interface TradeVenueSummary {
  venue: string;
  count: number;
  premiumUsd: number;
  notionalUsd: number;
}

export interface TradeHistorySummary {
  count: number;
  premiumUsd: number;
  notionalUsd: number;
  oldestTs: Date | null;
  newestTs: Date | null;
  venues: TradeVenueSummary[];
}

export interface InstrumentSummary {
  instrument: string;
  count: number;
  lastTs: Date;
  lastTradeUid?: string;
  lastPrice: number | null;
  lastReferencePriceUsd: number | null;
  optionType: 'call' | 'put' | null;
  strike: number | null;
  expiry: string | null;
}

export interface InstrumentListQuery extends TradeFilterQuery {
  mode: PersistedTradeMode;
  limit: number;
}

export interface TradePruneResult {
  deleted: number;
}

export interface TradeRecordKey {
  tradeUid: string;
  tradeTs: Date;
}

export interface TradeHistoryReader {
  readonly enabled: boolean;
  loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]>;
  loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]>;
  summarizeHistory(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
  ): Promise<TradeHistorySummary>;
  listInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]>;
  dispose(): Promise<void>;
}

export interface MergeableTradeHistoryReader extends TradeHistoryReader {
  withReadSnapshot<T>(operation: () => Promise<T>): Promise<T>;
  loadByKeys(query: TradeFilterQuery, keys: TradeRecordKey[]): Promise<PersistedTradeRecord[]>;
  listInstrumentsByNames(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
    instrumentNames: string[],
  ): Promise<InstrumentSummary[]>;
}

export interface TradeStore extends MergeableTradeHistoryReader {
  writeMany(records: PersistedTradeRecord[]): Promise<void>;
  pruneHistory(beforeTs: Date): Promise<TradePruneResult>;
  ensureForwardPartitions(monthsAhead: number): Promise<void>;
}
