ALTER TABLE paper_fills
  DROP COLUMN IF EXISTS native_price_tick,
  DROP COLUMN IF EXISTS native_quantity_step,
  DROP COLUMN IF EXISTS native_min_quantity,
  DROP COLUMN IF EXISTS requested_native_quantity,
  DROP COLUMN IF EXISTS native_quantity,
  DROP COLUMN IF EXISTS contract_multiplier_base,
  DROP COLUMN IF EXISTS quantity_unit;
