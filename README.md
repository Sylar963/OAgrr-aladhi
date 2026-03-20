# oggregator

Compare options pricing, greeks, and IV across Deribit, OKX, Binance, Bybit, and Derive in real-time.

## Quick start

```bash
pnpm install
pnpm dev          # server (:3100) + web (:5173)
```

## Quality gates

```bash
pnpm typecheck    # tsc --noEmit across all packages
pnpm test         # 211 doc-driven contract tests
pnpm precommit    # typecheck + test
```

## Architecture

```
packages/
  core/     Venue feeds, canonical types, normalization, comparison
  server/   Fastify REST + WS aggregation server
  web/      React + Vite dashboard
```

All 5 venue adapters connect via WebSocket, normalize to `NormalizedOptionContract`, and serve cross-venue comparison grids through REST endpoints.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health |
| `GET /api/venues` | Connected venues |
| `GET /api/underlyings` | Base assets per venue |
| `GET /api/expiries?underlying=BTC` | Expiry dates |
| `GET /api/chains?underlying=BTC&expiry=2026-03-28` | Cross-venue option chain |

## Reference docs

Official API documentation per venue lives in `references/protocol-docs/`. Tests are written against these docs.
