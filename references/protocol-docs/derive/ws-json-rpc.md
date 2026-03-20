# Derive — JSON-RPC Protocol

Source: https://docs.derive.xyz/reference/json-rpc

## Protocol

JSON-RPC 2.0 over WebSocket at `wss://api.lyra.finance/ws`

All communication (RPC calls, subscriptions, notifications) goes through a single WS connection.

## Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "public/get_instruments",
  "params": {
    "currency": "BTC",
    "instrument_type": "option",
    "expired": false
  }
}
```

## Response Format

Success:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [ ... ]
}
```

Error:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": "Expiry date is required for options"
  }
}
```

## Subscription Notification Format

```json
{
  "jsonrpc": "2.0",
  "method": "subscription",
  "params": {
    "channel": "ticker_slim.BTC-20260327-84000-C.1000",
    "data": { ... }
  }
}
```

## Key Methods We Use

| Method | Purpose |
|---|---|
| `public/get_instruments` | Load instrument catalog per currency |
| `public/get_tickers` | Bulk ticker snapshot per currency+expiry |
| `subscribe` | Subscribe to channels (NOT `public/subscribe`) |
| `unsubscribe` | Unsubscribe from channels |

## Heartbeat

Derive does NOT support `public/set_heartbeat` like Deribit.
Use WebSocket-level ping/pong frames to keep the connection alive.

## Error Codes (observed)

| Code | Message | Cause |
|---|---|---|
| -32602 | Invalid params | Missing required field or wrong format |
| -32601 | Method not found | Using `public/subscribe` instead of `subscribe` |

## Timeout

The API can be slow — use 30-45 second timeouts for initial data loading.
Fetching tickers for all 13+ expiries sequentially takes ~13 seconds total.
