# OKX — GET /api/v5/public/opt-summary

Source: https://www.okx.com/docs-v5/en/#public-data-rest-api-get-option-market-data

## Endpoint

`GET /api/v5/public/opt-summary`

Rate Limit: 20 requests per 2 seconds (IP + instFamily)

## Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| instFamily | String | Yes | e.g. `BTC-USD` |
| expTime | String | No | Expiry date filter, format `YYMMDD` |

## Response

```json
{
  "instType": "OPTION",
  "instId": "BTC-USD-260321-70000-C",
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
  "ts": "1646733631242"
}
```

## Field Mapping

| Field | Description |
|---|---|
| `delta` | Sensitivity of option price to underlying (coins) |
| `deltaBS` | Black-Scholes delta (dollars) |
| `gamma` / `gammaBS` | Delta sensitivity |
| `theta` / `thetaBS` | Time decay |
| `vega` / `vegaBS` | Volatility sensitivity |
| `markVol` | Mark implied volatility |
| `bidVol` | Bid implied volatility |
| `askVol` | Ask implied volatility |
| `fwdPx` | Forward price |
| `lever` | Leverage |
| `ts` | Data update time (Unix ms) |

## Important Notes

- Returns greeks for ALL options of an instFamily in one call
- **No `markPx` field** — mark price is not included
- `fwdPx` (forward price) is the closest to underlying/index price available
- `deltaBS`/`gammaBS`/`thetaBS`/`vegaBS` are Black-Scholes (USD) values
- `delta`/`gamma`/`theta`/`vega` are coin-denominated values
- SDK method: `RestClient.getOptionMarketData({ uly: 'BTC-USD' })`
