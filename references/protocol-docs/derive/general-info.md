# Derive (formerly Lyra Finance) — General Info

Source: https://docs.derive.xyz/reference/overview

## Base Endpoints

| Environment | REST (POST) | WebSocket |
|---|---|---|
| Production | `https://api.lyra.finance` | `wss://api.lyra.finance/ws` |
| Note | `api.derive.xyz` does NOT resolve as of 2026-03. Use legacy `api.lyra.finance` domain. |

## Protocol

- JSON-RPC 2.0 over WebSocket (same connection for RPC calls and subscriptions)
- REST is also JSON-RPC — all endpoints are `POST` with JSON body
- Both REST and WS use the same method names (e.g. `public/get_instruments`)

## Key Differences from Deribit

Despite similar JSON-RPC protocol, Derive differs:

| Feature | Deribit | Derive |
|---|---|---|
| Subscribe method | `public/subscribe` | `subscribe` (no `public/` prefix) |
| Unsubscribe method | `public/unsubscribe` | `unsubscribe` |
| Heartbeat | `public/set_heartbeat` + respond to `test_request` | No heartbeat mechanism — use WS ping/pong |
| Instrument naming | `BTC-28MAR26-60000-C` | `BTC-20260328-60000-C` (YYYYMMDD) |
| `get_all_instruments` | Returns all | **Caps at 100** (only SOL). Must use `get_instruments` per currency. |
| Ticker channel | `ticker.{inst}.100ms` | `ticker_slim.{inst}.1000` (recommended since Dec 2025) |
| `get_tickers` params | `currency` + `kind` | `currency` + `instrument_type` + `expiry_date` (YYYYMMDD required for options) |
| Tickers response | dict keyed by instrument name with abbreviated fields | Same |

## Settlement

- All options are **USDC-settled** (linear)
- No inverse conversion needed

## Supported Currencies

BTC, ETH, SOL (as of March 2026)

## Rate Limits

Source: https://docs.derive.xyz/reference/rate-limits
- Refer to the rate limits page for specific per-method limits
- API is generally slow — use 30-45s timeouts for initial instrument/ticker loading
