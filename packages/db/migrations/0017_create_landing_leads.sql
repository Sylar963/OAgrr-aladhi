CREATE TABLE IF NOT EXISTS landing_leads (
  id          TEXT PRIMARY KEY,            -- lead_<uuid>
  email       TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expression-unique index is the ON CONFLICT (lower(email)) target for the
-- captureLead upsert — a repeat request updates the source, not a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS landing_leads_email_idx ON landing_leads (lower(email));
CREATE INDEX IF NOT EXISTS landing_leads_created_at_idx ON landing_leads (created_at);
