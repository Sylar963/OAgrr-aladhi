-- First time a user joined the leaderboard. Unlike leaderboard_consented_at it survives leaving and
-- rejoining, so it can be shown as "sharing since".
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS leaderboard_since TIMESTAMPTZ;
UPDATE user_profiles
  SET leaderboard_since = leaderboard_consented_at
  WHERE leaderboard_since IS NULL AND leaderboard_consented_at IS NOT NULL;
