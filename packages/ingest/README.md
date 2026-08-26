# @oggregator/ingest

Optional worker that records live and institutional trades into Postgres.

## What this does

- starts `SpotRuntime`, `TradeRuntime`, and `BlockTradeRuntime`
- subscribes to live trade events from reusable core runtimes
- normalizes trade money fields through shared core helpers
- stages trades in local SQLite, then flushes bounded batches to the configured `TradeStore`

The worker exits if `DATABASE_URL` is missing rather than accepting trades without persistence.

## Commands

```bash
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc
pnpm typecheck    # build core + db, then tsc --noEmit
pnpm start        # node dist/index.js
```

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Required Postgres connection string |
| `NODE_ENV` | Use `production` outside local development |
| `TRADE_DB_FLUSH_INTERVAL_MS` | Milliseconds between Postgres flushes; default `604800000` (7 days), set `0` for immediate synchronization after the durable local write |
| `TRADE_SQLITE_PATH` | Shared SQLite staging database; default `.cache/ingest-trades.sqlite` |
| `TRADE_CACHE_PATH` | Legacy NDJSON spool imported once at startup; default `.cache/ingest-trades.ndjson` |
| `TRADE_CACHE_MAX_ROWS` | Pending-row warning threshold for SQLite; all rows are retained; default `5000000` |
| `TRADE_DB_FLUSH_BATCH_SIZE` | Rows passed to the underlying DB store per flush batch; default `10000` |
| `TRADE_DB_FLUSH_ON_DISPOSE` | Set `true` or `1` to flush the local spool during graceful shutdown |
| `TRADE_RETENTION_DAYS` | Postgres history retention in days; default `0` disables automatic pruning |

`TRADE_SQLITE_PATH` must resolve to the same absolute path for ingest and server on a persistent shared volume. Keep the SQLite `-wal` and `-shm` sidecars on that volume too. Ingest owns writes and synchronization; the server opens the database read-only for merged history queries.

Pending rows are deleted only after their Postgres batch succeeds. Failed uploads remain local and retain their retry deadline across restarts. On first startup, the worker imports both `TRADE_CACHE_PATH` and its `.flushing` recovery file, then renames each source with a `.migrated` suffix.
