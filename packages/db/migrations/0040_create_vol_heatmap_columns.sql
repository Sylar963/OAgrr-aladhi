CREATE TABLE IF NOT EXISTS vol_heatmap_columns (
  currency TEXT NOT NULL CHECK (currency IN ('BTC', 'ETH')),
  slot_ts TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY (currency, slot_ts)
);

CREATE INDEX IF NOT EXISTS vol_heatmap_columns_slot_ts_idx ON vol_heatmap_columns (slot_ts);
