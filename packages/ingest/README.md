# @oggregator/ingest

Optional worker that records live and institutional trades into Postgres.

## What this does

- starts `SpotService`, `FlowService`, and `BlockFlowService`
- subscribes to live trade events from core services
- normalizes trade money fields through shared core helpers
- batches writes into the configured `TradeStore`

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
