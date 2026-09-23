CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'revoked')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  granted_by TEXT,
  PRIMARY KEY (user_id, feature_key)
);

CREATE TABLE IF NOT EXISTS feature_invites (
  id TEXT PRIMARY KEY,
  feature_key TEXT NOT NULL,
  code_digest TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions > 0),
  redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  expires_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_invite_redemptions (
  invite_id TEXT NOT NULL REFERENCES feature_invites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id, user_id)
);
