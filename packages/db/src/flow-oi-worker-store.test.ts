import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowOiStore } from './flow-oi-store.js';
import { FlowOiWorkerStore } from './flow-oi-worker-store.js';

const workerUrl = new URL('../dist/flow-oi-worker.js', import.meta.url);
const tick = {
  venue: 'deribit' as const,
  instrument: 'BTC-30OCT26-83000-C',
  underlying: 'BTC',
  timestamp: 1000,
  observedAt: 1001,
  openInterest: 1196.8,
  timing: 'sampled' as const,
};
const stores: FlowOiWorkerStore[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(options: ConstructorParameters<typeof FlowOiWorkerStore>[1] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-oi-worker-'));
  dirs.push(dir);
  const path = join(dir, 'oi.sqlite');
  const store = new FlowOiWorkerStore(path, { workerUrl, ...options });
  stores.push(store);
  return { store, path, dir };
}

describe('isolated FLOW OI persistence', () => {
  it('deduplicates writes, publishes only committed samples and reads persisted brackets', async () => {
    const { store } = setup();
    const observed: number[] = [];
    store.subscribe((saved) => observed.push(saved.timestamp));
    store.appendBatch([tick, tick, { ...tick, timestamp: 2000 }]);
    expect(observed).toEqual([]);
    await store.flush();
    expect(observed).toEqual([1000, 2000]);
    expect(await store.bracket('deribit', tick.instrument, 1500)).toEqual({
      before: tick,
      after: { ...tick, timestamp: 2000 },
    });
  });

  it('keeps the main event loop responsive while SQLite waits for a write lock', async () => {
    const { store, path } = setup();
    await store.bracket('deribit', tick.instrument, 1500);
    const db = new DatabaseSync(path);
    db.exec('BEGIN IMMEDIATE');
    try {
      store.append(tick);
      const persisted = store.flush();
      expect(
        await Promise.race([persisted.then(() => 'persisted'), delay(150, 'responsive')]),
      ).toBe('responsive');
      db.exec('ROLLBACK');
      await persisted;
      expect((await store.bracket('deribit', tick.instrument, 1500)).before).toEqual(tick);
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
    }
  });

  it('retains a rolled-back batch for retry and bounds the queue without losing accepted samples', async () => {
    const { store, path } = setup({ maxPendingTicks: 2 });
    await store.bracket('deribit', tick.instrument, 1500);
    const db = new DatabaseSync(path);
    try {
      db.exec(`CREATE TRIGGER reject_oi BEFORE INSERT ON flow_oi
        WHEN NEW.timestamp = 2000 BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
      const listener = vi.fn();
      store.subscribe(listener);
      store.appendBatch([tick, { ...tick, timestamp: 2000 }]);
      expect(() => store.append({ ...tick, timestamp: 3000 })).toThrow('queue is full');
      await expect(store.flush()).rejects.toThrow('test failure');
      expect(listener).not.toHaveBeenCalled();
      db.exec('DROP TRIGGER reject_oi');
      await store.flush();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it('drains accepted writes on shutdown without uploading to Postgres', async () => {
    const { store, path } = setup();
    store.append(tick);
    await store.dispose();
    const reopened = new FlowOiStore(path);
    try {
      expect(reopened.bracket('deribit', tick.instrument, 1500).before).toEqual(tick);
    } finally {
      await reopened.dispose();
    }
  });

  it('restarts a crashed worker and retries its unacknowledged batch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-oi-crash-'));
    dirs.push(dir);
    const entry = join(dir, 'crash-once.mjs');
    const marker = join(dir, 'crashed');
    writeFileSync(
      entry,
      `
      import { existsSync, writeFileSync } from 'node:fs';
      import { parentPort } from 'node:worker_threads';
      if (!existsSync(${JSON.stringify(marker)})) {
        writeFileSync(${JSON.stringify(marker)}, '1');
        parentPort.once('message', () => process.exit(1));
      } else { await import(${JSON.stringify(workerUrl.href)}); }
    `,
    );
    const warn = vi.fn();
    const { store } = setup({ workerUrl: pathToFileURL(entry), log: { warn } });
    const saved = new Promise<void>((resolve) => store.subscribe(() => resolve()));
    store.append(tick);
    await saved;
    expect(warn).toHaveBeenCalled();
    expect((await store.bracket('deribit', tick.instrument, 1500)).before).toEqual(tick);
  }, 10_000);
});
