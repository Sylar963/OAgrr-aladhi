CREATE TABLE IF NOT EXISTS funded_challenge_templates (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  route_type             TEXT NOT NULL CHECK (route_type IN ('test', 'instant')),
  test_deposit_min_usd   NUMERIC(28, 8),
  test_profit_target_pct NUMERIC(8, 4),
  test_max_drawdown_pct  NUMERIC(8, 4),
  funded_abc             NUMERIC(28, 8) NOT NULL,
  abc_floor_pct          NUMERIC(8, 4) NOT NULL,
  profit_split_pct       NUMERIC(8, 4) NOT NULL,
  settlement_cadence     TEXT NOT NULL CHECK (settlement_cadence IN ('daily', 'weekly')),
  max_runs_per_user      INTEGER NOT NULL DEFAULT 3,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funded_runs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id),
  template_id      TEXT NOT NULL REFERENCES funded_challenge_templates (id),
  paper_account_id TEXT NOT NULL REFERENCES paper_accounts (id),
  route_type       TEXT NOT NULL CHECK (route_type IN ('test', 'instant')),
  status           TEXT NOT NULL CHECK (status IN
                     ('test_active','test_passed','test_failed','funded_active','breached','withdrawn')),
  deposit_usd      NUMERIC(28, 8),
  abc_credited     NUMERIC(28, 8) NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  test_passed_at   TIMESTAMPTZ,
  funded_at        TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  end_reason       TEXT
);

CREATE INDEX IF NOT EXISTS funded_runs_user_idx ON funded_runs (user_id);
CREATE INDEX IF NOT EXISTS funded_runs_status_idx ON funded_runs (status);

CREATE TABLE IF NOT EXISTS funded_settlements (
  run_id                TEXT NOT NULL REFERENCES funded_runs (id),
  settled_at            TIMESTAMPTZ NOT NULL,
  equity_usd            NUMERIC(28, 8) NOT NULL,
  abc_credited          NUMERIC(28, 8) NOT NULL,
  cumulative_profit_usd NUMERIC(28, 8) NOT NULL,
  trader_share_usd      NUMERIC(28, 8) NOT NULL,
  drawdown_pct          NUMERIC(8, 4) NOT NULL,
  floor_breached        BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, settled_at)
);

CREATE TABLE IF NOT EXISTS funded_run_events (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id    TEXT NOT NULL REFERENCES funded_runs (id),
  kind      TEXT NOT NULL,
  summary   TEXT NOT NULL,
  payload   JSONB,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funded_run_events_run_idx ON funded_run_events (run_id, ts DESC);
