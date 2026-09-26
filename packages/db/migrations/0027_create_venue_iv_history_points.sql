-- Hourly constant-maturity IV per venue, built from each venue's own quotes. Complements the
-- cross-venue iv_history_points so premium baselines can be measured per venue.
CREATE TABLE IF NOT EXISTS venue_iv_history_points (
  venue TEXT NOT NULL,
  underlying TEXT NOT NULL,
  tenor_days SMALLINT NOT NULL CHECK (tenor_days IN (7, 30, 60, 90)),
  slot_ts TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  atm_iv DOUBLE PRECISION NOT NULL,
  rr25d DOUBLE PRECISION,
  bfly25d DOUBLE PRECISION,
  PRIMARY KEY (underlying, venue, tenor_days, slot_ts)
);
