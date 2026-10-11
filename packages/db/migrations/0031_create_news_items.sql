-- GOOD-classified headlines from the op-feed news poller. The upstream feed only exposes its
-- latest ~200 tweets, so this is the long-term record behind the News panel. Written in daily
-- deferred batches; rows past the archive retention are pruned on the same cycle.
CREATE TABLE IF NOT EXISTS news_items (
  id TEXT PRIMARY KEY,
  published_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL,
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  handle TEXT,
  rule_tag TEXT
);

CREATE INDEX IF NOT EXISTS news_items_published_at_id_idx ON news_items (published_at DESC, id DESC);
