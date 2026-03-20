# Binance EAPI — Option Mark Price

Source: https://developers.binance.com/docs/derivatives/options-trading/market-data/Option-Mark-Price

## Endpoint

`GET /eapi/v1/mark`

Returns mark price and greek info for all options.

## Response

```json
[
  {
    "symbol": "BTC-200730-9000-C",
    "markPrice": "1343.2883",
    "bidIV": "1.40000077",
    "askIV": "1.50000153",
    "markIV": "1.45000000",
    "delta": "0.55937056",
    "theta": "3739.82509871",
    "gamma": "0.00010969",
    "vega": "978.58874732",
    "highPriceLimit": "1618.241",
    "lowPriceLimit": "1068.3356",
    "riskFreeInterest": "0.1"
  }
]
```

## Field Mapping

| Field | Description |
|---|---|
| `symbol` | Option symbol (e.g. `BTC-260321-70000-C`) |
| `markPrice` | Mark price in USDT |
| `markIV` | Implied volatility (mark) |
| `bidIV` | Implied volatility (bid) |
| `askIV` | Implied volatility (ask) |
| `delta` | Delta |
| `theta` | Theta |
| `gamma` | Gamma |
| `vega` | Vega |
| `highPriceLimit` | Max buy price |
| `lowPriceLimit` | Min sell price |
| `riskFreeInterest` | Risk-free rate |

## Notes

- Returns ALL options across all underlyings in a single call
- Does NOT include bid/ask prices (use `/eapi/v1/ticker` for those)
- Does NOT include underlyingPrice (use ticker `exercisePrice` field)
- All values are strings
