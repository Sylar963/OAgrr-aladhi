import { describe, expect, it } from 'vitest';
import { NoopFundedStore } from './funded-store.js';

describe('NoopFundedStore', () => {
  it('is disabled and returns empty defaults', async () => {
    const store = new NoopFundedStore();
    expect(store.enabled).toBe(false);
    expect(await store.listActiveTemplates()).toEqual([]);
    expect(await store.getTemplate('tmpl_x')).toBeNull();
    expect(await store.getRun('run_x')).toBeNull();
    expect(await store.listRunsForUser('usr_x')).toEqual([]);
    expect(await store.listActiveRuns()).toEqual([]);
    expect(await store.countRunsForUser('usr_x')).toBe(0);
    expect(await store.countActiveFundedForUser('usr_x')).toBe(0);
    expect(await store.listSettlements('run_x')).toEqual([]);
    expect(await store.listEvents('run_x')).toEqual([]);
    expect(
      await store.insertSettlement({
        runId: 'run_x',
        settledAt: new Date(0),
        equityUsd: 0,
        abcCredited: 0,
        cumulativeProfitUsd: 0,
        traderShareUsd: 0,
        drawdownPct: 0,
        floorBreached: false,
      }),
    ).toBe(false);
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
