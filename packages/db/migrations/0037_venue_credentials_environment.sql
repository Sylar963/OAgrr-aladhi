-- One credential slot per venue environment (Thalex mainnet vs testnet). Exactly one slot per
-- (account, venue) is active: the one the portfolio connects to. Existing rows are mainnet.
ALTER TABLE venue_credentials
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'prod',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE venue_credentials
  ADD CONSTRAINT venue_credentials_environment_check CHECK (environment IN ('prod', 'test'));

ALTER TABLE venue_credentials DROP CONSTRAINT venue_credentials_pkey;
ALTER TABLE venue_credentials ADD PRIMARY KEY (account_id, venue, environment);

CREATE UNIQUE INDEX IF NOT EXISTS venue_credentials_one_active
  ON venue_credentials (account_id, venue)
  WHERE active;
