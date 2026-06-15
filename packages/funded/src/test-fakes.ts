import type {
  FundedRunEventRow,
  FundedRunRow,
  FundedRunStatusPatch,
  FundedSettlementRow,
  FundedStore,
  FundedTemplateRow,
} from '@oggregator/db';

export class FakeFundedStore implements FundedStore {
  readonly enabled = true;
  templates: FundedTemplateRow[] = [];
  runs = new Map<string, FundedRunRow>();
  settlements: FundedSettlementRow[] = [];
  events: FundedRunEventRow[] = [];

  async listActiveTemplates(): Promise<FundedTemplateRow[]> {
    return this.templates.filter((t) => t.active);
  }
  async getTemplate(id: string): Promise<FundedTemplateRow | null> {
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async insertRun(row: FundedRunRow): Promise<void> {
    this.runs.set(row.id, { ...row });
  }
  async getRun(id: string): Promise<FundedRunRow | null> {
    const r = this.runs.get(id);
    return r ? { ...r } : null;
  }
  async listRunsForUser(userId: string): Promise<FundedRunRow[]> {
    return [...this.runs.values()].filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }
  async listActiveRuns(): Promise<FundedRunRow[]> {
    return [...this.runs.values()]
      .filter((r) => r.status === 'test_active' || r.status === 'funded_active')
      .map((r) => ({ ...r }));
  }
  async countRunsForUser(userId: string): Promise<number> {
    return [...this.runs.values()].filter((r) => r.userId === userId).length;
  }
  async countActiveFundedForUser(userId: string): Promise<number> {
    return [...this.runs.values()].filter(
      (r) => r.userId === userId && r.status === 'funded_active',
    ).length;
  }
  async updateRunStatus(id: string, patch: FundedRunStatusPatch): Promise<void> {
    const r = this.runs.get(id);
    if (!r) return;
    r.status = patch.status;
    if (patch.abcCredited != null) r.abcCredited = patch.abcCredited;
    if (patch.testPassedAt !== undefined) r.testPassedAt = patch.testPassedAt;
    if (patch.fundedAt !== undefined) r.fundedAt = patch.fundedAt;
    if (patch.endedAt !== undefined) r.endedAt = patch.endedAt;
    if (patch.endReason !== undefined) r.endReason = patch.endReason;
  }
  async insertSettlement(row: FundedSettlementRow): Promise<boolean> {
    const exists = this.settlements.some(
      (s) => s.runId === row.runId && s.settledAt.getTime() === row.settledAt.getTime(),
    );
    if (exists) return false;
    this.settlements.push({ ...row });
    return true;
  }
  async listSettlements(runId: string): Promise<FundedSettlementRow[]> {
    return this.settlements
      .filter((s) => s.runId === runId)
      .map((s) => ({ ...s }))
      .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
  }
  async insertEvent(row: FundedRunEventRow): Promise<void> {
    this.events.push({ ...row });
  }
  async listEvents(runId: string): Promise<FundedRunEventRow[]> {
    return this.events.filter((e) => e.runId === runId).map((e) => ({ ...e }));
  }
  async dispose(): Promise<void> {}
}

export function makeTemplate(over: Partial<FundedTemplateRow> = {}): FundedTemplateRow {
  return {
    id: 'tmpl_test',
    name: 'Test 1000',
    routeType: 'test',
    testDepositMinUsd: 100,
    testProfitTargetPct: 0.1,
    testMaxDrawdownPct: 0.3,
    fundedAbc: 1000,
    abcFloorPct: 0.8,
    profitSplitPct: 0.8,
    settlementCadence: 'daily',
    maxRunsPerUser: 3,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}
