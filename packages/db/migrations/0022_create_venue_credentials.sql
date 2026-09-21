CREATE TABLE IF NOT EXISTS venue_credentials (
  account_id            TEXT NOT NULL REFERENCES paper_accounts (id) ON DELETE CASCADE,
  venue                 TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, venue)
);
