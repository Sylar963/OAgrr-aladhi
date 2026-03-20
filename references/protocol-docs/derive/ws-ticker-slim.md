# Derive — ticker_slim Channel

Source: https://docs.derive.xyz/reference/ticker_slim-instrument_name-interval

## Channel Name

`ticker_slim.{instrument_name}.{interval}`

Example: `ticker_slim.BTC-20260327-84000-C.1000`

**Recommended since December 2025** — replaces the deprecated `ticker` channel.

## Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| instrument_name | String | Yes | e.g. `BTC-20260327-84000-C` |
| interval | String | Yes | `100` or `1000` (milliseconds) |

## Push Data (verified live 2026-03-19)

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
        "f": null,
        "option_pricing": {
          "d": "0.01561",
          "t": "-15.67096",
          "g": "0.00000667",
          "v": "3.88184",
          "i": "0.59308",
          "r": "0.63993",
          "f": "69827",
          "m": "31",
          "df": "0.999",
          "bi": "0.58565",
          "ai": "0.6478"
        },
        "I": "69814",
        "M": "31",
        "stats": {
          "c": "0",
          "v": "0",
          "pr": "0",
          "n": 0,
          "oi": "119.647",
          "h": "0",
          "l": "0",
          "p": "0"
        },
        "minp": "1",
        "maxp": "478"
      }
    }
  }
}
```

## Field Mapping

Same abbreviated format as `get_tickers` response — see ws-get-tickers.md for full mapping.

Key fields:
- `B` = best bid price
- `A` = best ask price
- `I` = index price
- `M` = mark price
- `option_pricing.d` = delta
- `option_pricing.g` = gamma
- `option_pricing.t` = theta
- `option_pricing.v` = vega
- `option_pricing.i` = implied volatility
- `option_pricing.bi` = bid IV
- `option_pricing.ai` = ask IV
- `stats.oi` = open interest

## Key Notes

- Data wrapped in `{ timestamp, instrument_ticker: { ... } }`
- Instrument name is NOT in the data — extract from channel string:
  `ticker_slim.BTC-20260327-84000-C.1000` → split by `.` → parts[1..-1].join('.')
- Per-instrument subscription only — no bulk option
- Subscribe in batches of ~100 to avoid overwhelming the connection
- The `ticker` (non-slim) channel is deprecated since December 2025
