import { Pool } from 'pg';

export interface PaperAccountRow {
  id: string;
  label: string;
  initialCashUsd: number;
  createdAt: Date;
}

export interface PaperOrderRow {
  id: string;
  clientOrderId: string;
  accountId: string;
  mode: 'paper' | 'live';
  kind: 'market';
  status: 'accepted' | 'filled' | 'rejected' | 'cancelled';
  legs: unknown;
  submittedAt: Date;
  filledAt: Date | null;
  rejectionReason: string | null;
  totalDebitUsd: number | null;
}

export interface PaperFillRow {
  id: string;
  orderId: string;
  legIndex: number;
  venue: string;
  side: 'buy' | 'sell';
  optionRight: 'call' | 'put';
  underlying: string;
  expiry: string;
  strike: number;
  quantity: number;
  priceUsd: number;
  feesUsd: number;
  source: 'paper' | 'live';
  filledAt: Date;
}

export interface PaperPositionRow {
  accountId: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  netQuantity: number;
  avgEntryPriceUsd: number;
  realizedPnlUsd: number;
  openedAt: Date;
  lastFillAt: Date;
}

export interface PaperCashLedgerRow {
  accountId: string;
  deltaUsd: number;
  reason: 'fill' | 'fee' | 'init' | 'adjustment';
  refId: string | null;
  ts: Date;
}

export interface PaperTradingStore {
  readonly enabled: boolean;
  ensureAccount(row: PaperAccountRow): Promise<void>;
  getAccount(id: string): Promise<PaperAccountRow | null>;

  insertOrder(row: PaperOrderRow): Promise<void>;
  updateOrder(row: PaperOrderRow): Promise<void>;
  getOrder(id: string): Promise<PaperOrderRow | null>;
  listOrders(accountId: string, limit: number): Promise<PaperOrderRow[]>;

  insertFills(rows: PaperFillRow[]): Promise<void>;
  listFills(accountId: string, limit: number): Promise<PaperFillRow[]>;

  upsertPosition(row: PaperPositionRow): Promise<void>;
  listPositions(accountId: string): Promise<PaperPositionRow[]>;

  appendCashLedger(row: PaperCashLedgerRow): Promise<void>;
  sumCashLedger(accountId: string): Promise<number>;

  dispose(): Promise<void>;
}

export class NoopPaperTradingStore implements PaperTradingStore {
  readonly enabled = false;
  async ensureAccount(): Promise<void> {}
  async getAccount(): Promise<PaperAccountRow | null> {
    return null;
  }
  async insertOrder(): Promise<void> {}
  async updateOrder(): Promise<void> {}
  async getOrder(): Promise<PaperOrderRow | null> {
    return null;
  }
  async listOrders(): Promise<PaperOrderRow[]> {
    return [];
  }
  async insertFills(): Promise<void> {}
  async listFills(): Promise<PaperFillRow[]> {
    return [];
  }
  async upsertPosition(): Promise<void> {}
  async listPositions(): Promise<PaperPositionRow[]> {
    return [];
  }
  async appendCashLedger(): Promise<void> {}
  async sumCashLedger(): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

export class PostgresPaperTradingStore implements PaperTradingStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresPaperTradingStore {
    return new PostgresPaperTradingStore(new Pool({ connectionString }));
  }

  async ensureAccount(row: PaperAccountRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO paper_accounts (id, label, initial_cash_usd, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.label, row.initialCashUsd, row.createdAt],
    );
    const ledger = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM paper_cash_ledger WHERE account_id = $1`,
      [row.id],
    );
    if (Number(ledger.rows[0]?.count ?? '0') === 0) {
      await this.pool.query(
        `INSERT INTO paper_cash_ledger (account_id, delta_usd, reason, ref_id, ts)
         VALUES ($1, $2, 'init', NULL, $3)`,
        [row.id, row.initialCashUsd, row.createdAt],
      );
    }
  }

  async getAccount(id: string): Promise<PaperAccountRow | null> {
    const res = await this.pool.query<{
      id: string;
      label: string;
      initial_cash_usd: string;
      created_at: Date;
    }>(
      `SELECT id, label, initial_cash_usd, created_at FROM paper_accounts WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      initialCashUsd: Number(row.initial_cash_usd),
      createdAt: row.created_at,
    };
  }

  async insertOrder(row: PaperOrderRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO paper_orders (
        id, client_order_id, account_id, mode, kind, status,
        legs, submitted_at, filled_at, rejection_reason, total_debit_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        row.id,
        row.clientOrderId,
        row.accountId,
        row.mode,
        row.kind,
        row.status,
        JSON.stringify(row.legs),
        row.submittedAt,
        row.filledAt,
        row.rejectionReason,
        row.totalDebitUsd,
      ],
    );
  }

  async updateOrder(row: PaperOrderRow): Promise<void> {
    await this.pool.query(
      `UPDATE paper_orders
       SET status = $2,
           filled_at = $3,
           rejection_reason = $4,
           total_debit_usd = $5
       WHERE id = $1`,
      [row.id, row.status, row.filledAt, row.rejectionReason, row.totalDebitUsd],
    );
  }

  async getOrder(id: string): Promise<PaperOrderRow | null> {
    const res = await this.pool.query<OrderRowDb>(
      `SELECT * FROM paper_orders WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapOrderRow(row) : null;
  }

  async listOrders(accountId: string, limit: number): Promise<PaperOrderRow[]> {
    const res = await this.pool.query<OrderRowDb>(
      `SELECT * FROM paper_orders
       WHERE account_id = $1
       ORDER BY submitted_at DESC
       LIMIT $2`,
      [accountId, limit],
    );
    return res.rows.map(mapOrderRow);
  }

  async insertFills(rows: PaperFillRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders = rows.map((row, i) => {
      const o = i * 14;
      values.push(
        row.id,
        row.orderId,
        row.legIndex,
        row.venue,
        row.side,
        row.optionRight,
        row.underlying,
        row.expiry,
        row.strike,
        row.quantity,
        row.priceUsd,
        row.feesUsd,
        row.source,
        row.filledAt,
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10}, $${o + 11}, $${o + 12}, $${o + 13}, $${o + 14})`;
    });
    await this.pool.query(
      `INSERT INTO paper_fills (
        id, order_id, leg_index, venue, side, option_right,
        underlying, expiry, strike, quantity, price_usd, fees_usd, source, filled_at
      ) VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  async listFills(accountId: string, limit: number): Promise<PaperFillRow[]> {
    const res = await this.pool.query<FillRowDb>(
      `SELECT f.* FROM paper_fills f
       JOIN paper_orders o ON o.id = f.order_id
       WHERE o.account_id = $1
       ORDER BY f.filled_at DESC
       LIMIT $2`,
      [accountId, limit],
    );
    return res.rows.map(mapFillRow);
  }

  async upsertPosition(row: PaperPositionRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO paper_positions (
        account_id, underlying, expiry, strike, option_right,
        net_quantity, avg_entry_price_usd, realized_pnl_usd, opened_at, last_fill_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (account_id, underlying, expiry, strike, option_right)
       DO UPDATE SET
         net_quantity = EXCLUDED.net_quantity,
         avg_entry_price_usd = EXCLUDED.avg_entry_price_usd,
         realized_pnl_usd = EXCLUDED.realized_pnl_usd,
         opened_at = EXCLUDED.opened_at,
         last_fill_at = EXCLUDED.last_fill_at`,
      [
        row.accountId,
        row.underlying,
        row.expiry,
        row.strike,
        row.optionRight,
        row.netQuantity,
        row.avgEntryPriceUsd,
        row.realizedPnlUsd,
        row.openedAt,
        row.lastFillAt,
      ],
    );
  }

  async listPositions(accountId: string): Promise<PaperPositionRow[]> {
    const res = await this.pool.query<PositionRowDb>(
      `SELECT * FROM paper_positions WHERE account_id = $1`,
      [accountId],
    );
    return res.rows.map(mapPositionRow);
  }

  async appendCashLedger(row: PaperCashLedgerRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO paper_cash_ledger (account_id, delta_usd, reason, ref_id, ts)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.accountId, row.deltaUsd, row.reason, row.refId, row.ts],
    );
  }

  async sumCashLedger(accountId: string): Promise<number> {
    const res = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(delta_usd), 0)::text AS total
       FROM paper_cash_ledger WHERE account_id = $1`,
      [accountId],
    );
    return Number(res.rows[0]?.total ?? '0');
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface OrderRowDb {
  id: string;
  client_order_id: string;
  account_id: string;
  mode: 'paper' | 'live';
  kind: 'market';
  status: 'accepted' | 'filled' | 'rejected' | 'cancelled';
  legs: unknown;
  submitted_at: Date;
  filled_at: Date | null;
  rejection_reason: string | null;
  total_debit_usd: string | null;
}

interface FillRowDb {
  id: string;
  order_id: string;
  leg_index: number;
  venue: string;
  side: 'buy' | 'sell';
  option_right: 'call' | 'put';
  underlying: string;
  expiry: Date | string;
  strike: string;
  quantity: string;
  price_usd: string;
  fees_usd: string;
  source: 'paper' | 'live';
  filled_at: Date;
}

interface PositionRowDb {
  account_id: string;
  underlying: string;
  expiry: Date | string;
  strike: string;
  option_right: 'call' | 'put';
  net_quantity: string;
  avg_entry_price_usd: string;
  realized_pnl_usd: string;
  opened_at: Date;
  last_fill_at: Date;
}

function mapOrderRow(row: OrderRowDb): PaperOrderRow {
  return {
    id: row.id,
    clientOrderId: row.client_order_id,
    accountId: row.account_id,
    mode: row.mode,
    kind: row.kind,
    status: row.status,
    legs: row.legs,
    submittedAt: row.submitted_at,
    filledAt: row.filled_at,
    rejectionReason: row.rejection_reason,
    totalDebitUsd: row.total_debit_usd != null ? Number(row.total_debit_usd) : null,
  };
}

function mapFillRow(row: FillRowDb): PaperFillRow {
  return {
    id: row.id,
    orderId: row.order_id,
    legIndex: row.leg_index,
    venue: row.venue,
    side: row.side,
    optionRight: row.option_right,
    underlying: row.underlying,
    expiry: typeof row.expiry === 'string' ? row.expiry : toIsoDate(row.expiry),
    strike: Number(row.strike),
    quantity: Number(row.quantity),
    priceUsd: Number(row.price_usd),
    feesUsd: Number(row.fees_usd),
    source: row.source,
    filledAt: row.filled_at,
  };
}

function mapPositionRow(row: PositionRowDb): PaperPositionRow {
  return {
    accountId: row.account_id,
    underlying: row.underlying,
    expiry: typeof row.expiry === 'string' ? row.expiry : toIsoDate(row.expiry),
    strike: Number(row.strike),
    optionRight: row.option_right,
    netQuantity: Number(row.net_quantity),
    avgEntryPriceUsd: Number(row.avg_entry_price_usd),
    realizedPnlUsd: Number(row.realized_pnl_usd),
    openedAt: row.opened_at,
    lastFillAt: row.last_fill_at,
  };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
