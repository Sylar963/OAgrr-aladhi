# @oggregator/db

Postgres persistence and SQLite staging for flow trades.

## What this does

- defines the `TradeStore` interface used at the wiring boundary
- provides `NoopTradeStore` for local / no-DB runs
- provides `PostgresTradeStore` for durable writes and recent reads
- provides WAL-backed `SqliteTradeStore` staging and merged local/Postgres history reads
- runs SQL migrations from `migrations/`

## Commands

```bash
pnpm build        # tsc
pnpm typecheck    # tsc --noEmit
pnpm migrate      # node dist/migrate.js (requires DATABASE_URL)
```

## Notes

- `DATABASE_URL` is optional at the app boundary. If it is missing, callers should swap in `NoopTradeStore`
- migrations use `pg_advisory_lock(...)` so concurrent runs do not step on each other
- `flow_trades` is append-only from the app's perspective. `(trade_uid, trade_ts)` handles dedupe on insert
