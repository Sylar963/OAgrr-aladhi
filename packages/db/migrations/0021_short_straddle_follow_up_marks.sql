ALTER TABLE short_straddle_snapshots
  ADD COLUMN cohort_slot_ts TIMESTAMPTZ,
  ADD COLUMN horizon_hours SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN call_ask_maker_fee_usd DOUBLE PRECISION,
  ADD COLUMN call_ask_taker_fee_usd DOUBLE PRECISION,
  ADD COLUMN put_ask_maker_fee_usd DOUBLE PRECISION,
  ADD COLUMN put_ask_taker_fee_usd DOUBLE PRECISION;

UPDATE short_straddle_snapshots
SET
  cohort_slot_ts = sample_slot_ts,
  call_ask_maker_fee_usd = call_maker_fee_usd,
  call_ask_taker_fee_usd = call_taker_fee_usd,
  put_ask_maker_fee_usd = put_maker_fee_usd,
  put_ask_taker_fee_usd = put_taker_fee_usd;

ALTER TABLE short_straddle_snapshots
  ALTER COLUMN cohort_slot_ts SET NOT NULL,
  ALTER COLUMN call_ask_maker_fee_usd SET NOT NULL,
  ALTER COLUMN call_ask_taker_fee_usd SET NOT NULL,
  ALTER COLUMN put_ask_maker_fee_usd SET NOT NULL,
  ALTER COLUMN put_ask_taker_fee_usd SET NOT NULL,
  DROP CONSTRAINT short_straddle_snapshots_pkey,
  ADD CONSTRAINT short_straddle_snapshots_horizon_check
    CHECK (horizon_hours IN (0, 1, 6, 24, 72)),
  ADD PRIMARY KEY (venue, underlying, cohort_slot_ts, horizon_hours);

CREATE INDEX short_straddle_snapshots_underlying_cohort_idx
  ON short_straddle_snapshots (underlying, cohort_slot_ts DESC);
