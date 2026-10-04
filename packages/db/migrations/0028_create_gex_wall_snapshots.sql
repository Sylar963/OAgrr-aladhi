-- 15-minute samples of all-expiry, all-venue GEX levels so the GEX bands chart can plot
-- moving walls. Written in daily deferred batches; rows older than 90 days are pruned.
CREATE TABLE IF NOT EXISTS gex_wall_snapshots (
  underlying TEXT NOT NULL,
  slot_ts TIMESTAMPTZ NOT NULL,
  spot DOUBLE PRECISION,
  call_wall DOUBLE PRECISION,
  put_wall DOUBLE PRECISION,
  gamma_flip DOUBLE PRECISION,
  PRIMARY KEY (underlying, slot_ts)
);
