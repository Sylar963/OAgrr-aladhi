-- The leaderboard ranks the connected venue account a user chose to broadcast, not paper accounts.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS broadcast_venue TEXT
  CHECK (broadcast_venue IN ('derive', 'thalex', 'paradex'));
