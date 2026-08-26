import type { SqliteTradeStore } from './sqlite-trade-store.js';
import type {
  InstrumentListQuery,
  InstrumentSummary,
  MergeableTradeHistoryReader,
  RecentTradeQuery,
  TradeFilterQuery,
  TradeHistoryQuery,
  TradeHistoryReader,
  TradeHistorySummary,
  TradeRecordKey,
  TradeVenueSummary,
} from './trade-store.js';
import type { PersistedTradeMode, PersistedTradeRecord } from './types.js';

interface MergedTradeStoreOptions {
  disposeSources?: boolean;
  overlapBatchSize?: number;
}

const DEFAULT_OVERLAP_BATCH_SIZE = 1_000;

export class MergedTradeStore implements TradeHistoryReader {
  private readonly disposeSources: boolean;
  private readonly overlapBatchSize: number;

  constructor(
    private readonly local: SqliteTradeStore,
    private readonly remote: MergeableTradeHistoryReader | null,
    options: MergedTradeStoreOptions = {},
  ) {
    this.disposeSources = options.disposeSources ?? true;
    this.overlapBatchSize = options.overlapBatchSize ?? DEFAULT_OVERLAP_BATCH_SIZE;
  }

  get enabled(): boolean {
    return this.local.enabled || this.remote?.enabled === true;
  }

  async loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    const localRows = await this.local.loadRecent(query);
    if (this.remote == null || this.canServePageLocally(query, localRows)) return localRows;
    const remoteRows = await this.remote.loadRecent(query);
    return mergeRows(localRows, remoteRows, query.limit);
  }

  async loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    const localRows = await this.local.loadHistory(query);
    if (this.remote == null || this.canServePageLocally(query, localRows)) return localRows;
    const remoteRows = await this.remote.loadHistory(query);
    return mergeRows(localRows, remoteRows, query.limit);
  }

  async summarizeHistory(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
  ): Promise<TradeHistorySummary> {
    return this.withMergedSnapshot(async () => {
      const localSummary = await this.local.summarizeHistory(query);
      if (this.remote == null || this.excludesRemoteByTime(query)) return localSummary;
      const remoteSummary = await this.remote.summarizeHistory(query);
      const overlap = await this.summarizeOverlap(query);
      return combineSummaries(localSummary, remoteSummary, overlap);
    });
  }

  async listInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return this.withMergedSnapshot(async () => {
      const localRows = await this.local.listAllInstruments(query);
      if (this.remote == null || this.excludesRemoteByTime(query))
        return localRows.slice(0, query.limit);

      const [remoteTop, remoteAffected, overlap] = await Promise.all([
        this.remote.listInstruments(query),
        this.loadRemoteAffectedInstruments(
          query,
          localRows.map((row) => row.instrument),
        ),
        this.summarizeInstrumentOverlap(query),
      ]);
      return combineInstrumentSummaries(
        localRows,
        [...remoteTop, ...remoteAffected],
        overlap,
      ).slice(0, query.limit);
    });
  }

  async dispose(): Promise<void> {
    if (!this.disposeSources) return;
    await Promise.all([this.local.dispose(), this.remote?.dispose()]);
  }

  private canServePageLocally(
    query: RecentTradeQuery | TradeHistoryQuery,
    localRows: PersistedTradeRecord[],
  ): boolean {
    const remoteMax = this.remoteMaxForMode(query.mode);
    if (remoteMax == null) return false;
    if (query.startTs && query.startTs.getTime() > remoteMax) return true;
    const last = localRows.at(-1);
    return localRows.length >= query.limit && last != null && last.tradeTs.getTime() > remoteMax;
  }

  private async withMergedSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    return this.local.withReadSnapshot(() =>
      this.remote == null ? operation() : this.remote.withReadSnapshot(operation),
    );
  }

  private excludesRemoteByTime(query: TradeFilterQuery & { mode: PersistedTradeMode }): boolean {
    const remoteMax = this.local.getRemoteMaxTradeTs(query.mode);
    return remoteMax != null && query.startTs != null && query.startTs.getTime() > remoteMax;
  }

  private remoteMaxForMode(mode: PersistedTradeMode | undefined): number | null {
    if (mode != null) return this.local.getRemoteMaxTradeTs(mode);
    const live = this.local.getRemoteMaxTradeTs('live');
    const institutional = this.local.getRemoteMaxTradeTs('institutional');
    return live == null || institutional == null ? null : Math.max(live, institutional);
  }

  private async summarizeOverlap(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
  ): Promise<TradeHistorySummary> {
    const aggregate = createSummaryAggregate();
    await this.forEachOverlap(query, (record) => addSummaryRecord(aggregate, record));
    return finishSummaryAggregate(aggregate);
  }

  private async summarizeInstrumentOverlap(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    await this.forEachOverlap(query, (record) => {
      counts.set(record.instrumentName, (counts.get(record.instrumentName) ?? 0) + 1);
    });
    return counts;
  }

  private async forEachOverlap(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
    visit: (record: PersistedTradeRecord) => void,
  ): Promise<void> {
    if (this.remote == null) return;
    let beforeTs: Date | undefined;
    let beforeUid: string | undefined;

    while (true) {
      const pageQuery: TradeHistoryQuery = {
        ...query,
        limit: this.overlapBatchSize,
        ...(beforeTs == null || beforeUid == null ? {} : { beforeTs, beforeUid }),
      };
      const localRows = await this.local.loadHistory(pageQuery);
      if (localRows.length === 0) return;
      const remoteRows = await this.remote.loadByKeys(query, localRows.map(toKey));
      const remoteKeys = new Set(remoteRows.map(recordKey));
      for (const record of localRows) {
        if (remoteKeys.has(recordKey(record))) visit(record);
      }
      if (localRows.length < this.overlapBatchSize) return;
      const last = localRows.at(-1);
      if (last == null) return;
      beforeTs = last.tradeTs;
      beforeUid = last.tradeUid;
    }
  }

  private async loadRemoteAffectedInstruments(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
    instrumentNames: string[],
  ): Promise<InstrumentSummary[]> {
    if (this.remote == null || instrumentNames.length === 0) return [];
    const rows: InstrumentSummary[] = [];
    for (let index = 0; index < instrumentNames.length; index += this.overlapBatchSize) {
      rows.push(
        ...(await this.remote.listInstrumentsByNames(
          query,
          instrumentNames.slice(index, index + this.overlapBatchSize),
        )),
      );
    }
    return rows;
  }
}

function mergeRows(
  localRows: PersistedTradeRecord[],
  remoteRows: PersistedTradeRecord[],
  limit: number,
): PersistedTradeRecord[] {
  const byKey = new Map<string, PersistedTradeRecord>();
  for (const row of remoteRows) byKey.set(recordKey(row), row);
  for (const row of localRows) byKey.set(recordKey(row), row);
  return [...byKey.values()].sort(compareRecords).slice(0, limit);
}

function compareRecords(left: PersistedTradeRecord, right: PersistedTradeRecord): number {
  const timestampOrder = right.tradeTs.getTime() - left.tradeTs.getTime();
  return timestampOrder === 0
    ? Buffer.compare(Buffer.from(right.tradeUid), Buffer.from(left.tradeUid))
    : timestampOrder;
}

function recordKey(record: TradeRecordKey): string {
  return `${record.tradeUid}\u0000${record.tradeTs.getTime()}`;
}

function toKey(record: PersistedTradeRecord): TradeRecordKey {
  return { tradeUid: record.tradeUid, tradeTs: record.tradeTs };
}

interface SummaryAggregate {
  count: number;
  premiumUsd: number;
  notionalUsd: number;
  oldestTs: Date | null;
  newestTs: Date | null;
  venues: Map<string, TradeVenueSummary>;
}

function createSummaryAggregate(): SummaryAggregate {
  return {
    count: 0,
    premiumUsd: 0,
    notionalUsd: 0,
    oldestTs: null,
    newestTs: null,
    venues: new Map(),
  };
}

function addSummaryRecord(aggregate: SummaryAggregate, record: PersistedTradeRecord): void {
  aggregate.count += 1;
  aggregate.premiumUsd += record.premiumUsd ?? 0;
  aggregate.notionalUsd += record.notionalUsd ?? 0;
  if (aggregate.oldestTs == null || record.tradeTs < aggregate.oldestTs) {
    aggregate.oldestTs = record.tradeTs;
  }
  if (aggregate.newestTs == null || record.tradeTs > aggregate.newestTs) {
    aggregate.newestTs = record.tradeTs;
  }
  const venue = aggregate.venues.get(record.venue) ?? {
    venue: record.venue,
    count: 0,
    premiumUsd: 0,
    notionalUsd: 0,
  };
  venue.count += 1;
  venue.premiumUsd += record.premiumUsd ?? 0;
  venue.notionalUsd += record.notionalUsd ?? 0;
  aggregate.venues.set(record.venue, venue);
}

function finishSummaryAggregate(aggregate: SummaryAggregate): TradeHistorySummary {
  return {
    ...aggregate,
    venues: [...aggregate.venues.values()].sort(
      (left, right) => right.count - left.count || left.venue.localeCompare(right.venue),
    ),
  };
}

function combineSummaries(
  local: TradeHistorySummary,
  remote: TradeHistorySummary,
  overlap: TradeHistorySummary,
): TradeHistorySummary {
  const venues = new Map<string, TradeVenueSummary>();
  for (const summary of [local, remote]) {
    for (const venue of summary.venues) addVenueSummary(venues, venue, 1);
  }
  for (const venue of overlap.venues) addVenueSummary(venues, venue, -1);
  return {
    count: local.count + remote.count - overlap.count,
    premiumUsd: local.premiumUsd + remote.premiumUsd - overlap.premiumUsd,
    notionalUsd: local.notionalUsd + remote.notionalUsd - overlap.notionalUsd,
    oldestTs: minimumDate(local.oldestTs, remote.oldestTs),
    newestTs: maximumDate(local.newestTs, remote.newestTs),
    venues: [...venues.values()]
      .filter((venue) => venue.count > 0)
      .sort((left, right) => right.count - left.count || left.venue.localeCompare(right.venue)),
  };
}

function addVenueSummary(
  venues: Map<string, TradeVenueSummary>,
  incoming: TradeVenueSummary,
  multiplier: 1 | -1,
): void {
  const venue = venues.get(incoming.venue) ?? {
    venue: incoming.venue,
    count: 0,
    premiumUsd: 0,
    notionalUsd: 0,
  };
  venue.count += incoming.count * multiplier;
  venue.premiumUsd += incoming.premiumUsd * multiplier;
  venue.notionalUsd += incoming.notionalUsd * multiplier;
  venues.set(incoming.venue, venue);
}

function minimumDate(left: Date | null, right: Date | null): Date | null {
  if (left == null) return right;
  if (right == null) return left;
  return left < right ? left : right;
}

function maximumDate(left: Date | null, right: Date | null): Date | null {
  if (left == null) return right;
  if (right == null) return left;
  return left > right ? left : right;
}

function combineInstrumentSummaries(
  localRows: InstrumentSummary[],
  remoteRows: InstrumentSummary[],
  overlapCounts: Map<string, number>,
): InstrumentSummary[] {
  const local = new Map(localRows.map((row) => [row.instrument, row]));
  const remote = new Map<string, InstrumentSummary>();
  for (const row of remoteRows) remote.set(row.instrument, row);
  const instruments = new Set([...local.keys(), ...remote.keys()]);
  const combined: InstrumentSummary[] = [];
  for (const instrument of instruments) {
    const localRow = local.get(instrument);
    const remoteRow = remote.get(instrument);
    const latest = latestInstrument(localRow, remoteRow);
    if (latest == null) continue;
    combined.push({
      ...latest,
      count:
        (localRow?.count ?? 0) + (remoteRow?.count ?? 0) - (overlapCounts.get(instrument) ?? 0),
    });
  }
  return combined.sort(
    (left, right) =>
      right.count - left.count ||
      right.lastTs.getTime() - left.lastTs.getTime() ||
      Buffer.compare(Buffer.from(left.instrument), Buffer.from(right.instrument)),
  );
}

function latestInstrument(
  left: InstrumentSummary | undefined,
  right: InstrumentSummary | undefined,
): InstrumentSummary | undefined {
  if (left == null) return right;
  if (right == null) return left;
  const timestampOrder = left.lastTs.getTime() - right.lastTs.getTime();
  if (timestampOrder !== 0) return timestampOrder > 0 ? left : right;
  if (left.lastTradeUid == null) return right;
  if (right.lastTradeUid == null) return left;
  return Buffer.compare(Buffer.from(left.lastTradeUid), Buffer.from(right.lastTradeUid)) >= 0
    ? left
    : right;
}
