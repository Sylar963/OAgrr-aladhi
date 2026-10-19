-- Trading theses and their append-only event log (thesis flip gate). Written in daily
-- deferred batches from the server's local outbox; the server keeps the live state in memory.
CREATE TABLE IF NOT EXISTS theses (
  id UUID PRIMARY KEY,
  account_id TEXT NOT NULL,
  underlying TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  record JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS theses_account_created_idx ON theses (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS thesis_events (
  id UUID PRIMARY KEY,
  thesis_id UUID NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS thesis_events_thesis_idx ON thesis_events (thesis_id, created_at);
CREATE INDEX IF NOT EXISTS thesis_events_account_created_idx ON thesis_events (account_id, created_at DESC);
