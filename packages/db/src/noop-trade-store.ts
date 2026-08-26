import type {
  InstrumentListQuery,
  InstrumentSummary,
  RecentTradeQuery,
  TradeFilterQuery,
  TradeHistoryQuery,
  TradeHistorySummary,
  TradePruneResult,
  TradeRecordKey,
  TradeStore,
} from './trade-store.js';
import type { PersistedTradeRecord } from './types.js';

const EMPTY_SUMMARY: TradeHistorySummary = {
  count: 0,
  premiumUsd: 0,
  notionalUsd: 0,
  oldestTs: null,
  newestTs: null,
  venues: [],
};

export class NoopTradeStore implements TradeStore {
  readonly enabled = false;

  async writeMany(_records: PersistedTradeRecord[]): Promise<void> {}

  async withReadSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async loadRecent(_query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return [];
  }

  async loadHistory(_query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    return [];
  }

  async loadByKeys(
    _query: TradeFilterQuery,
    _keys: TradeRecordKey[],
  ): Promise<PersistedTradeRecord[]> {
    return [];
  }

  async summarizeHistory(
    _query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] },
  ): Promise<TradeHistorySummary> {
    return EMPTY_SUMMARY;
  }

  async listInstruments(_query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return [];
  }

  async listInstrumentsByNames(
    _query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] },
    _instrumentNames: string[],
  ): Promise<InstrumentSummary[]> {
    return [];
  }

  async pruneHistory(_beforeTs: Date): Promise<TradePruneResult> {
    return { deleted: 0 };
  }

  async ensureForwardPartitions(_monthsAhead: number): Promise<void> {}

  async dispose(): Promise<void> {}
}
