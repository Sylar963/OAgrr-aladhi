import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VOL_HEATMAP_RETENTION_MS, type VolHeatmapHistoryRecord } from '@oggregator/protocol';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolHeatmapHistoryStore } from './vol-heatmap-store.js';

const DAY = VOL_HEATMAP_RETENTION_MS;
const NOW = DAY * 3;
const paths: string[] = [];
const stores: VolHeatmapHistoryStore[] = [];
const log = { warn: vi.fn() };

function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vol-heatmap-'));
  paths.push(dir);
  return join(dir, 'history.ndjson');
}

function row(t = NOW - 15_000, currency: 'BTC' | 'ETH' = 'BTC'): VolHeatmapHistoryRecord {
  return {
    currency,
    column: {
      t, dvol: 0.37, cells: [[148, 40, 20]], adjCells: [[146, 40, 20]], atmMid: 0.365,
      trades: [{ t: t + 1000, instrument: `${currency}-option`, side: 'buy', iv: 0.37,
        adjIv: 0.365, amount: 1, vega: 10 }],
    },
    meta: { expiries: ['2026-11-27'], instruments: 18, updatedAt: t },
  };
}

function store(options: ConstructorParameters<typeof VolHeatmapHistoryStore>[0]): VolHeatmapHistoryStore {
  const instance = new VolHeatmapHistoryStore({ now: () => NOW, ...options }, log);
  stores.push(instance);
  return instance;
}

function database() {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as { record: unknown }[] }));
  return { query, end: vi.fn(async () => {}) };
}

afterEach(async () => {
  for (const instance of stores.splice(0)) await instance.dispose();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('VolHeatmapHistoryStore', () => {
  it('restores complete BTC and ETH columns before shutdown or any database sync', async () => {
    const path = cachePath();
    const first = store({ cachePath: path });
    first.append(row());
    first.append(row(NOW - 15_000, 'ETH'));
    first.append(row());
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
    const restarted = store({ cachePath: path });
    expect(await restarted.loadSince(NOW - DAY)).toEqual([row(), row(NOW - 15_000, 'ETH')]);
  });

  it('drops expired and future data and repairs a torn final line before appending', async () => {
    const path = cachePath();
    writeFileSync(path, [row(NOW - DAY - 1), row(NOW - DAY), row(NOW + 15_000)]
      .map((value) => JSON.stringify(value)).join('\n') + '\n{"column":');
    const instance = store({ cachePath: path });
    instance.append(row());
    expect(await instance.loadSince(0)).toEqual([row(NOW - DAY), row()]);
    expect(readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
      .toEqual([row(NOW - DAY), row()]);
    expect(log.warn).toHaveBeenCalled();
  });

  it('prunes the disk cache after an hour even when the feed is silent', async () => {
    vi.useFakeTimers({ now: NOW });
    const path = cachePath();
    const instance = store({ cachePath: path, now: Date.now });
    instance.append(row(NOW - DAY + 30 * 60_000));
    instance.append(row());
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(await instance.loadSince(0)).toEqual([row()]);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('keeps database writes on the daily cadence across restarts and never flushes on shutdown', async () => {
    vi.useFakeTimers({ now: NOW });
    const path = cachePath();
    writeFileSync(`${path}.last-flush`, String(NOW));
    const db = database();
    const first = store({ cachePath: path, pool: db as unknown as Pool, flushIntervalMs: 0, now: Date.now });
    first.append(row());
    await vi.advanceTimersByTimeAsync(12 * 3_600_000);
    expect(db.query).not.toHaveBeenCalled();
    await first.dispose();
    stores.splice(stores.indexOf(first), 1);
    expect(db.query).not.toHaveBeenCalled();
    const restarted = store({ cachePath: path, pool: db as unknown as Pool, now: Date.now });
    restarted.append(row(Date.now() - 15_000, 'ETH'));
    await vi.advanceTimersByTimeAsync(12 * 3_600_000 - 1);
    expect(db.query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0]?.[0]).toContain('ON CONFLICT (currency, slot_ts) DO NOTHING');
    expect(db.query.mock.calls[1]?.[0]).toContain('DELETE');
  });

  it('keeps local history when Postgres is unavailable and retries failed batches', async () => {
    const path = cachePath();
    const db = database();
    const instance = store({ cachePath: path, pool: db as unknown as Pool });
    instance.append(row());
    db.query.mockRejectedValueOnce(new Error('offline'));
    expect(await instance.loadSince(NOW - DAY)).toEqual([row()]);
    db.query.mockRejectedValueOnce(new Error('offline'));
    await expect(instance.flush()).rejects.toThrow('offline');
    expect(readFileSync(path, 'utf8')).toContain('BTC');
    await instance.flush();
    expect(db.query.mock.calls.at(-2)?.[1]?.[2]).toBe(JSON.stringify(row()));
    expect(db.query.mock.calls.at(-1)?.[0]).toContain('DELETE');
  });

  it('merges one database hydrate with local data, preferring local duplicates and saving recovered rows', async () => {
    const path = cachePath();
    const db = database();
    const instance = store({ cachePath: path, pool: db as unknown as Pool });
    instance.append(row());
    const remote = row(NOW - 30_000, 'ETH');
    db.query.mockResolvedValueOnce({ rows: [
      { record: { ...row(), meta: null } }, { record: remote },
      { record: row(NOW - DAY - 1) }, { record: { invalid: true } },
    ] });
    expect(await instance.loadSince(NOW - DAY)).toEqual([remote, row()]);
    const restarted = store({ cachePath: path });
    expect(await restarted.loadSince(NOW - DAY)).toEqual([remote, row()]);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('batches a full day of columns and does not clear concurrent local appends during a sync', async () => {
    const path = cachePath();
    const db = database();
    const instance = store({ cachePath: path, pool: db as unknown as Pool });
    for (let i = 1; i <= 251; i++) instance.append(row(NOW - i * 15_000));
    const flushing = instance.flush();
    instance.append(row(NOW, 'ETH'));
    await flushing;
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[0]?.[1]).toHaveLength(750);
    expect(db.query.mock.calls[1]?.[1]).toHaveLength(3);
    const restarted = store({ cachePath: path });
    expect(await restarted.loadSince(NOW)).toEqual([row(NOW, 'ETH')]);
  });
});
