# Bybit — WebSocket Option Tickers

Source: https://bybit-exchange.github.io/docs/v5/websocket/public/ticker

## Endpoint

`wss://stream.bybit.com/v5/public/option`

## Topic Format

**Per-instrument only**: `tickers.{symbol}`

Example: `tickers.BTC-21MAR26-70000-C-USDT`

⚠️ **`tickers.BTC` (baseCoin) does NOT work for options** — the subscription 
silently succeeds but never delivers any data. Must use per-instrument topics.

## Subscribe (SDK)

```typescript
ws.subscribeV5('tickers.BTC-21MAR26-70000-C-USDT', 'option');

// Array of topics:
ws.subscribeV5([
  'tickers.BTC-21MAR26-70000-C-USDT',
  'tickers.BTC-21MAR26-70000-P-USDT',
], 'option');
```

## Push Data (verified live 2026-03-20)

Messages are **snapshots** (full replacement), NOT incremental deltas.

```json
{
  "topic": "tickers.BTC-21MAR26-70000-C-USDT",
  "ts": 1773966121157,
  "type": "snapshot",
  "id": "tickers.BTC-21MAR26-70000-C-USDT-62191583841-1773966121157",
  "data": {
    "symbol": "BTC-21MAR26-70000-C-USDT",
    "bidPrice": "940",
    "bidSize": "2.18",
    "bidIv": "0.53",
    "askPrice": "960",
    "askSize": "11.23",
    "askIv": "0.5419",
    "lastPrice": "950",
    "highPrice24h": "1820",
    "lowPrice24h": "555",
    "markPrice": "960.2505585",
    "indexPrice": "70089.5343409",
    "markPriceIv": "0.5421",
    "underlyingPrice": "70098.25055849",
    "openInterest": "18.93",
    "turnover24h": "3511046.46438064",
    "volume24h": "50.26",
    "totalVolume": "60",
    "totalTurnover": "4132627",
    "delta": "0.51782561",
    "gamma": "0.0001756",
    "vega": "16.76259941",
    "theta": "-343.85909514",
    "predictedDeliveryPrice": "0",
    "change24h": "-0.51804124"
  }
}
```

## Field Mapping

**Same field names as REST tickers** — see rest-tickers.md for full mapping.

Key differences from REST field names:
- WS uses `bidPrice`/`askPrice` (not `bid1Price`/`ask1Price`)
- WS uses `markPriceIv` (not `markIv`)

## Key Notes

- Max 2000 topics per connection
- Messages are snapshots — each push contains the full state
- Delta messages may occur but are rare for options
- All prices in USDT (linear)
- Full greeks included: delta, gamma, theta, vega
- SDK `COMMAND_RESP` type messages should be filtered out (subscription confirmations)
