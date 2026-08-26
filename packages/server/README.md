# @oggregator/server

Fastify REST + WebSocket API. Bootstraps venue adapters from `@oggregator/core`, serves enriched option chain data, and hosts the web dashboard in production.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health |
| `GET /api/ready` | Readiness for deploy health checks |
| `GET /api/venues` | Connected venues and connection state |
| `GET /api/underlyings` | Available base assets, per-venue breakdown |
| `GET /api/expiries?underlying=BTC` | Expiry dates with per-venue availability |
| `GET /api/chains?underlying=BTC&expiry=...&venues=...` | Cross-venue enriched option chain |
| `GET /api/alpha/market-context?underlying=BTC` | IV/RV, expected move, range, and regime context for Alpha strategies |
| `GET /api/alpha/lotto-scanner` | Multi-venue short-dated OTM call scan and sizing estimates |
| `GET /api/surface?underlying=BTC` | IV surface (expiry × delta heatmap) |
| `GET /api/stats?underlying=BTC` | Spot, DVOL, IVR, 24h changes |
| `GET /api/dvol-history?currency=BTC` | Historical DVOL candles + realized vol |
| `GET /api/flow?underlying=BTC` | Recent options trades across venues |
| `GET /api/block-flow?underlying=BTC` | Institutional RFQ / block trades |
| `WS /ws/chain` | Real-time chain snapshot push |

## Commands

```bash
pnpm dev          # tsx watch on :3100 (hot reload)
pnpm build        # tsc → dist/
pnpm start        # NODE_ENV=production node dist/index.js
pnpm test:run     # vitest
```

### Alpha analysis

The market-context endpoint centralizes cross-venue ATM IV history, 7d/30d realized volatility,
implied expected moves, range compression, spot extension, and the fitted BTC/ETH regime. Fields
whose historical source is unavailable remain null rather than using a venue-mismatched proxy.

The scanner accepts an underlying and comma-separated venue list. Defaults remain BTC and Thalex;
the Alpha UI passes its globally active venues. Other defaults are 4–14 DTE, at least 5% OTM,
mark at or below $400, $2,400 buying power, a 50% maximum quoted spread, and a 1.2x sizing reserve.

```bash
curl 'http://localhost:3100/api/alpha/lotto-scanner?underlying=BTC&venues=deribit,okx,thalex&premiumCap=400&minOtmPct=5&buyingPower=2400'
```

The response normalizes inverse and non-unit contract economics, includes venue contract metadata,
and ranks candidates by the 10x move in tenor-matched implied-move units before spread and mark.
Black-76 target levels hold current IV and remaining time constant; intrinsic target levels assume
expiry. The endpoint scans only and never submits an order.

## How it works

1. Server starts and begins bootstrapping venue adapters (~5–15s)
2. During bootstrap, data endpoints and `GET /api/ready` return `503`. The web client retries automatically
3. Once adapters connect, `isReady()` flips and data starts flowing
4. The chain view uses `WS /ws/chain` as the primary browser transport. The server coalesces venue deltas into enriched snapshots every 200ms instead of forwarding raw exchange ticks
5. In production (`NODE_ENV=production`), the server also serves the built web SPA from `../web/dist/`

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server listen port |
| `NODE_ENV` | | Set to `production` to serve static SPA |
| `DATABASE_URL` | | Optional Postgres source for older trade history and server persistence |
| `TRADE_SQLITE_PATH` | `.cache/ingest-trades.sqlite` | Read-only local source for pending trade history; must match ingest on shared persistent storage |
