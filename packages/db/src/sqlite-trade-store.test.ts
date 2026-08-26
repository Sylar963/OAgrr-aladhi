import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteTradeStore } from './sqlite-trade-store.js';
import type { PersistedTradeRecord } from './types.js';

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('SqliteTradeStore', () => {
  it('preserves every persisted field and JSON payload', async () => {
    const store = createStore();
    const row = trade({
      legs: [{ instrument: 'BTC-C', direction: 'sell', price: 0.2, size: 4, ratio: 2 }],
      raw: { nested: { values: [1, 'two', null] } },
    });

    store.writeMany([row], 123);
    const loaded = await store.loadHistory({ mode: 'live', limit: 10 });

    expect(loaded).toEqual([row]);
    await store.dispose();
  });

  it('ignores only composite-key conflicts and rejects other constraint failures', async () => {
    const store = createStore();
    const row = trade();
    store.writeMany([row, row]);

    expect(() =>
      store.writeMany([trade({ tradeUid: 'invalid', contracts: Number.NaN })]),
    ).toThrow();
    expect(await store.loadHistory({ mode: 'live', limit: 10 })).toHaveLength(1);
    await store.dispose();
  });

  it('applies every history filter with exclusive end timestamps', async () => {
    const store = createStore();
    store.writeMany([
      trade({ tradeUid: 'match', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'wrong-mode', mode: 'institutional', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'wrong-underlying', underlying: 'ETH', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'wrong-venue', venue: 'okx', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'wrong-instrument', instrumentName: 'BTC-P', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'too-old', tradeTs: new Date(999) }),
      trade({ tradeUid: 'at-end', tradeTs: new Date(3_000) }),
    ]);

    const rows = await store.loadHistory({
      mode: 'live',
      underlying: 'btc',
      venues: ['deribit'],
      instrumentName: 'BTC-C',
      startTs: new Date(1_000),
      endTs: new Date(3_000),
      limit: 20,
    });

    expect(rows.map((row) => row.tradeUid)).toEqual(['match']);
    await store.dispose();
  });

  it('supports stable tuple cursor pagination', async () => {
    const store = createStore();
    store.writeMany([
      trade({ tradeUid: 'c', tradeTs: new Date(3_000) }),
      trade({ tradeUid: 'b', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'a', tradeTs: new Date(2_000) }),
      trade({ tradeUid: 'z', tradeTs: new Date(1_000) }),
    ]);

    const first = await store.loadHistory({ mode: 'live', limit: 2 });
    const cursor = first.at(-1);
    if (cursor == null) throw new Error('missing cursor row');
    const second = await store.loadHistory({
      mode: 'live',
      beforeTs: cursor.tradeTs,
      beforeUid: cursor.tradeUid,
      limit: 2,
    });

    expect(first.map((row) => row.tradeUid)).toEqual(['c', 'b']);
    expect(second.map((row) => row.tradeUid)).toEqual(['a', 'z']);
    await store.dispose();
  });

  it('aggregates summaries and latest instruments', async () => {
    const store = createStore();
    store.writeMany([
      trade({ tradeUid: 'btc-1', premiumUsd: 100, notionalUsd: 1_000, tradeTs: new Date(1_000) }),
      trade({
        tradeUid: 'btc-2',
        premiumUsd: null,
        notionalUsd: 2_000,
        tradeTs: new Date(2_000),
        price: 0.2,
      }),
      trade({
        tradeUid: 'eth-1',
        underlying: 'ETH',
        instrumentName: 'ETH-C',
        venue: 'okx',
        premiumUsd: 300,
        notionalUsd: null,
        tradeTs: new Date(3_000),
      }),
    ]);

    const summary = await store.summarizeHistory({ mode: 'live' });
    const instruments = await store.listInstruments({ mode: 'live', limit: 10 });

    expect(summary).toEqual({
      count: 3,
      premiumUsd: 400,
      notionalUsd: 3_000,
      oldestTs: new Date(1_000),
      newestTs: new Date(3_000),
      venues: [
        { venue: 'deribit', count: 2, premiumUsd: 100, notionalUsd: 3_000 },
        { venue: 'okx', count: 1, premiumUsd: 300, notionalUsd: 0 },
      ],
    });
    expect(
      instruments.map(({ instrument, count, lastPrice }) => ({ instrument, count, lastPrice })),
    ).toEqual([
      { instrument: 'BTC-C', count: 2, lastPrice: 0.2 },
      { instrument: 'ETH-C', count: 1, lastPrice: 0.1 },
    ]);
    await store.dispose();
  });

  it('allows a read-only server connection while ingest writes in WAL mode', async () => {
    const path = tempPath();
    const writer = new SqliteTradeStore(path);
    const reader = new SqliteTradeStore(path, { readOnly: true, busyTimeoutMs: 1_000 });
    writer.writeMany([trade({ tradeUid: 'first' })]);

    const firstRead = await reader.loadHistory({ mode: 'live', limit: 10 });
    writer.writeMany([trade({ tradeUid: 'second', tradeTs: new Date(2_000) })]);
    const secondRead = await reader.loadHistory({ mode: 'live', limit: 10 });

    expect(firstRead.map((row) => row.tradeUid)).toEqual(['first']);
    expect(secondRead.map((row) => row.tradeUid)).toEqual(['second', 'first']);
    await Promise.all([reader.dispose(), writer.dispose()]);
  });
});

function createStore(): SqliteTradeStore {
  return new SqliteTradeStore(tempPath());
}

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-sqlite-trades-'));
  dirs.push(dir);
  return join(dir, 'trades.sqlite');
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
    raw: { source: 'test' },
    ...overrides,
  };
}
