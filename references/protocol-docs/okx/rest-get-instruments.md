# OKX — GET /api/v5/public/instruments

Source: https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments

## Endpoint

`GET /api/v5/public/instruments`

Rate Limit: 20 requests per 2 seconds (IP + Instrument Type)

## Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| instType | String | Yes | `SPOT`, `MARGIN`, `SWAP`, `FUTURES`, `OPTION` |
| instFamily | String | Conditional | Required for OPTION. e.g. `BTC-USD` |
| instId | String | No | Specific instrument ID |

## Response (OPTION relevant fields)

```json
{
  "instType": "OPTION",
  "instId": "BTC-USD-260321-70000-C",
  "uly": "BTC-USD",
  "instFamily": "BTC-USD",
  "settleCcy": "BTC",
  "ctVal": "0.01",
  "ctMult": "1",
  "ctValCcy": "BTC",
  "optType": "C",
  "stk": "70000",
  "listTime": "1597026383085",
  "expTime": "1774598400000",
  "tickSz": "0.0001",
  "lotSz": "1",
  "minSz": "1",
  "ctType": "",
  "state": "live"
}
```

## Key Fields for Options

| Field | Description |
|---|---|
| `instId` | e.g. `BTC-USD-260321-70000-C` |
| `uly` | Underlying: `BTC-USD` |
| `instFamily` | Instrument family: `BTC-USD` |
| `settleCcy` | Settlement currency: `BTC` (inverse!) |
| `ctVal` | Contract value |
| `ctMult` | Contract multiplier |
| `optType` | `C` (Call) or `P` (Put) |
| `stk` | Strike price |
| `expTime` | Expiry time (Unix ms) |
| `state` | `live`, `suspend`, `preopen`, `expired` |

## Notes

- OKX BTC/ETH options are **coin-margined (inverse)**: `settleCcy` = `BTC`/`ETH`
- Prices (bid/ask) are quoted in BTC/ETH, not USD
- Must multiply by underlying price to get USD equivalent
