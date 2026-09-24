-- flow_contracts: unsigned contracts (≤ last_oi) whose dealer sign came from
-- observed taker flow rather than the naive long-calls/short-puts prior.
-- Existing rows start at 0 (fully naive) and gain attribution on later ticks.
ALTER TABLE dealer_book
  ADD COLUMN IF NOT EXISTS flow_contracts DOUBLE PRECISION NOT NULL DEFAULT 0;
