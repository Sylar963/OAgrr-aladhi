# @oggregator/tradfi

Separate Fastify service that serves live, enriched TastyTrade listed-options chains via REST and WebSocket. Runs as its own process on port 3200, independent of the crypto `@oggregator/server`.

## Purpose

Bridges TastyTrade (equity/index options) into the oggregator enrichment pipeline. Authenticates via OAuth2, loads the nested option chain catalog via REST, then streams live quotes and greeks/IV over DXLink WebSocket, merging events into an in-memory store from which `/chains` and `/ws/chain` serve enriched snapshots.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TASTYTRADE_CLIENT_ID` | yes | — | OAuth2 client ID |
| `TASTYTRADE_CLIENT_SECRET` | yes | — | OAuth2 client secret |
| `TASTYTRADE_REFRESH_TOKEN` | yes | — | OAuth2 refresh token (personal grant) |
| `TRADFI_PORT` | no | `3200` | Port to listen on |
| `TRADFI_UNDERLYINGS` | no | SPX,NDX,SPY,QQQ,AAPL,NVDA,TSLA | Comma-separated list of underlyings to load |

Secrets are loaded from the gitignored repo-root `.env` via `--env-file-if-exists=../../.env`.

## Dev

```bash
pnpm --filter @oggregator/tradfi dev
```

Logs "tradfi service listening" then "markets loaded + streaming" once bootstrapped.

## Routes

| Method | Path | Description |
|---|---|---|
| GET | `/venues` | Venue capabilities list |
| GET | `/underlyings` | Loaded underlyings |
| GET | `/expiries?underlying=AAPL` | Expiry dates for an underlying |
| GET | `/chains?underlying=AAPL&expiry=2026-04-17` | Enriched option chain snapshot |
| WS | `/ws/chain?underlying=AAPL&expiry=2026-04-17` | Live 200ms push of enriched chain |
| GET | `/health` | Liveness — always 200; reports uptime, market-open, readiness |
| GET | `/ready` | Readiness — 200 once catalog loaded + data flowing, else 503 |

`/chains` returns `503 { error: 'catalog not loaded' }` before the chain catalog loads, `503 { error: 'no market data yet' }` while warming up (the web client retries 503s), and `200` with an empty `strikes` array when an expiry genuinely has no instruments.

## Auth / token chain

OAuth2 refresh-token grant (`/oauth/token`) → 15-min access token → `/api-quote-tokens` → DXLink quote token (24h) → DXLink WebSocket. The feed refreshes the quote token a margin (~5 min) before its real `expires-at` (falling back to ~23h if the API omits it), and re-auths immediately with a fresh token if DXLink rejects the current one.

## Deploy

Runs on the Scaleway host (not Vercel — persistent process + WebSocket + in-memory store). See [`deploy/DEPLOY.md`](./deploy/DEPLOY.md) for the systemd unit, nginx vhost, and the host checklist.

## Notes

- The dev TastyTrade account uses delayed market data. A real-time market-data agreement with TastyTrade is required to enable live quotes.
- Holiday calendar is not implemented in v1; market-hours check covers weekdays 09:30–16:00 ET only.
