import { Pool } from 'pg';

export type FundedRouteType = 'test' | 'instant';

export type FundedRunStatus =
  | 'test_active'
  | 'test_passed'
  | 'test_failed'
  | 'funded_active'
  | 'breached'
  | 'withdrawn';

export type FundedSettlementCadence = 'daily' | 'weekly';

export interface FundedTemplateRow {
  id: string;
  name: string;
  routeType: FundedRouteType;
  testDepositMinUsd: number | null;
  testProfitTargetPct: number | null;
  testMaxDrawdownPct: number | null;
  fundedAbc: number;
  abcFloorPct: number;
  profitSplitPct: number;
  settlementCadence: FundedSettlementCadence;
  maxRunsPerUser: number;
  active: boolean;
  createdAt: Date;
}

export interface FundedRunRow {
  id: string;
  userId: string;
  templateId: string;
  paperAccountId: string;
  routeType: FundedRouteType;
  status: FundedRunStatus;
  depositUsd: number | null;
  abcCredited: number;
  startedAt: Date;
  testPassedAt: Date | null;
  fundedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
}

export interface FundedSettlementRow {
  runId: string;
  settledAt: Date;
  equityUsd: number;
  abcCredited: number;
  cumulativeProfitUsd: number;
  traderShareUsd: number;
  drawdownPct: number;
  floorBreached: boolean;
}

export interface FundedRunEventRow {
  runId: string;
  kind: string;
  summary: string;
  payload: unknown | null;
  ts: Date;
}

export interface FundedRunStatusPatch {
  status: FundedRunStatus;
  abcCredited?: number;
  testPassedAt?: Date | null;
  fundedAt?: Date | null;
  endedAt?: Date | null;
  endReason?: string | null;
}

export interface FundedStore {
  readonly enabled: boolean;
  listActiveTemplates(): Promise<FundedTemplateRow[]>;
  getTemplate(id: string): Promise<FundedTemplateRow | null>;
  insertRun(row: FundedRunRow): Promise<void>;
  getRun(id: string): Promise<FundedRunRow | null>;
  listRunsForUser(userId: string): Promise<FundedRunRow[]>;
  listActiveRuns(): Promise<FundedRunRow[]>;
  countRunsForUser(userId: string): Promise<number>;
  countActiveFundedForUser(userId: string): Promise<number>;
  updateRunStatus(id: string, patch: FundedRunStatusPatch): Promise<void>;
  // Returns true if a new settlement row was inserted, false if it already existed (idempotent).
  insertSettlement(row: FundedSettlementRow): Promise<boolean>;
  listSettlements(runId: string): Promise<FundedSettlementRow[]>;
  insertEvent(row: FundedRunEventRow): Promise<void>;
  listEvents(runId: string): Promise<FundedRunEventRow[]>;
  dispose(): Promise<void>;
}

export class NoopFundedStore implements FundedStore {
  readonly enabled = false;
  async listActiveTemplates(): Promise<FundedTemplateRow[]> {
    return [];
  }
  async getTemplate(_id: string): Promise<FundedTemplateRow | null> {
    return null;
  }
  async insertRun(_row: FundedRunRow): Promise<void> {}
  async getRun(_id: string): Promise<FundedRunRow | null> {
    return null;
  }
  async listRunsForUser(_userId: string): Promise<FundedRunRow[]> {
    return [];
  }
  async listActiveRuns(): Promise<FundedRunRow[]> {
    return [];
  }
  async countRunsForUser(_userId: string): Promise<number> {
    return 0;
  }
  async countActiveFundedForUser(_userId: string): Promise<number> {
    return 0;
  }
  async updateRunStatus(_id: string, _patch: FundedRunStatusPatch): Promise<void> {}
  async insertSettlement(_row: FundedSettlementRow): Promise<boolean> {
    return false;
  }
  async listSettlements(_runId: string): Promise<FundedSettlementRow[]> {
    return [];
  }
  async insertEvent(_row: FundedRunEventRow): Promise<void> {}
  async listEvents(_runId: string): Promise<FundedRunEventRow[]> {
    return [];
  }
  async dispose(): Promise<void> {}
}

interface TemplateDbRow {
  id: string;
  name: string;
  route_type: FundedRouteType;
  test_deposit_min_usd: string | null;
  test_profit_target_pct: string | null;
  test_max_drawdown_pct: string | null;
  funded_abc: string;
  abc_floor_pct: string;
  profit_split_pct: string;
  settlement_cadence: FundedSettlementCadence;
  max_runs_per_user: number;
  active: boolean;
  created_at: Date;
}

interface RunDbRow {
  id: string;
  user_id: string;
  template_id: string;
  paper_account_id: string;
  route_type: FundedRouteType;
  status: FundedRunStatus;
  deposit_usd: string | null;
  abc_credited: string;
  started_at: Date;
  test_passed_at: Date | null;
  funded_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
}

interface SettlementDbRow {
  run_id: string;
  settled_at: Date;
  equity_usd: string;
  abc_credited: string;
  cumulative_profit_usd: string;
  trader_share_usd: string;
  drawdown_pct: string;
  floor_breached: boolean;
}

interface EventDbRow {
  run_id: string;
  kind: string;
  summary: string;
  payload: unknown | null;
  ts: Date;
}

function num(v: string | null): number | null {
  return v == null ? null : Number(v);
}

function mapTemplate(r: TemplateDbRow): FundedTemplateRow {
  return {
    id: r.id,
    name: r.name,
    routeType: r.route_type,
    testDepositMinUsd: num(r.test_deposit_min_usd),
    testProfitTargetPct: num(r.test_profit_target_pct),
    testMaxDrawdownPct: num(r.test_max_drawdown_pct),
    fundedAbc: Number(r.funded_abc),
    abcFloorPct: Number(r.abc_floor_pct),
    profitSplitPct: Number(r.profit_split_pct),
    settlementCadence: r.settlement_cadence,
    maxRunsPerUser: r.max_runs_per_user,
    active: r.active,
    createdAt: r.created_at,
  };
}

function mapRun(r: RunDbRow): FundedRunRow {
  return {
    id: r.id,
    userId: r.user_id,
    templateId: r.template_id,
    paperAccountId: r.paper_account_id,
    routeType: r.route_type,
    status: r.status,
    depositUsd: num(r.deposit_usd),
    abcCredited: Number(r.abc_credited),
    startedAt: r.started_at,
    testPassedAt: r.test_passed_at,
    fundedAt: r.funded_at,
    endedAt: r.ended_at,
    endReason: r.end_reason,
  };
}

function mapSettlement(r: SettlementDbRow): FundedSettlementRow {
  return {
    runId: r.run_id,
    settledAt: r.settled_at,
    equityUsd: Number(r.equity_usd),
    abcCredited: Number(r.abc_credited),
    cumulativeProfitUsd: Number(r.cumulative_profit_usd),
    traderShareUsd: Number(r.trader_share_usd),
    drawdownPct: Number(r.drawdown_pct),
    floorBreached: r.floor_breached,
  };
}

export class PostgresFundedStore implements FundedStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresFundedStore {
    return new PostgresFundedStore(
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async listActiveTemplates(): Promise<FundedTemplateRow[]> {
    const res = await this.pool.query<TemplateDbRow>(
      `SELECT id, name, route_type, test_deposit_min_usd, test_profit_target_pct,
              test_max_drawdown_pct, funded_abc, abc_floor_pct, profit_split_pct,
              settlement_cadence, max_runs_per_user, active, created_at
         FROM funded_challenge_templates
        WHERE active = true
        ORDER BY created_at ASC`,
    );
    return res.rows.map(mapTemplate);
  }

  async getTemplate(id: string): Promise<FundedTemplateRow | null> {
    const res = await this.pool.query<TemplateDbRow>(
      `SELECT id, name, route_type, test_deposit_min_usd, test_profit_target_pct,
              test_max_drawdown_pct, funded_abc, abc_floor_pct, profit_split_pct,
              settlement_cadence, max_runs_per_user, active, created_at
         FROM funded_challenge_templates WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? mapTemplate(res.rows[0]) : null;
  }

  async insertRun(row: FundedRunRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO funded_runs
         (id, user_id, template_id, paper_account_id, route_type, status,
          deposit_usd, abc_credited, started_at, test_passed_at, funded_at, ended_at, end_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.id,
        row.userId,
        row.templateId,
        row.paperAccountId,
        row.routeType,
        row.status,
        row.depositUsd,
        row.abcCredited,
        row.startedAt,
        row.testPassedAt,
        row.fundedAt,
        row.endedAt,
        row.endReason,
      ],
    );
  }

  async getRun(id: string): Promise<FundedRunRow | null> {
    const res = await this.pool.query<RunDbRow>(
      `SELECT id, user_id, template_id, paper_account_id, route_type, status,
              deposit_usd, abc_credited, started_at, test_passed_at, funded_at, ended_at, end_reason
         FROM funded_runs WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? mapRun(res.rows[0]) : null;
  }

  async listRunsForUser(userId: string): Promise<FundedRunRow[]> {
    const res = await this.pool.query<RunDbRow>(
      `SELECT id, user_id, template_id, paper_account_id, route_type, status,
              deposit_usd, abc_credited, started_at, test_passed_at, funded_at, ended_at, end_reason
         FROM funded_runs WHERE user_id = $1 ORDER BY started_at DESC`,
      [userId],
    );
    return res.rows.map(mapRun);
  }

  async listActiveRuns(): Promise<FundedRunRow[]> {
    const res = await this.pool.query<RunDbRow>(
      `SELECT id, user_id, template_id, paper_account_id, route_type, status,
              deposit_usd, abc_credited, started_at, test_passed_at, funded_at, ended_at, end_reason
         FROM funded_runs WHERE status IN ('test_active','funded_active')`,
    );
    return res.rows.map(mapRun);
  }

  async countRunsForUser(userId: string): Promise<number> {
    const res = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM funded_runs WHERE user_id = $1`,
      [userId],
    );
    return Number(res.rows[0]?.count ?? '0');
  }

  async countActiveFundedForUser(userId: string): Promise<number> {
    const res = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM funded_runs
        WHERE user_id = $1 AND status = 'funded_active'`,
      [userId],
    );
    return Number(res.rows[0]?.count ?? '0');
  }

  async updateRunStatus(id: string, patch: FundedRunStatusPatch): Promise<void> {
    await this.pool.query(
      `UPDATE funded_runs SET
         status = $2,
         abc_credited = COALESCE($3, abc_credited),
         test_passed_at = COALESCE($4, test_passed_at),
         funded_at = COALESCE($5, funded_at),
         ended_at = COALESCE($6, ended_at),
         end_reason = COALESCE($7, end_reason)
       WHERE id = $1`,
      [
        id,
        patch.status,
        patch.abcCredited ?? null,
        patch.testPassedAt ?? null,
        patch.fundedAt ?? null,
        patch.endedAt ?? null,
        patch.endReason ?? null,
      ],
    );
  }

  async insertSettlement(row: FundedSettlementRow): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO funded_settlements
         (run_id, settled_at, equity_usd, abc_credited, cumulative_profit_usd,
          trader_share_usd, drawdown_pct, floor_breached)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (run_id, settled_at) DO NOTHING`,
      [
        row.runId,
        row.settledAt,
        row.equityUsd,
        row.abcCredited,
        row.cumulativeProfitUsd,
        row.traderShareUsd,
        row.drawdownPct,
        row.floorBreached,
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listSettlements(runId: string): Promise<FundedSettlementRow[]> {
    const res = await this.pool.query<SettlementDbRow>(
      `SELECT run_id, settled_at, equity_usd, abc_credited, cumulative_profit_usd,
              trader_share_usd, drawdown_pct, floor_breached
         FROM funded_settlements WHERE run_id = $1 ORDER BY settled_at ASC`,
      [runId],
    );
    return res.rows.map(mapSettlement);
  }

  async insertEvent(row: FundedRunEventRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO funded_run_events (run_id, kind, summary, payload, ts)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        row.runId,
        row.kind,
        row.summary,
        row.payload == null ? null : JSON.stringify(row.payload),
        row.ts,
      ],
    );
  }

  async listEvents(runId: string): Promise<FundedRunEventRow[]> {
    const res = await this.pool.query<EventDbRow>(
      `SELECT run_id, kind, summary, payload, ts
         FROM funded_run_events WHERE run_id = $1 ORDER BY ts DESC`,
      [runId],
    );
    return res.rows.map((r) => ({
      runId: r.run_id,
      kind: r.kind,
      summary: r.summary,
      payload: r.payload,
      ts: r.ts,
    }));
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
