# Binance EAPI — WebSocket Mark Price Stream

Source: https://developers.binance.com/docs/derivatives/options-trading/websocket-market-streams/Mark-Price

## Stream Name

`<underlying>@optionMarkPrice`

Example: `btcusdt@optionMarkPrice`

## URL Path

`/market` — use `wss://fstream.binance.com/market/stream?streams=btcusdt@optionMarkPrice`

## Update Speed

**1000ms**

## Description

Mark price, greeks, and best bid/ask for **ALL** option symbols on a specific underlying asset.
This is the most useful bulk stream for an options aggregator.

## Response (array of objects)

```json
[
  {
    "e": "markPrice",
    "E": 1762867543321,
    "s": "BTC-251120-126000-C",
    "mp": "770.543",
    "i": "104334.60217391",
    "P": "0.000",
    "bo": "0.000",
    "ao": "900.000",
    "bq": "0.0000",
    "aq": "0.2000",
    "b": "-1.0",
    "a": "0.98161161",
    "hl": "924.652",
    "ll": "616.435",
    "vo": "0.9408058",
    "rf": "0.0",
    "d": "0.11111964",
    "t": "-164.26702615",
    "g": "0.00001245",
    "v": "30.63855919"
  }
]
```

## Field Mapping

| Field | Key | Description |
|---|---|---|
| Event type | `e` | Always `"markPrice"` |
| Event time | `E` | Timestamp (ms) |
| Symbol | `s` | Option symbol (e.g. `BTC-260321-70000-C`) |
| Mark price | `mp` | Mark price in USDT |
| Index price | `i` | Underlying index price |
| Est. settle price | `P` | Only useful 0.5h before settlement |
| Best bid price | `bo` | Best buy price |
| Best ask price | `ao` | Best sell price |
| Best bid qty | `bq` | Best buy quantity |
| Best ask qty | `aq` | Best sell quantity |
| Bid IV | `b` | Buy implied volatility (-1 = no bid) |
| Ask IV | `a` | Sell implied volatility |
| High price limit | `hl` | Buy maximum price |
| Low price limit | `ll` | Sell minimum price |
| Mark IV | `vo` | Implied volatility (mark) |
| Risk-free rate | `rf` | Risk-free interest rate |
| Delta | `d` | Delta |
| Theta | `t` | Theta |
| Gamma | `g` | Gamma |
| Vega | `v` | Vega |

## Notes

- This is a **bulk** stream — one subscription returns data for ALL options on an underlying
- Includes bid/ask prices (`bo`/`ao`), mark price (`mp`), AND greeks
- Underlying asset name uses `btcusdt` format (not just `btc`)
- The stream name in the docs example uses `<underlyingAsset>@markPrice` but actual working format appears to be `btcusdt@optionMarkPrice`
- Update frequency: 1000ms
