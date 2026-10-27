ALTER TABLE portfolio_assistant_messages ADD COLUMN IF NOT EXISTS evidence JSONB;
ALTER TABLE portfolio_assistant_usage ADD COLUMN IF NOT EXISTS first_token_ms INTEGER CHECK (first_token_ms >= 0);
ALTER TABLE portfolio_assistant_usage ADD COLUMN IF NOT EXISTS estimated_cost_usd DOUBLE PRECISION CHECK (estimated_cost_usd >= 0);
