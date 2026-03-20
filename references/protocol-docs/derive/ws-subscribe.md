# Derive — Subscribe / Unsubscribe

Source: https://docs.derive.xyz/reference/subscribe

## Subscribe Method

⚠️ Method is `subscribe` — NOT `public/subscribe` (unlike Deribit)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "subscribe",
  "params": {
    "channels": [
      "ticker_slim.BTC-20260327-84000-C.1000"
    ]
  }
}
```

## Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": {
      "ticker_slim.BTC-20260327-84000-C.1000": "ok"
    },
    "current_subscriptions": [
      "ticker_slim.BTC-20260327-84000-C.1000"
    ]
  }
}
```

## Unsubscribe Method

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "unsubscribe",
  "params": {
    "channels": [
      "ticker_slim.BTC-20260327-84000-C.1000"
    ]
  }
}
```

## Notification Format

Subscriptions push data via JSON-RPC notifications:

```json
{
  "jsonrpc": "2.0",
  "method": "subscription",
  "params": {
    "channel": "ticker_slim.BTC-20260327-84000-C.1000",
    "data": {
      "timestamp": 1773963738391,
      "instrument_ticker": {
        "t": 1773963738391,
        "A": "5.52",
        "a": "58",
        "B": "25.72862",
        "b": "29",
        "option_pricing": { ... },
        "I": "69814",
        "M": "31",
        "stats": { "oi": "119.647", ... }
      }
    }
  }
}
```

## Key Notes

- Notification `method` is always `"subscription"`
- `params.channel` contains the channel name
- `params.data` contains the payload
- For `ticker_slim`, data is wrapped in `{ timestamp, instrument_ticker: { ... } }`
- Instrument name must be extracted from the channel string, not from the data
