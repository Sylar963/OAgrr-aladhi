import { describe, expect, it } from 'vitest';
import { FundedEngine } from './engine.js';
import { FakeFundedStore, makeTemplate } from './test-fakes.js';

function makeEngine(opts?: { equity?: number; store?: FakeFundedStore }) {
  const store = opts?.store ?? new FakeFundedStore();
  store.templates.push(makeTemplate());
  store.templates.push(
    makeTemplate({ id: 'tmpl_instant', name: 'Instant 1000', routeType: 'instant' }),
  );
  let seq = 0;
  const created: Array<{ accountId: string; initialCashUsd: number }> = [];
  const closed: string[] = [];
  const engine = new FundedEngine({
    store,
    equitySnapshot: async () => opts?.equity ?? 1000,
    ensureAccount: async (accountId, initialCashUsd) => {
      created.push({ accountId, initialCashUsd });
    },
    closeAllPositions: async (accountId) => {
      closed.push(accountId);
    },
    newId: (prefix) => `${prefix}_${++seq}`,
    now: () => new Date('2026-06-06T08:00:00Z'),
  });
  return { engine, store, created, closed };
}

describe('FundedEngine.startRun', () => {
  it('creates a test-route run with a deposit-funded paper account', async () => {
    const { engine, store, created } = makeEngine();
    const run = await engine.startRun({
      userId: 'usr_1',
      templateId: 'tmpl_test',
      depositUsd: 500,
    });
    expect(run.routeType).toBe('test');
    expect(run.status).toBe('test_active');
    expect(run.depositUsd).toBe(500);
    expect(run.abcCredited).toBe(0);
    expect(created).toEqual([{ accountId: run.paperAccountId, initialCashUsd: 500 }]);
    expect((await store.listEvents(run.id)).some((e) => e.kind === 'created')).toBe(true);
  });

  it('creates an instant-route run funded at full ABC immediately', async () => {
    const { engine, created } = makeEngine();
    const run = await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    expect(run.routeType).toBe('instant');
    expect(run.status).toBe('funded_active');
    expect(run.abcCredited).toBe(1000);
    expect(created).toEqual([{ accountId: run.paperAccountId, initialCashUsd: 1000 }]);
  });

  it('rejects test-route run below deposit minimum', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.startRun({ userId: 'usr_1', templateId: 'tmpl_test', depositUsd: 50 }),
    ).rejects.toThrow(/deposit/i);
  });

  it('enforces max 3 runs per user', async () => {
    const { engine } = makeEngine();
    await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_test', depositUsd: 500 });
    await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_test', depositUsd: 500 });
    await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_test', depositUsd: 500 });
    await expect(
      engine.startRun({ userId: 'usr_1', templateId: 'tmpl_test', depositUsd: 500 }),
    ).rejects.toThrow(/run limit/i);
  });

  it('enforces at most 1 active funded account', async () => {
    const { engine } = makeEngine();
    await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    await expect(engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' })).rejects.toThrow(
      /active funded/i,
    );
  });
});

describe('FundedEngine.settleRun — test route', () => {
  it('passes the test at +10% and grants ABC + funded_active', async () => {
    const { engine, store } = makeEngine({ equity: 1100 });
    const run = await engine.startRun({
      userId: 'usr_1',
      templateId: 'tmpl_test',
      depositUsd: 1000,
    });
    const settledAt = new Date('2026-06-07T08:00:00Z');
    await engine.settleRun(run.id, settledAt);
    const updated = await store.getRun(run.id);
    expect(updated?.status).toBe('funded_active');
    expect(updated?.abcCredited).toBe(1000);
    expect((await store.listEvents(run.id)).some((e) => e.kind === 'test_passed')).toBe(true);
    expect((await store.listEvents(run.id)).some((e) => e.kind === 'funded')).toBe(true);
  });

  it('fails the test at -30% and marks test_failed', async () => {
    const { engine, store } = makeEngine({ equity: 700 });
    const run = await engine.startRun({
      userId: 'usr_1',
      templateId: 'tmpl_test',
      depositUsd: 1000,
    });
    await engine.settleRun(run.id, new Date('2026-06-07T08:00:00Z'));
    const updated = await store.getRun(run.id);
    expect(updated?.status).toBe('test_failed');
    expect(updated?.endReason).toBe('test_failed');
  });
});

describe('FundedEngine.settleRun — funded route', () => {
  it('accrues 80% rev-share on positive cumulative profit', async () => {
    const { engine, store } = makeEngine({ equity: 1500 });
    const run = await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    await engine.settleRun(run.id, new Date('2026-06-07T08:00:00Z'));
    const [s] = await store.listSettlements(run.id);
    expect(s?.cumulativeProfitUsd).toBeCloseTo(500, 8);
    expect(s?.traderShareUsd).toBeCloseTo(400, 8);
    expect(s?.floorBreached).toBe(false);
  });

  it('breaches when equity dips below 80% of ABC', async () => {
    const { engine, store } = makeEngine({ equity: 750 });
    const run = await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    await engine.settleRun(run.id, new Date('2026-06-07T08:00:00Z'));
    const updated = await store.getRun(run.id);
    expect(updated?.status).toBe('breached');
    expect(updated?.endReason).toBe('floor_breached');
    const [s] = await store.listSettlements(run.id);
    expect(s?.floorBreached).toBe(true);
  });

  it('is idempotent: re-settling the same boundary writes no duplicate row and does not double-advance', async () => {
    const { engine, store } = makeEngine({ equity: 750 });
    const run = await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    const at = new Date('2026-06-07T08:00:00Z');
    await engine.settleRun(run.id, at);
    await engine.settleRun(run.id, at);
    expect(await store.listSettlements(run.id)).toHaveLength(1);
  });

  it('skips terminal runs', async () => {
    const { engine, store } = makeEngine({ equity: 1100 });
    const run = await engine.startRun({
      userId: 'usr_1',
      templateId: 'tmpl_test',
      depositUsd: 1000,
    });
    await store.updateRunStatus(run.id, { status: 'test_failed', endReason: 'test_failed' });
    await engine.settleRun(run.id, new Date('2026-06-07T08:00:00Z'));
    expect(await store.listSettlements(run.id)).toHaveLength(0);
  });
});

describe('FundedEngine.settleAllActive', () => {
  it('settles every active run', async () => {
    const store = new FakeFundedStore();
    const { engine } = makeEngine({ equity: 1500, store });
    await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    await engine.startRun({ userId: 'usr_2', templateId: 'tmpl_instant' });
    const n = await engine.settleAllActive(new Date('2026-06-07T08:00:00Z'));
    expect(n).toBe(2);
  });
});

describe('FundedEngine.withdrawRun', () => {
  it('closes positions, finalizes share, marks withdrawn', async () => {
    const { engine, store, closed } = makeEngine({ equity: 1500 });
    const run = await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    await engine.withdrawRun(run.id, run.userId, new Date('2026-06-07T08:00:00Z'));
    const updated = await store.getRun(run.id);
    expect(updated?.status).toBe('withdrawn');
    expect(closed).toContain(run.paperAccountId);
    expect((await store.listEvents(run.id)).some((e) => e.kind === 'withdrawal')).toBe(true);
  });

  it('rejects withdraw by a different user', async () => {
    const { engine } = makeEngine({ equity: 1500 });
    const run = await engine.startRun({ userId: 'usr_1', templateId: 'tmpl_instant' });
    await expect(engine.withdrawRun(run.id, 'usr_other', new Date())).rejects.toThrow(/forbidden/i);
  });
});
