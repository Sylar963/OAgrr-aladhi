import { Pool } from 'pg';

export type ExchangePortfolioVenue = 'derive' | 'thalex';

export interface PersistedExchangePosition {
  legId: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  size: number;
  entryPriceUsd: number;
  entryIv: number | null;
  realizedPnlUsd: number;
  entryTs: number;
}

export interface PersistedExchangeTrade {
  tradeId: string;
  orderId: string | null;
  groupId: string | null;
  instrumentName: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  direction: 'buy' | 'sell';
  amount: number;
  priceUsd: number;
  feeUsd: number | null;
  realizedPnlUsd: number | null;
  liquidityRole: 'maker' | 'taker' | null;
  timestampMs: number;
}

export interface ExchangeTradeSummary {
  tradeCount: number;
  knownFeesUsd: number;
  realizedPnlUsd: number;
  historyFromMs: number | null;
  lastSyncedAtMs: number | null;
}

export interface ExchangePortfolioLedgerStore {
  readonly enabled: boolean;
  loadPositions(
    accountId: string,
    venue: ExchangePortfolioVenue,
  ): Promise<PersistedExchangePosition[]>;
  replacePositions(
    accountId: string,
    venue: ExchangePortfolioVenue,
    positions: PersistedExchangePosition[],
    observedAt: Date,
  ): Promise<void>;
  upsertTrades(
    accountId: string,
    venue: ExchangePortfolioVenue,
    trades: PersistedExchangeTrade[],
    syncedAt: Date,
  ): Promise<void>;
  loadTrades(
    accountId: string,
    venue: ExchangePortfolioVenue,
    limit: number,
  ): Promise<PersistedExchangeTrade[]>;
  loadTradeSummary(
    accountId: string,
    venue: ExchangePortfolioVenue,
    underlying?: string,
  ): Promise<ExchangeTradeSummary>;
  dispose(): Promise<void>;
}

export class NoopExchangePortfolioLedgerStore implements ExchangePortfolioLedgerStore {
  readonly enabled = false;
  async loadPositions(
    _accountId: string,
    _venue: ExchangePortfolioVenue,
  ): Promise<PersistedExchangePosition[]> {
    return [];
  }
  async replacePositions(
    _accountId: string,
    _venue: ExchangePortfolioVenue,
    _positions: PersistedExchangePosition[],
    _observedAt: Date,
  ): Promise<void> {}
  async upsertTrades(
    _accountId: string,
    _venue: ExchangePortfolioVenue,
    _trades: PersistedExchangeTrade[],
    _syncedAt: Date,
  ): Promise<void> {}
  async loadTrades(
    _accountId: string,
    _venue: ExchangePortfolioVenue,
    _limit: number,
  ): Promise<PersistedExchangeTrade[]> {
    return [];
  }
  async loadTradeSummary(
    _accountId: string,
    _venue: ExchangePortfolioVenue,
    _underlying?: string,
  ): Promise<ExchangeTradeSummary> {
    return {
      tradeCount: 0,
      knownFeesUsd: 0,
      realizedPnlUsd: 0,
      historyFromMs: null,
      lastSyncedAtMs: null,
    };
  }
  async dispose(): Promise<void> {}
}

interface PositionRow {
  leg_id: string;
  underlying: string;
  expiry: string;
  strike: number;
  option_right: 'call' | 'put';
  size: number;
  entry_price_usd: number;
  entry_iv: number | null;
  realized_pnl_usd: number;
  entry_ts: string | number;
}

interface TradeRow {
  trade_id: string;
  order_id: string | null;
  group_id: string | null;
  instrument_name: string;
  underlying: string;
  expiry: string;
  strike: number;
  option_right: 'call' | 'put';
  direction: 'buy' | 'sell';
  amount: number;
  price_usd: number;
  fee_usd: number | null;
  realized_pnl_usd: number | null;
  liquidity_role: 'maker' | 'taker' | null;
  traded_at: Date;
}

export class PostgresExchangePortfolioLedgerStore implements ExchangePortfolioLedgerStore {
  readonly enabled = true;
  private pool: Pool | null = null;

  constructor(private readonly poolFactory: () => Pool) {}

  static fromConnectionString(connectionString: string): PostgresExchangePortfolioLedgerStore {
    return new PostgresExchangePortfolioLedgerStore(
      () =>
        new Pool({
          connectionString,
          max: 2,
          connectionTimeoutMillis: 5_000,
          statement_timeout: 15_000,
          query_timeout: 15_000,
          idleTimeoutMillis: 10_000,
        }),
    );
  }

  async loadPositions(
    accountId: string,
    venue: ExchangePortfolioVenue,
  ): Promise<PersistedExchangePosition[]> {
    const result = await this.getPool().query<PositionRow>(
      `SELECT leg_id, underlying, expiry::text, strike, option_right, size,
              entry_price_usd, entry_iv, realized_pnl_usd, entry_ts
       FROM exchange_portfolio_positions
       WHERE account_id = $1 AND venue = $2
       ORDER BY expiry, strike, option_right`,
      [accountId, venue],
    );
    return result.rows.map((row) => ({
      legId: row.leg_id,
      underlying: row.underlying,
      expiry: row.expiry,
      strike: row.strike,
      optionRight: row.option_right,
      size: row.size,
      entryPriceUsd: row.entry_price_usd,
      entryIv: row.entry_iv,
      realizedPnlUsd: row.realized_pnl_usd,
      entryTs: Number(row.entry_ts),
    }));
  }

  async replacePositions(
    accountId: string,
    venue: ExchangePortfolioVenue,
    positions: PersistedExchangePosition[],
    observedAt: Date,
  ): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM exchange_portfolio_positions WHERE account_id = $1 AND venue = $2',
        [accountId, venue],
      );
      for (const position of positions) {
        await client.query(
          `INSERT INTO exchange_portfolio_positions (
             account_id, venue, leg_id, underlying, expiry, strike, option_right, size,
             entry_price_usd, entry_iv, realized_pnl_usd, entry_ts, observed_at
           ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            accountId,
            venue,
            position.legId,
            position.underlying,
            position.expiry,
            position.strike,
            position.optionRight,
            position.size,
            position.entryPriceUsd,
            position.entryIv,
            position.realizedPnlUsd,
            position.entryTs,
            observedAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO exchange_portfolio_sync (account_id, venue, positions_observed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, venue) DO UPDATE
         SET positions_observed_at = EXCLUDED.positions_observed_at`,
        [accountId, venue, observedAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertTrades(
    accountId: string,
    venue: ExchangePortfolioVenue,
    trades: PersistedExchangeTrade[],
    syncedAt: Date,
  ): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      for (const trade of trades) {
        await client.query(
          `INSERT INTO exchange_portfolio_trades (
             account_id, venue, trade_id, order_id, group_id, instrument_name, underlying,
             expiry, strike, option_right, direction, amount, price_usd, fee_usd,
             realized_pnl_usd, liquidity_role, traded_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14,
             $15, $16, $17
           )
           ON CONFLICT (account_id, venue, trade_id) DO UPDATE SET
             order_id = EXCLUDED.order_id,
             group_id = EXCLUDED.group_id,
             fee_usd = EXCLUDED.fee_usd,
             realized_pnl_usd = EXCLUDED.realized_pnl_usd,
             liquidity_role = EXCLUDED.liquidity_role`,
          [
            accountId,
            venue,
            trade.tradeId,
            trade.orderId,
            trade.groupId,
            trade.instrumentName,
            trade.underlying,
            trade.expiry,
            trade.strike,
            trade.optionRight,
            trade.direction,
            trade.amount,
            trade.priceUsd,
            trade.feeUsd,
            trade.realizedPnlUsd,
            trade.liquidityRole,
            new Date(trade.timestampMs),
          ],
        );
      }
      const historyFrom =
        trades.length === 0 ? null : new Date(Math.min(...trades.map((trade) => trade.timestampMs)));
      await client.query(
        `INSERT INTO exchange_portfolio_sync (
           account_id, venue, trades_synced_at, history_from
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, venue) DO UPDATE SET
           trades_synced_at = EXCLUDED.trades_synced_at,
           history_from = CASE
             WHEN exchange_portfolio_sync.history_from IS NULL THEN EXCLUDED.history_from
             WHEN EXCLUDED.history_from IS NULL THEN exchange_portfolio_sync.history_from
             ELSE LEAST(exchange_portfolio_sync.history_from, EXCLUDED.history_from)
           END`,
        [accountId, venue, syncedAt, historyFrom],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async loadTrades(
    accountId: string,
    venue: ExchangePortfolioVenue,
    limit: number,
  ): Promise<PersistedExchangeTrade[]> {
    const result = await this.getPool().query<TradeRow>(
      `SELECT trade_id, order_id, group_id, instrument_name, underlying, expiry::text,
              strike, option_right, direction, amount, price_usd, fee_usd,
              realized_pnl_usd, liquidity_role, traded_at
       FROM exchange_portfolio_trades
       WHERE account_id = $1 AND venue = $2
       ORDER BY traded_at DESC
       LIMIT $3`,
      [accountId, venue, Math.max(1, Math.min(limit, 5_000))],
    );
    return result.rows.map((row) => ({
      tradeId: row.trade_id,
      orderId: row.order_id,
      groupId: row.group_id,
      instrumentName: row.instrument_name,
      underlying: row.underlying,
      expiry: row.expiry,
      strike: row.strike,
      optionRight: row.option_right,
      direction: row.direction,
      amount: row.amount,
      priceUsd: row.price_usd,
      feeUsd: row.fee_usd,
      realizedPnlUsd: row.realized_pnl_usd,
      liquidityRole: row.liquidity_role,
      timestampMs: row.traded_at.getTime(),
    }));
  }

  async loadTradeSummary(
    accountId: string,
    venue: ExchangePortfolioVenue,
    underlying?: string,
  ): Promise<ExchangeTradeSummary> {
    const result = await this.getPool().query<{
      trade_count: string;
      known_fees_usd: number;
      realized_pnl_usd: number;
      history_from: Date | null;
      trades_synced_at: Date | null;
    }>(
      `SELECT
         COUNT(t.trade_id)::text AS trade_count,
         COALESCE(SUM(t.fee_usd), 0) AS known_fees_usd,
         COALESCE(SUM(t.realized_pnl_usd), 0) AS realized_pnl_usd,
         MIN(t.traded_at) AS history_from,
         MAX(s.trades_synced_at) AS trades_synced_at
       FROM exchange_portfolio_sync s
       LEFT JOIN exchange_portfolio_trades t
         ON t.account_id = s.account_id AND t.venue = s.venue
        AND ($3::text IS NULL OR t.underlying = $3)
       WHERE s.account_id = $1 AND s.venue = $2`,
      [accountId, venue, underlying ?? null],
    );
    const row = result.rows[0];
    return {
      tradeCount: Number(row?.trade_count ?? 0),
      knownFeesUsd: Number(row?.known_fees_usd ?? 0),
      realizedPnlUsd: Number(row?.realized_pnl_usd ?? 0),
      historyFromMs: row?.history_from?.getTime() ?? null,
      lastSyncedAtMs: row?.trades_synced_at?.getTime() ?? null,
    };
  }

  async dispose(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (pool != null) await pool.end();
  }

  private getPool(): Pool {
    this.pool ??= this.poolFactory();
    return this.pool;
  }
}
