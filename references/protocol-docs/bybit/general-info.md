# Bybit v5 API — General Info (Options)

Source: https://bybit-exchange.github.io/docs/v5/intro

## Base Endpoints

| Environment | REST | WS (Options) |
|---|---|---|
| Mainnet | `https://api.bybit.com/v5` | `wss://stream.bybit.com/v5/public/option` |
| Testnet | `https://api-testnet.bybit.com/v5` | `wss://stream-testnet.bybit.com/v5/public/option` |

## Settlement

- All options are **USDT-settled** (as of March 2026)
- No inverse conversion needed
- Symbol format: `BTC-21MAR26-70000-C-USDT` (with settle suffix)

## WebSocket Limits (Options)

- Max **2000 topics** per connection
- Max **21000 characters** in args array per subscribe request
- Max **500 connections** per 5-minute window per WS domain
- Max **1000 connections** per IP for options market data

## WebSocket Topic Format

- Per-instrument: `tickers.BTC-21MAR26-70000-C-USDT`
- ⚠️ `tickers.BTC` (baseCoin bulk) does NOT work for options — silently accepts but never delivers data

## SDK

- `bybit-api` npm package (tiagosiebler)
- `RestClientV5` for REST, `WebsocketClient` for WS
- `ws.subscribeV5(topics, 'option')` for option subscriptions
