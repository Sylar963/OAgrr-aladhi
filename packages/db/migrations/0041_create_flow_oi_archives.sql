CREATE TABLE IF NOT EXISTS flow_oi_archives (
  id TEXT PRIMARY KEY,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  tick_count INTEGER NOT NULL CHECK (tick_count > 0),
  payload BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS flow_oi_archives_time_idx ON flow_oi_archives (start_ts, end_ts);
