# OKX — WebSocket opt-summary Channel

Source: https://www.okx.com/docs-v5/en/#public-data-websocket-option-summary-channel

## Channel

`opt-summary`

## URL Path

`/ws/v5/public` (no authentication needed)

## Subscribe Format

```json
{
  "op": "subscribe",
  "args": [
    {
      "channel": "opt-summary",
      "instFamily": "BTC-USD"
    }
  ]
}
```

## Push Data (verified live 2026-03-20)

```json
{
  "arg": {
    "channel": "opt-summary",
    "instFamily": "BTC-USD"
  },
  "data": [
    {
      "instType": "OPTION",
      "instId": "BTC-USD-260323-69500-P",
      "uly": "BTC-USD",
      "delta": "-0.4322834935",
      "gamma": "9.2612727458",
      "vega": "0.0003722247",
      "theta": "-0.0027351203",
      "deltaBS": "-0.4177692831",
      "gammaBS": "0.0001198083",
      "thetaBS": "-189.9336406909",
      "vegaBS": "26.0871868579",
      "lever": "68.8979953579",
      "markVol": "0.4876708033",
      "bidVol": "0.4736418652",
      "askVol": "0.5004972802",
      "realVol": "",
      "volLv": "0.4736414899",
      "fwdPx": "70097.9783321022",
      "ts": "1773966134835",
      "buyApr": "1.54070352",
      "sellApr": "1.65075377",
      "distance": "-0.00853061"
    }
  ]
}
```

## Field Mapping

| Field | Key | Description |
|---|---|---|
| Instrument ID | `instId` | e.g. `BTC-USD-260321-70000-C` |
| Delta (coins) | `delta` | Sensitivity to underlying (coin-denominated) |
| Delta (USD) | `deltaBS` | Black-Scholes delta |
| Gamma (coins) | `gamma` | |
| Gamma (USD) | `gammaBS` | |
| Theta (coins) | `theta` | |
| Theta (USD) | `thetaBS` | |
| Vega (coins) | `vega` | |
| Vega (USD) | `vegaBS` | |
| Mark IV | `markVol` | Implied volatility (mark) |
| Bid IV | `bidVol` | Implied volatility (bid) |
| Ask IV | `askVol` | Implied volatility (ask) |
| Forward price | `fwdPx` | Forward/underlying price |
| Timestamp | `ts` | Unix ms |

## Key Notes

- **Bulk channel**: ONE subscription returns greeks for ALL options on an instFamily
- Uses `instFamily` param (e.g. `BTC-USD`), NOT `instId`
- **No `markPx` field** — mark price is NOT included
- `fwdPx` is the forward price, usable as underlying price proxy
- Push frequency: data pushed at once when changes occur
- Both coin-denominated (delta/gamma/theta/vega) and USD-denominated (deltaBS/gammaBS/thetaBS/vegaBS) greeks available
