CREATE TABLE IF NOT EXISTS portfolio_assistant_threads (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES paper_accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  underlying TEXT,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_assistant_threads_user_updated_idx
  ON portfolio_assistant_threads (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_assistant_messages (
  id UUID PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES portfolio_assistant_threads(id) ON DELETE CASCADE,
  client_message_id UUID,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'cancelled', 'failed')),
  portfolio_generated_at TIMESTAMPTZ,
  context_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_assistant_messages_thread_client_idx
  ON portfolio_assistant_messages (thread_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS portfolio_assistant_messages_thread_created_idx
  ON portfolio_assistant_messages (thread_id, created_at, id);

CREATE TABLE IF NOT EXISTS portfolio_assistant_usage (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES portfolio_assistant_threads(id) ON DELETE CASCADE,
  assistant_message_id UUID NOT NULL REFERENCES portfolio_assistant_messages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('complete', 'cancelled', 'failed', 'allowance_exhausted')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS portfolio_assistant_usage_user_started_idx
  ON portfolio_assistant_usage (user_id, started_at DESC);
