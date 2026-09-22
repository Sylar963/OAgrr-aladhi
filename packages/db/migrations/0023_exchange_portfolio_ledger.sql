CREATE TABLE IF NOT EXISTS exchange_portfolio_positions (
  account_id TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('thalex', 'derive')),
  leg_id TEXT NOT NULL,
  underlying TEXT NOT NULL,
  expiry DATE NOT NULL,
  strike DOUBLE PRECISION NOT NULL,
  option_right TEXT NOT NULL CHECK (option_right IN ('call', 'put')),
  size DOUBLE PRECISION NOT NULL,
  entry_price_usd DOUBLE PRECISION NOT NULL,
  entry_iv DOUBLE PRECISION,
  realized_pnl_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  entry_ts BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, venue, leg_id)
);

CREATE INDEX IF NOT EXISTS exchange_portfolio_positions_account_venue_idx
  ON exchange_portfolio_positions (account_id, venue, expiry);

CREATE TABLE IF NOT EXISTS exchange_portfolio_trades (
  account_id TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('thalex', 'derive')),
  trade_id TEXT NOT NULL,
  order_id TEXT,
  group_id TEXT,
  instrument_name TEXT NOT NULL,
  underlying TEXT NOT NULL,
  expiry DATE NOT NULL,
  strike DOUBLE PRECISION NOT NULL,
  option_right TEXT NOT NULL CHECK (option_right IN ('call', 'put')),
  direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  amount DOUBLE PRECISION NOT NULL,
  price_usd DOUBLE PRECISION NOT NULL,
  fee_usd DOUBLE PRECISION,
  realized_pnl_usd DOUBLE PRECISION,
  liquidity_role TEXT CHECK (liquidity_role IN ('maker', 'taker')),
  traded_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, venue, trade_id)
);

CREATE INDEX IF NOT EXISTS exchange_portfolio_trades_account_venue_time_idx
  ON exchange_portfolio_trades (account_id, venue, traded_at DESC);

CREATE INDEX IF NOT EXISTS exchange_portfolio_trades_group_idx
  ON exchange_portfolio_trades (account_id, venue, group_id)
  WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS exchange_portfolio_sync (
  account_id TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('thalex', 'derive')),
  positions_observed_at TIMESTAMPTZ,
  trades_synced_at TIMESTAMPTZ,
  history_from TIMESTAMPTZ,
  PRIMARY KEY (account_id, venue)
);
