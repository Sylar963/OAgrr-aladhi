import { describe, expect, it } from 'vitest';
import { NoopOiSnapshotStore, type PersistedOiSnapshot } from './oi-snapshot-store.js';

const row: PersistedOiSnapshot = {
  venue: 'deribit',
  underlying: 'BTC',
  instrumentName: 'BTC-30JUN26-70000-C',
  expiry: '2026-06-30',
  strike: 70000,
  optionType: 'call',
  openInterest: 100,
  snapshotTs: new Date(1_000),
};

describe('NoopOiSnapshotStore', () => {
  it('is disabled and no-ops', async () => {
    const store = new NoopOiSnapshotStore();
    expect(store.enabled).toBe(false);
    await expect(store.writeMany([row])).resolves.toBeUndefined();
    await expect(store.prune(new Date())).resolves.toBe(0);
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
