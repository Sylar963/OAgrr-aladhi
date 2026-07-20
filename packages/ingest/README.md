# @oggregator/ingest

Optional worker that records live and institutional trades into Postgres.

## What this does

- starts `SpotRuntime`, `TradeRuntime`, and `BlockTradeRuntime`
- subscribes to live trade events from reusable core runtimes
- normalizes trade money fields through shared core helpers
- batches trades into a local spool, then flushes to the configured `TradeStore`

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
| `TRADE_DB_FLUSH_INTERVAL_MS` | Milliseconds between Postgres flushes; default `604800000` (7 days), set `0` for direct writes |
| `TRADE_CACHE_PATH` | Local NDJSON trade spool path; default `.cache/ingest-trades.ndjson` |
| `TRADE_CACHE_MAX_ROWS` | Pending-row warning threshold for the local spool; all rows are retained; default `5000000` |
| `TRADE_DB_FLUSH_BATCH_SIZE` | Rows passed to the underlying DB store per flush batch; default `10000` |
| `TRADE_DB_FLUSH_ON_DISPOSE` | Set `true` or `1` to flush the local spool during graceful shutdown |
| `TRADE_RETENTION_DAYS` | Postgres history retention in days; default `0` disables automatic pruning |

`TRADE_CACHE_PATH` must be on persistent storage. Replacing a container or filesystem that holds the spool discards trades that have not reached Postgres yet.
The worker removes a flushing spool only after every Postgres batch succeeds. Failed uploads remain local and retry after the configured flush interval.
