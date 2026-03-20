# @oggregator/server

Fastify REST + WS aggregation server. Bootstraps venue adapters from `@oggregator/core`.

## Commands

```bash
pnpm dev            # tsx watch on :3100 (hot reload)
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm typecheck      # tsc --noEmit
```

## Structure

```
src/
  index.ts           Entry point (PORT from env, default 3100)
  app.ts             Fastify factory, plugin registration, adapter bootstrap
  adapters.ts        Instantiates + registers all venue adapters
  routes/
    health.ts        GET /api/health
    venues.ts        GET /api/venues
    underlyings.ts   GET /api/underlyings
    expiries.ts      GET /api/expiries?underlying=BTC
    chains.ts        GET /api/chains?underlying=BTC&expiry=2026-03-28
```

## Non-obvious decisions

- **Adapters bootstrap async after server starts** — routes return 503 via `isReady()` check until adapters finish loading. This lets the server accept connections immediately while feeds connect in the background.

- **Server imports only from `@oggregator/core` package root** — never from its internal feeds/core/types paths. If something is needed, it must be exported from core's `index.ts`.

- **New venues need zero route changes** — add the adapter to `adapters.ts`, it auto-registers via `registerAdapter()`, and all routes pick it up through `getAllAdapters()`.

## Adding a route

1. Create `routes/{name}.ts` with handler function
2. Register in `routes/index.ts`
3. Check `isReady()` at the top of the handler
