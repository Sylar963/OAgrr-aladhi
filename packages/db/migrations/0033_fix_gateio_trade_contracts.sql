-- Gate.io trade sizes are contract counts (BTC/ETH contracts are 0.01 of the underlying), but
-- ingest stored them as underlying units, overstating contracts, premium and notional.
-- Rows still holding contracts = raw size are the uncorrected ones; corrected rows differ
-- whenever the multiplier is not 1, so re-running this cannot scale a row twice.
UPDATE flow_trades AS f
SET
  contracts = f.contracts * m.multiplier,
  premium_usd = f.premium_usd * m.multiplier,
  notional_usd = f.notional_usd * m.multiplier
FROM (
  VALUES
    ('BTC', 0.01::numeric),
    ('ETH', 0.01),
    ('DOGE', 1000),
    ('ADA', 100),
    ('XRP', 10),
    ('BNB', 0.1),
    ('SUI', 10),
    ('XAUT', 0.01)
) AS m(underlying, multiplier)
WHERE f.venue = 'gateio'
  AND f.mode = 'live'
  AND f.underlying = m.underlying
  AND f.raw ? 'size'
  AND f.contracts = (f.raw->>'size')::numeric;
