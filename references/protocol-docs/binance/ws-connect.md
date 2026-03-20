# Binance EAPI — WebSocket Connection

Source: https://developers.binance.com/docs/derivatives/options-trading/websocket-market-streams

## Base URLs

| Path | Purpose |
|---|---|
| `wss://fstream.binance.com/public/` | High-frequency public data (e.g. `@depth`) |
| `wss://fstream.binance.com/market/` | Regular market data (e.g. `@optionTicker`, `@optionMarkPrice`) |
| `wss://fstream.binance.com/private/` | User data streams (requires listenKey) |

## Stream Access

- **Raw stream**: `/ws/<streamName>`
  - Example: `wss://fstream.binance.com/public/ws/btc-210630-9000-p@optionTicker`
- **Combined streams**: `/stream?streams=<name1>/<name2>/<name3>`
  - Example: `wss://fstream.binance.com/market/stream?streams=btcusdt@optionMarkPrice`

## Subscribe/Unsubscribe (combined stream)

```json
{ "method": "SUBSCRIBE", "params": ["btcusdt@optionMarkPrice"], "id": 1 }
{ "method": "UNSUBSCRIBE", "params": ["btcusdt@optionMarkPrice"], "id": 2 }
```

Response: `{ "result": null, "id": 1 }` (null = success)

Combined stream events wrapped as:
```json
{ "stream": "<streamName>", "data": <rawPayload> }
```

## Rules

- **All symbols lowercase** in stream names
- Max **200 streams** per connection
- Max **10 incoming messages/second** per connection
- Connection valid for **24 hours** max, then auto-disconnected
- Server sends `ping` every 5 min — must respond with `pong` within 15 min
- `serverShutdown` event sent before disconnection for maintenance
