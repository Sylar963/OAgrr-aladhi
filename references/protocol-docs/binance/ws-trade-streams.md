# Binance EAPI — WebSocket Trade Streams

Source: https://developers.binance.com/docs/derivatives/options-trading/websocket-market-streams/Trade-Streams

## Stream Name

- Per symbol: `<symbol>@optionTrade` (lowercase)
- Per underlying: `<underlyingAsset>@optionTrade`

Example: `btcusdt@optionTrade`

## URL Path

`/public` — use `wss://fstream.binance.com/public/stream?streams=btcusdt@optionTrade`

## Update Speed

**50ms** (real-time)

## Response

```json
{
  "e": "trade",
  "E": 1762856064204,
  "T": 1762856064203,
  "s": "BTC-251123-126000-C",
  "t": 4,
  "p": "1300.000",
  "q": "0.1000",
  "X": "MARKET",
  "S": "BUY",
  "m": false
}
```

## Field Mapping

| Field | Key | Description |
|---|---|---|
| Event type | `e` | `"trade"` |
| Event time | `E` | Timestamp (ms) |
| Trade time | `T` | Trade completed time |
| Symbol | `s` | Option symbol |
| Trade ID | `t` | Trade ID |
| Price | `p` | Trade price |
| Quantity | `q` | Trade quantity (always positive) |
| Trade type | `X` | `"MARKET"` (orderbook) or `"BLOCK"` (block trade) |
| Side | `S` | `"BUY"` or `"SELL"` |
| Buyer is maker | `m` | Boolean |
