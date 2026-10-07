# @oggregator/server

Fastify REST + WebSocket API. Bootstraps venue adapters from `@oggregator/core`, serves enriched chain data, paper trading, portfolio analytics, flow routes, readiness, and the production SPA.

## Commands

```bash
pnpm dev            # tsx watch on :3100 (hot reload)
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm typecheck      # prebuilds core, then tsc --noEmit
```

## Structure

```
src/
  index.ts           Entry point (PORT from env, default 3100)
  app.ts             Fastify factory, plugin registration, adapter bootstrap
  adapters.ts        Instantiates + registers all 5 venue adapters
  routes/
    health.ts        GET /api/health + GET /api/ready
    venues.ts        GET /api/venues
    underlyings.ts   GET /api/underlyings
    expiries.ts      GET /api/expiries?underlying=BTC
    chains.ts        GET /api/chains?underlying=BTC&expiry=2026-03-28&venues=deribit,okx
    surface.ts       GET /api/surface?underlying=BTC
    stats.ts         GET /api/stats?underlying=BTC
    dvol-history.ts  GET /api/dvol-history?currency=BTC
    iv-history.ts    GET /api/iv-history?underlying=BTC&window=90d
    vol-richness.ts  GET /api/vol-richness?underlying=BTC (IV vs forecast, cone, intraday z)
    spot-candles.ts  GET /api/spot-candles?underlying=BTC
    flow.ts          GET /api/flow?underlying=BTC
    block-flow.ts    GET /api/block-flow?underlying=BTC
    news.ts          GET /api/news
    regime.ts        GET /api/regime?underlying=BTC
    spots.ts         GET /api/spots
    paper/           REST paper trading endpoints
    portfolio/       REST portfolio positions, metrics, scenarios, credentials
    ws-chain.ts      WS /ws/chain
    portfolio/ws.ts  WS /ws/portfolio
    paper/ws.ts      WS /ws/paper
```

## Non-obvious decisions

- **Adapters bootstrap async after server starts** — routes return 503 via `isReady()` / `GET /api/ready` until adapters finish loading (~5-15s). Server accepts connections immediately while feeds connect in the background.

- **Server imports only from `@oggregator/core` package root** — never from internal feeds/core paths. If something is needed, it must be exported from core's `index.ts`.

- **Protocol contracts live in `@oggregator/protocol`** — server and web share Zod schemas for chain, paper, portfolio, and private-venue credential payloads. Route handlers should validate at the boundary and avoid hand-maintained duplicate DTOs.

- **New venues need zero route changes** — add the adapter in `adapters.ts`, call `registerAdapter()`, all routes pick it up via `getAllAdapters()`.

- **Auto-subscribes on first request** — `chains.ts` calls `ensureSubscribed()` per venue/underlying on first `/api/chains` request, opening WS connections lazily.

- **Chain browser transport is WS-first** — `ws-chain.ts` streams from a shared `ChainRuntime` that coalesces venue deltas and pushes enriched strike patches every 500ms (GEX at most every 2s). It does not forward raw exchange ticks one-by-one. Frame bodies are serialized once per runtime event and shared across sessions.

- **Portfolio transport is runtime-backed** — `/portfolio/*` routes and `WS /ws/portfolio` read from the shared in-memory position store plus live market marks. The REST side stays mutation-oriented; the WS side pushes recomputed metrics and changed leg IDs.

- **Hermes gets market data two ways** — `assistant-market/` compacts `/api/*` responses (via `app.inject`) into small labeled tables. The portfolio assistant context embeds them as `marketFacts`, and a loopback-only MCP server (`127.0.0.1:${OGG_ASSISTANT_MCP_PORT:-3191}/mcp`, bearer `OGG_ASSISTANT_MCP_TOKEN`) exposes them as read-only tools to the Hermes `portfolio-chat` profile. Per-user portfolio data is reachable only through `oggregator_evaluate_structure` and `oggregator_structure_search`, scoped by a server-minted, in-memory `portfolioRef` (15-minute sliding TTL) from the chat context; the model never supplies account IDs or held legs (see `HERMES.md`).

- **Options book library** — `pnpm --filter @oggregator/server library:build` indexes `docs/*.pdf` into `docs/options-library.sqlite` (FTS5, gitignored). Scanned PDFs without a text layer are skipped. Restart the backend after a rebuild; an open handle keeps reading the replaced file.

- **Live chain runtimes are the cache** — `ChainRuntime.fetchSnapshotData()` returns the delta-maintained snapshot when the runtime has listeners, and rebuilds from the QuoteStore only for idle runtimes. Rebuilding a live runtime broadcasts a full snapshot frame to every viewer, so avoid forcing it from request paths.
