ALTER TABLE paper_fills
  ADD COLUMN IF NOT EXISTS quantity_unit TEXT NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS contract_multiplier_base NUMERIC(28, 12),
  ADD COLUMN IF NOT EXISTS native_quantity NUMERIC(28, 12),
  ADD COLUMN IF NOT EXISTS requested_native_quantity NUMERIC(28, 12),
  ADD COLUMN IF NOT EXISTS native_min_quantity NUMERIC(28, 12),
  ADD COLUMN IF NOT EXISTS native_quantity_step NUMERIC(28, 12),
  ADD COLUMN IF NOT EXISTS native_price_tick NUMERIC(28, 12);

ALTER TABLE paper_fills
  DROP CONSTRAINT IF EXISTS paper_fills_quantity_unit_check;

ALTER TABLE paper_fills
  ADD CONSTRAINT paper_fills_quantity_unit_check CHECK (quantity_unit = 'base');
