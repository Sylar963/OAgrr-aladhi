CREATE TABLE IF NOT EXISTS user_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  handle              TEXT,
  leaderboard_visible BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_handle_lower_idx
  ON user_profiles (lower(handle))
  WHERE handle IS NOT NULL;

-- One row per account per UTC day, written in a single batch by the daily snapshot job.
CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
  account_id  TEXT NOT NULL REFERENCES paper_accounts (id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  equity_usd  NUMERIC(28, 8) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, day)
);

CREATE INDEX IF NOT EXISTS paper_equity_snapshots_day_idx ON paper_equity_snapshots (day);

-- user_id is never exposed to chat clients; anonymous posts are only pseudonymous to other users.
CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  room       TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  is_anon    BOOLEAN NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chat_messages_room_created_idx
  ON chat_messages (room, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_user_idx ON chat_messages (user_id);

CREATE TABLE IF NOT EXISTS chat_moderation (
  user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  muted_until TIMESTAMPTZ,
  banned      BOOLEAN NOT NULL DEFAULT false,
  reason      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
