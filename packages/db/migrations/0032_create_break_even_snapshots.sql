-- Hourly Deribit mark-IV smiles per expiry. The break-even forecast rebuilds each strike's
-- break-even path from (forward, strike, IV, time to expiry) with Black-76, so one row per
-- expiry and hour is enough. Written in daily deferred batches; rows are pruned once their
-- expiry has passed.
CREATE TABLE IF NOT EXISTS break_even_snapshots (
  underlying TEXT NOT NULL,
  expiry TEXT NOT NULL,
  slot_ts TIMESTAMPTZ NOT NULL,
  expiry_ts TIMESTAMPTZ NOT NULL,
  spot DOUBLE PRECISION NOT NULL,
  forward DOUBLE PRECISION NOT NULL,
  strikes DOUBLE PRECISION[] NOT NULL,
  mark_ivs DOUBLE PRECISION[] NOT NULL,
  PRIMARY KEY (underlying, expiry, slot_ts)
);

CREATE INDEX IF NOT EXISTS break_even_snapshots_expiry_ts_idx
  ON break_even_snapshots (expiry_ts);
