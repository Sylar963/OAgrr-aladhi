CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,            -- usr_<uuid>
  clerk_user_id      TEXT NOT NULL UNIQUE,
  email              TEXT,
  display_name       TEXT,
  country            TEXT,
  default_account_id TEXT REFERENCES paper_accounts (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users (clerk_user_id);
