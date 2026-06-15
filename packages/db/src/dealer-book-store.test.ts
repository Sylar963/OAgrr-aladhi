import { describe, expect, it } from 'vitest';
import { NoopDealerBookStore, type PersistedDealerPosition } from './dealer-book-store.js';

const pos: PersistedDealerPosition = {
  venue: 'deribit',
  underlying: 'BTC',
  instrumentName: 'BTC-30JUN26-70000-C',
  expiry: '2026-06-30',
  strike: 70000,
  optionType: 'call',
  dealerContracts: -42,
  lastOi: 100,
  lastSnapshotTs: new Date(1_000),
};

describe('NoopDealerBookStore', () => {
  it('is disabled and no-ops', async () => {
    const store = new NoopDealerBookStore();
    expect(store.enabled).toBe(false);
    await expect(store.loadAll(['BTC'])).resolves.toEqual([]);
    await expect(store.upsertMany([pos])).resolves.toBeUndefined();
    await expect(store.pruneExpired('2026-06-30')).resolves.toBe(0);
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
