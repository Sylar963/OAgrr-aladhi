# @oggregator/ingest

Optional worker that records live and institutional trades into Postgres.

## What this does

- starts `SpotRuntime`, `TradeRuntime`, and `BlockTradeRuntime`
- subscribes to live trade events from reusable core runtimes
- normalizes trade money fields through shared core helpers
- batches trades into a local spool, then flushes to the configured `TradeStore`

If `DATABASE_URL` is missing, the worker runs with `NoopTradeStore` and logs a warning instead of persisting.

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
| `DATABASE_URL` | Optional Postgres connection string |
| `NODE_ENV` | Use `production` outside local development |
| `TRADE_DB_FLUSH_INTERVAL_MS` | Milliseconds between Postgres flushes; default `86400000`, set `0` for direct writes |
| `TRADE_CACHE_PATH` | Local NDJSON trade spool path; default `.cache/ingest-trades.ndjson` |
| `TRADE_CACHE_MAX_ROWS` | Maximum rows retained in the local spool before trimming oldest rows; default `5000000` |
| `TRADE_DB_FLUSH_BATCH_SIZE` | Rows passed to the underlying DB store per flush batch; default `10000` |
| `TRADE_DB_FLUSH_ON_DISPOSE` | Set `true` or `1` to flush the local spool during graceful shutdown |
