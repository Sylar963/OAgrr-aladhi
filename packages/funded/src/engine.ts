import type {
  FundedRunEventRow,
  FundedRunRow,
  FundedSettlementRow,
  FundedStore,
  FundedTemplateRow,
} from '@oggregator/db';
import { accrueRevShare, computeSettlement, evaluateTestRoute } from './evaluate.js';
import { assertTransition } from './state-machine.js';
import type { EquitySnapshotFn } from './types.js';

export interface FundedEngineDeps {
  store: FundedStore;
  equitySnapshot: EquitySnapshotFn;
  ensureAccount: (accountId: string, initialCashUsd: number) => Promise<void>;
  closeAllPositions: (accountId: string) => Promise<void>;
  newId: (prefix: string) => string;
  now: () => Date;
}

export interface StartRunInput {
  userId: string;
  templateId: string;
  depositUsd?: number;
}

const ACTIVE_TERMINAL: ReadonlySet<string> = new Set(['test_failed', 'breached', 'withdrawn']);

export class FundedEngine {
  constructor(private readonly deps: FundedEngineDeps) {}

  async startRun(input: StartRunInput): Promise<FundedRunRow> {
    const tmpl = await this.deps.store.getTemplate(input.templateId);
    if (!tmpl || !tmpl.active) {
      throw new Error('template not found or inactive');
    }

    const total = await this.deps.store.countRunsForUser(input.userId);
    if (total >= tmpl.maxRunsPerUser) {
      throw new Error(`run limit reached (max ${tmpl.maxRunsPerUser} per user)`);
    }
    const activeFunded = await this.deps.store.countActiveFundedForUser(input.userId);
    if (activeFunded >= 1) {
      throw new Error('at most 1 active funded account allowed');
    }

    const runId = this.deps.newId('run');
    const paperAccountId = this.deps.newId('fundacct');
    const now = this.deps.now();

    let initialCash: number;
    let status: FundedRunRow['status'];
    let depositUsd: number | null;
    let abcCredited: number;
    let fundedAt: Date | null;

    if (tmpl.routeType === 'test') {
      const deposit = input.depositUsd ?? 0;
      const minDeposit = tmpl.testDepositMinUsd ?? 0;
      if (deposit < minDeposit || deposit <= 0) {
        throw new Error(`deposit must be at least ${minDeposit}`);
      }
      initialCash = deposit;
      status = 'test_active';
      depositUsd = deposit;
      abcCredited = 0;
      fundedAt = null;
    } else {
      initialCash = tmpl.fundedAbc;
      status = 'funded_active';
      depositUsd = null;
      abcCredited = tmpl.fundedAbc;
      fundedAt = now;
    }

    await this.deps.ensureAccount(paperAccountId, initialCash);

    const run: FundedRunRow = {
      id: runId,
      userId: input.userId,
      templateId: tmpl.id,
      paperAccountId,
      routeType: tmpl.routeType,
      status,
      depositUsd,
      abcCredited,
      startedAt: now,
      testPassedAt: null,
      fundedAt,
      endedAt: null,
      endReason: null,
    };
    await this.deps.store.insertRun(run);
    await this.event(runId, 'created', `Run created (${tmpl.routeType})`, {
      templateId: tmpl.id,
      depositUsd,
      abcCredited,
    });
    if (tmpl.routeType === 'instant') {
      await this.event(runId, 'funded', `Funded with ${tmpl.fundedAbc} ABC`, {
        abcCredited: tmpl.fundedAbc,
      });
    }
    return run;
  }

  async getRun(id: string): Promise<FundedRunRow | null> {
    return this.deps.store.getRun(id);
  }

  async settleRun(runId: string, settledAt: Date): Promise<void> {
    const run = await this.deps.store.getRun(runId);
    if (!run) return;
    if (ACTIVE_TERMINAL.has(run.status) || run.status === 'test_passed') return;

    const equity = await this.deps.equitySnapshot(run.paperAccountId);
    const tmpl = await this.deps.store.getTemplate(run.templateId);
    if (!tmpl) return;

    if (run.status === 'test_active') {
      await this.settleTestRoute(run, tmpl, equity, settledAt);
      return;
    }
    if (run.status === 'funded_active') {
      await this.settleFundedRoute(run, tmpl, equity, settledAt);
    }
  }

  private async settleTestRoute(
    run: FundedRunRow,
    tmpl: FundedTemplateRow,
    equity: number,
    settledAt: Date,
  ): Promise<void> {
    const deposit = run.depositUsd ?? 0;
    const outcome = evaluateTestRoute(
      equity,
      deposit,
      tmpl.testProfitTargetPct ?? 0,
      tmpl.testMaxDrawdownPct ?? 0,
    );

    const settlement: FundedSettlementRow = {
      runId: run.id,
      settledAt,
      equityUsd: equity,
      abcCredited: 0,
      cumulativeProfitUsd: equity - deposit,
      traderShareUsd: 0,
      drawdownPct: deposit > 0 ? Math.max(0, (deposit - equity) / deposit) : 0,
      floorBreached: false,
    };
    const wrote = await this.deps.store.insertSettlement(settlement);
    if (!wrote) return;
    await this.event(run.id, 'settlement', `Test settlement: equity ${equity}`, settlement);

    if (outcome.result === 'fail') {
      assertTransition(run.status, 'test_failed');
      await this.deps.store.updateRunStatus(run.id, {
        status: 'test_failed',
        endedAt: settledAt,
        endReason: 'test_failed',
      });
      await this.event(run.id, 'test_failed', 'Test failed (max drawdown breached)', { equity });
      return;
    }
    if (outcome.result === 'pass') {
      assertTransition(run.status, 'test_passed');
      await this.deps.store.updateRunStatus(run.id, {
        status: 'test_passed',
        testPassedAt: settledAt,
      });
      await this.event(run.id, 'test_passed', 'Test passed (+target reached)', { equity });
      assertTransition('test_passed', 'funded_active');
      await this.deps.store.updateRunStatus(run.id, {
        status: 'funded_active',
        abcCredited: tmpl.fundedAbc,
        fundedAt: settledAt,
      });
      await this.deps.ensureAccount(run.paperAccountId, tmpl.fundedAbc);
      await this.event(run.id, 'funded', `Funded with ${tmpl.fundedAbc} ABC`, {
        abcCredited: tmpl.fundedAbc,
      });
    }
  }

  private async settleFundedRoute(
    run: FundedRunRow,
    tmpl: FundedTemplateRow,
    equity: number,
    settledAt: Date,
  ): Promise<void> {
    const c = computeSettlement(equity, run.abcCredited, tmpl.abcFloorPct, tmpl.profitSplitPct);
    const settlement: FundedSettlementRow = {
      runId: run.id,
      settledAt,
      equityUsd: equity,
      abcCredited: run.abcCredited,
      cumulativeProfitUsd: c.cumulativeProfitUsd,
      traderShareUsd: c.traderShareUsd,
      drawdownPct: c.drawdownPct,
      floorBreached: c.floorBreached,
    };
    const wrote = await this.deps.store.insertSettlement(settlement);
    if (!wrote) return;
    await this.event(
      run.id,
      'settlement',
      `Settlement: equity ${equity}, share ${c.traderShareUsd}`,
      settlement,
    );

    if (c.floorBreached) {
      assertTransition(run.status, 'breached');
      await this.deps.store.updateRunStatus(run.id, {
        status: 'breached',
        endedAt: settledAt,
        endReason: 'floor_breached',
      });
      await this.event(run.id, 'breach', 'Floor breached — ABC burned', { equity });
    }
  }

  async settleAllActive(settledAt: Date): Promise<number> {
    const active = await this.deps.store.listActiveRuns();
    let count = 0;
    for (const run of active) {
      await this.settleRun(run.id, settledAt);
      count += 1;
    }
    return count;
  }

  async withdrawRun(runId: string, userId: string, at: Date): Promise<void> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw new Error('run not found');
    if (run.userId !== userId) throw new Error('forbidden');
    if (run.status !== 'funded_active') {
      throw new Error('only funded_active runs can be withdrawn');
    }
    await this.deps.closeAllPositions(run.paperAccountId);
    const equity = await this.deps.equitySnapshot(run.paperAccountId);
    const tmpl = await this.deps.store.getTemplate(run.templateId);
    if (!tmpl) throw new Error('funded template not found for run');
    const share = accrueRevShare(equity, run.abcCredited, tmpl.profitSplitPct);
    assertTransition(run.status, 'withdrawn');
    await this.deps.store.updateRunStatus(run.id, {
      status: 'withdrawn',
      endedAt: at,
      endReason: 'withdrawn',
    });
    await this.event(run.id, 'withdrawal', `Withdrawn — final share ${share}`, {
      equity,
      traderShareUsd: share,
    });
  }

  private async event(
    runId: string,
    kind: string,
    summary: string,
    payload: unknown,
  ): Promise<void> {
    const row: FundedRunEventRow = {
      runId,
      kind,
      summary,
      payload,
      ts: this.deps.now(),
    };
    await this.deps.store.insertEvent(row);
  }
}
