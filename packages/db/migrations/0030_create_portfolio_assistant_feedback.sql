-- Ask Hermes answer feedback: one vote per user per assistant message. Votes are buffered on
-- the backend's disk and written here in one batch per daily flush, so Neon sees no per-click
-- writes. Rows follow the conversation: deleting the user, the thread ("New chat") or the
-- message (retention) deletes the vote.
CREATE TABLE IF NOT EXISTS portfolio_assistant_feedback (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES portfolio_assistant_messages(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES portfolio_assistant_threads(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  reasons TEXT[] NOT NULL DEFAULT '{}'
    CHECK (reasons <@ ARRAY['wrong_numbers', 'did_not_answer', 'too_long', 'refused', 'other']::text[]),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  run_telemetry JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, message_id),
  CHECK (vote = 'down' OR (cardinality(reasons) = 0 AND note IS NULL))
);

CREATE INDEX IF NOT EXISTS portfolio_assistant_feedback_thread_idx
  ON portfolio_assistant_feedback (thread_id);

CREATE INDEX IF NOT EXISTS portfolio_assistant_feedback_message_idx
  ON portfolio_assistant_feedback (message_id);

CREATE INDEX IF NOT EXISTS portfolio_assistant_feedback_updated_idx
  ON portfolio_assistant_feedback (updated_at DESC);
