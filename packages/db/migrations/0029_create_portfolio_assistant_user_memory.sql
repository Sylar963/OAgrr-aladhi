-- Per-user Ask Hermes memory: durable preferences distilled once a day from the user's own
-- chats. Rewritten at most once per user per daily run, plus user-initiated deletes.
-- A "forget all" leaves an empty row whose last_distilled_at stops older chats being re-learned.
CREATE TABLE IF NOT EXISTS portfolio_assistant_user_memory (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 1500),
  items JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 12),
  last_distilled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
