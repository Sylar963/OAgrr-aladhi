-- Real-GEX dealer inventory book.
--
-- oi_snapshots: durable audit log of per-venue per-contract open interest at
--   ~15-min intervals. The running book uses dealer_book.last_oi for ΔOI, so
--   this table is the history/re-derivation trail, not the hot read path.
-- dealer_book: current running dealer position per venue·contract. Upserted
--   each tick. dealer_contracts sign: + = dealer long the option (long gamma).

CREATE TABLE IF NOT EXISTS oi_snapshots (
  venue TEXT NOT NULL,
  underlying TEXT NOT NULL,
  instrument_name TEXT NOT NULL,
  expiry DATE,
  strike DOUBLE PRECISION NOT NULL,
  option_type TEXT NOT NULL CHECK (option_type IN ('call', 'put')),
  open_interest DOUBLE PRECISION NOT NULL,
  snapshot_ts TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instrument_name, snapshot_ts)
);

CREATE INDEX IF NOT EXISTS oi_snapshots_lookup_idx
  ON oi_snapshots (venue, instrument_name, snapshot_ts DESC);

CREATE INDEX IF NOT EXISTS oi_snapshots_prune_idx
  ON oi_snapshots (snapshot_ts);

CREATE TABLE IF NOT EXISTS dealer_book (
  venue TEXT NOT NULL,
  underlying TEXT NOT NULL,
  instrument_name TEXT NOT NULL,
  expiry DATE,
  strike DOUBLE PRECISION NOT NULL,
  option_type TEXT NOT NULL CHECK (option_type IN ('call', 'put')),
  dealer_contracts DOUBLE PRECISION NOT NULL,
  last_oi DOUBLE PRECISION NOT NULL,
  last_snapshot_ts TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue, instrument_name)
);

CREATE INDEX IF NOT EXISTS dealer_book_underlying_idx
  ON dealer_book (underlying);
