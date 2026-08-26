import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MergedTradeStore } from './merged-trade-store.js';
import { SqliteTradeStore } from './sqlite-trade-store.js';
import type { MergeableTradeHistoryReader } from './trade-store.js';
import type { PersistedTradeRecord } from './types.js';

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('MergedTradeStore', () => {
  it('merges local and remote rows in tuple order and removes synchronization duplicates', async () => {
    const { local, remote, merged } = stores();
    const duplicate = trade({ tradeUid: 'b', tradeTs: new Date(2_000) });
    local.writeMany([trade({ tradeUid: 'd', tradeTs: new Date(3_000) }), duplicate]);
    remote.writeMany([duplicate, trade({ tradeUid: 'a', tradeTs: new Date(2_000) })]);

    const rows = await merged.loadHistory({ mode: 'live', limit: 10 });

    expect(rows.map((row) => row.tradeUid)).toEqual(['d', 'b', 'a']);
    await merged.dispose();
  });

  it('merges recent local and remote rows before applying the limit', async () => {
    const { local, remote, merged } = stores();
    local.writeMany([trade({ tradeUid: 'local', tradeTs: new Date(3_000) })]);
    remote.writeMany([
      trade({ tradeUid: 'remote-new', tradeTs: new Date(4_000) }),
      trade({ tradeUid: 'remote-old', tradeTs: new Date(2_000) }),
    ]);

    const rows = await merged.loadRecent({ mode: 'live', limit: 2 });

    expect(rows.map((row) => row.tradeUid)).toEqual(['remote-new', 'local']);
    await merged.dispose();
  });

  it('paginates without skips or repeats across local and remote records', async () => {
    const { local, remote, merged } = stores();
    local.writeMany([
      trade({ tradeUid: 'e', tradeTs: new Date(5_000) }),
      trade({ tradeUid: 'c', tradeTs: new Date(3_000) }),
      trade({ tradeUid: 'a', tradeTs: new Date(1_000) }),
    ]);
    remote.writeMany([
      trade({ tradeUid: 'd', tradeTs: new Date(4_000) }),
      trade({ tradeUid: 'b', tradeTs: new Date(2_000) }),
    ]);

    const first = await merged.loadHistory({ mode: 'live', limit: 3 });
    const cursor = first.at(-1);
    if (cursor == null) throw new Error('missing cursor');
    const second = await merged.loadHistory({
      mode: 'live',
      beforeTs: cursor.tradeTs,
      beforeUid: cursor.tradeUid,
      limit: 3,
    });

    expect(first.map((row) => row.tradeUid)).toEqual(['e', 'd', 'c']);
    expect(second.map((row) => row.tradeUid)).toEqual(['b', 'a']);
    await merged.dispose();
  });

  it('uses bytewise UID ordering for same-timestamp pagination', async () => {
    const { local, remote, merged } = stores();
    local.writeMany([trade({ tradeUid: 'a', tradeTs: new Date(2_000) })]);
    remote.writeMany([
      trade({ tradeUid: 'Z', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'A', tradeTs: new Date(2_000) }),
    ]);

    const first = await merged.loadHistory({ mode: 'live', limit: 2 });
    const cursor = first.at(-1);
    if (cursor == null) throw new Error('missing cursor');
    const second = await merged.loadHistory({
      mode: 'live',
      beforeTs: cursor.tradeTs,
      beforeUid: cursor.tradeUid,
      limit: 2,
    });

    expect(first.map((row) => row.tradeUid)).toEqual(['a', 'Z']);
    expect(second.map((row) => row.tradeUid)).toEqual(['A']);
    await merged.dispose();
  });

  it('does not double-count overlapping summary rows', async () => {
    const { local, remote, merged } = stores();
    const duplicate = trade({ tradeUid: 'same', premiumUsd: 100, notionalUsd: 1_000 });
    local.writeMany([
      duplicate,
      trade({ tradeUid: 'local', premiumUsd: 200, notionalUsd: 2_000, venue: 'okx' }),
    ]);
    remote.writeMany([
      duplicate,
      trade({ tradeUid: 'remote', premiumUsd: 300, notionalUsd: 3_000 }),
    ]);

    const summary = await merged.summarizeHistory({ mode: 'live' });

    expect(summary.count).toBe(3);
    expect(summary.premiumUsd).toBe(600);
    expect(summary.notionalUsd).toBe(6_000);
    expect(summary.venues).toEqual([
      { venue: 'deribit', count: 2, premiumUsd: 400, notionalUsd: 4_000 },
      { venue: 'okx', count: 1, premiumUsd: 200, notionalUsd: 2_000 },
    ]);
    await merged.dispose();
  });

  it('holds a local read snapshot while remote summary data changes', async () => {
    const localPath = tempPath('snapshot-local.sqlite');
    const localWriter = new SqliteTradeStore(localPath);
    const localReader = new SqliteTradeStore(localPath, { readOnly: true });
    const remote = new SqliteTradeStore(tempPath('snapshot-remote.sqlite'));
    const duplicate = trade({ tradeUid: 'snapshot' });
    localWriter.writeMany([duplicate]);
    remote.writeMany([duplicate]);
    const racingRemote: MergeableTradeHistoryReader = {
      enabled: true,
      withReadSnapshot: (operation) => operation(),
      loadRecent: (query) => remote.loadRecent(query),
      loadHistory: (query) => remote.loadHistory(query),
      loadByKeys: (query, keys) => remote.loadByKeys(query, keys),
      summarizeHistory: async (query) => {
        localWriter.markUploaded([duplicate]);
        localWriter.deleteUploaded();
        return remote.summarizeHistory(query);
      },
      listInstruments: (query) => remote.listInstruments(query),
      listInstrumentsByNames: (query, names) => remote.listInstrumentsByNames(query, names),
      dispose: () => remote.dispose(),
    };
    const merged = new MergedTradeStore(localReader, racingRemote);

    const summary = await merged.summarizeHistory({ mode: 'live' });

    expect(summary.count).toBe(1);
    await merged.dispose();
    await localWriter.dispose();
  });

  it('selects equal-timestamp instrument metadata by UID', async () => {
    const { local, remote, merged } = stores();
    local.writeMany([trade({ tradeUid: 'A', tradeTs: new Date(2_000), price: 0.1 })]);
    remote.writeMany([trade({ tradeUid: 'z', tradeTs: new Date(2_000), price: 0.9 })]);

    const instruments = await merged.listInstruments({ mode: 'live', limit: 10 });

    expect(instruments[0]?.lastPrice).toBe(0.9);
    await merged.dispose();
  });

  it('combines instrument counts without counting overlap twice', async () => {
    const { local, remote, merged } = stores();
    const duplicate = trade({
      tradeUid: 'same',
      instrumentName: 'BTC-C',
      tradeTs: new Date(2_000),
    });
    local.writeMany([
      duplicate,
      trade({ tradeUid: 'local', instrumentName: 'BTC-C', tradeTs: new Date(3_000), price: 0.3 }),
    ]);
    remote.writeMany([
      duplicate,
      trade({ tradeUid: 'remote', instrumentName: 'BTC-C', tradeTs: new Date(1_000) }),
      trade({
        tradeUid: 'eth',
        underlying: 'ETH',
        instrumentName: 'ETH-C',
        tradeTs: new Date(4_000),
      }),
    ]);

    const instruments = await merged.listInstruments({ mode: 'live', limit: 10 });

    expect(
      instruments.map(({ instrument, count, lastPrice }) => ({ instrument, count, lastPrice })),
    ).toEqual([
      { instrument: 'BTC-C', count: 3, lastPrice: 0.3 },
      { instrument: 'ETH-C', count: 1, lastPrice: 0.1 },
    ]);
    await merged.dispose();
  });

  it('serves a fully local time range without consulting the remote source', async () => {
    const { local, remote, merged } = stores();
    remote.writeMany([trade({ tradeUid: 'old', tradeTs: new Date(1_000) })]);
    local.setRemoteMaxTradeTs('live', 1_000);
    local.writeMany([trade({ tradeUid: 'new', tradeTs: new Date(3_000) })]);
    await remote.dispose();

    const rows = await merged.loadHistory({ mode: 'live', startTs: new Date(2_000), limit: 10 });

    expect(rows.map((row) => row.tradeUid)).toEqual(['new']);
    await local.dispose();
  });
});

function stores(): {
  local: SqliteTradeStore;
  remote: SqliteTradeStore;
  merged: MergedTradeStore;
} {
  const local = new SqliteTradeStore(tempPath('local.sqlite'));
  const remote = new SqliteTradeStore(tempPath('remote.sqlite'));
  return { local, remote, merged: new MergedTradeStore(local, remote) };
}

function tempPath(file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-merged-trades-'));
  dirs.push(dir);
  return join(dir, file);
}

function trade(overrides: Partial<PersistedTradeRecord> = {}): PersistedTradeRecord {
  return {
    tradeUid: 'trade-1',
    mode: 'live',
    venue: 'deribit',
    underlying: 'BTC',
    instrumentName: 'BTC-C',
    tradeTs: new Date(1_000),
    ingestedAt: new Date(1_500),
    direction: 'buy',
    contracts: 1,
    price: 0.1,
    premiumUsd: 100,
    notionalUsd: 1_000,
    referencePriceUsd: 70_000,
    expiry: '2026-06-30',
    strike: 70_000,
    optionType: 'call',
    iv: 0.5,
    markPrice: 0.1,
    isBlock: false,
    strategyLabel: null,
    legs: null,
    raw: {},
    ...overrides,
  };
}
