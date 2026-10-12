-- Joining the leaderboard publishes open positions, closed trades and equity history; record when.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS leaderboard_consented_at TIMESTAMPTZ;
