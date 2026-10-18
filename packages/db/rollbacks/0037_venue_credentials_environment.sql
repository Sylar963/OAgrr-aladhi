-- Testnet slots have no place in the single-slot table, so they are dropped.
DELETE FROM venue_credentials WHERE environment <> 'prod';
DROP INDEX IF EXISTS venue_credentials_one_active;
ALTER TABLE venue_credentials DROP CONSTRAINT venue_credentials_pkey;
ALTER TABLE venue_credentials ADD PRIMARY KEY (account_id, venue);
ALTER TABLE venue_credentials DROP CONSTRAINT IF EXISTS venue_credentials_environment_check;
ALTER TABLE venue_credentials
  DROP COLUMN IF EXISTS active,
  DROP COLUMN IF EXISTS environment;
