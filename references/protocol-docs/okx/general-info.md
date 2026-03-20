# OKX API v5 — General Info

Source: https://www.okx.com/docs-v5/en/#overview

## Base Endpoints

| Environment | REST | Public WS | Private WS | Business WS |
|---|---|---|---|---|
| Production | `https://www.okx.com` | `wss://ws.okx.com:8443/ws/v5/public` | `wss://ws.okx.com:8443/ws/v5/private` | `wss://ws.okx.com:8443/ws/v5/business` |
| Demo | `https://www.okx.com` | `wss://wspap.okx.com:8443/ws/v5/public` | `wss://wspap.okx.com:8443/ws/v5/private` | `wss://wspap.okx.com:8443/ws/v5/business` |

## instFamily and uly Explained

For options, `uly` = `BTC-USD` and `instFamily` = `BTC-USD`.

| Contract Type | uly | instFamily | settleCcy |
|---|---|---|---|
| Coin-margined | BTC-USD | BTC-USD | BTC |
| USDT-margined | BTC-USDT | BTC-USDT | USDT |
| USDC-margined | BTC-USDC | BTC-USDC | USDC |

For options, BTC-USD options are **coin-margined (inverse)**, settled in BTC.

## WebSocket Rules

- Connection limit: 3 per second per IP
- Subscribe/unsubscribe/login limit: 480 per hour per connection
- 30 WS connections per channel per sub-account
- Server sends `ping` every 20s — must respond with `pong`
- `notice` event sent 60s before maintenance disconnection

## Subscribe Format

```json
{
  "op": "subscribe",
  "args": [
    {
      "channel": "tickers",
      "instId": "BTC-USD-260321-70000-C"
    }
  ]
}
```

**Response:**
```json
{
  "event": "subscribe",
  "arg": {
    "channel": "tickers",
    "instId": "BTC-USD-260321-70000-C"
  },
  "connId": "accb8e21"
}
```

## Important Notes

- `instFamily` is applicable to FUTURES/SWAP/OPTION
- For OPTION instType, `instFamily` is required for `getInstruments`
- `tickers` channel requires `instId` (per instrument), NOT `instFamily` for options
- `opt-summary` channel uses `instFamily` for bulk greeks
