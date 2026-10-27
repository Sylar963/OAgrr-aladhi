import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowOiStore } from './flow-oi-store.js';

const tick = { venue: 'deribit' as const, instrument: 'BTC-30OCT26-83000-C', underlying: 'BTC', timestamp: 1000, observedAt: 1001, openInterest: 1196.8 };
const dirs: string[] = [];
const stores: FlowOiStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});
function setup(fail = false) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-oi-'));
  dirs.push(dir);
  const query = vi.fn(async () => { if (fail) throw new Error('offline'); return { rows: [] }; });
  const pool = { query, end: vi.fn(async () => {}) } as unknown as Pool;
  const store = new FlowOiStore(join(dir, 'oi.sqlite'), { pool, flushIntervalMs: 1 });
  stores.push(store);
  return { store, query, pool, dir };
}

describe('local FLOW OI journal and daily archive', () => {
  it('writes, deduplicates and reads brackets without touching Neon', async () => {
    const { store, query } = setup();
    store.append(tick);
    store.append(tick);
    store.append({ ...tick, timestamp: 2000, openInterest: 1197 });
    expect(store.bracket('deribit', tick.instrument, 1500)).toMatchObject({ before: { openInterest: 1196.8 }, after: { openInterest: 1197 } });
    expect(store.bracket('bybit', tick.instrument, 1500).before).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it('archives compressed batches once and keeps them locally readable', async () => {
    const { store, query } = setup();
    store.append(tick);
    await store.flush();
    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(JSON.parse(gunzipSync(call[1][4] as Buffer).toString())).toEqual([tick]);
    await store.flush();
    expect(query).toHaveBeenCalledTimes(1);
    expect(store.bracket('deribit', tick.instrument, 1500).before).toEqual(tick);
  });
  it('never prunes unarchived data after an upload failure', async () => {
    const { store } = setup(true);
    store.append(tick);
    await expect(store.flush()).rejects.toThrow('offline');
    store.prune(3000);
    expect(store.bracket('deribit', tick.instrument, 1500).before).toEqual(tick);
  });
  it('clamps a short configured interval to 24h, including failures and restarts', async () => {
    vi.useFakeTimers();
    const { store, query, dir, pool } = setup(true);
    store.append(tick);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(1);
    await store.dispose();
    stores.pop();
    const restarted = new FlowOiStore(join(dir, 'oi.sqlite'), { pool, flushIntervalMs: 1 });
    stores.push(restarted);
    await vi.advanceTimersByTimeAsync(86_399_000);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('does not upload on shutdown', async () => {
    const { store, query } = setup();
    store.append(tick);
    await store.dispose();
    stores.pop();
    expect(query).not.toHaveBeenCalled();
  });
});
