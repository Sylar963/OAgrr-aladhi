# OKX — GET /api/v5/market/tickers

Source: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-tickers

## Endpoint

`GET /api/v5/market/tickers`

Rate Limit: 20 requests per 2 seconds (IP)

## Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| instType | String | Yes | `SPOT`, `SWAP`, `FUTURES`, `OPTION` |
| instFamily | String | No | e.g. `BTC-USD` (applicable to FUTURES/SWAP/OPTION) |

## Response (for OPTION)

```json
{
  "instType": "OPTION",
  "instId": "BTC-USD-260321-70000-C",
  "last": "0.013",
  "lastSz": "1",
  "askPx": "0.0135",
  "askSz": "2058",
  "bidPx": "0.013",
  "bidSz": "1818",
  "open24h": "0.0335",
  "high24h": "0.0335",
  "low24h": "0.01",
  "volCcy24h": "16.13",
  "vol24h": "1613",
  "sodUtc0": "0.012",
  "sodUtc8": "0.011",
  "ts": "1654161646974"
}
```

## Field Mapping

| Field | Description |
|---|---|
| `instId` | Instrument ID |
| `last` | Last traded price (in settle currency, e.g. BTC) |
| `lastSz` | Last traded size |
| `askPx` | Best ask price |
| `askSz` | Best ask size |
| `bidPx` | Best bid price |
| `bidSz` | Best bid size |
| `vol24h` | 24h volume (contracts) |
| `volCcy24h` | 24h volume (base currency) |
| `ts` | Ticker generation time (Unix ms) |

## Notes

- For inverse options (BTC-USD), `bidPx`/`askPx`/`last` are in BTC
- Multiply by underlying price to get USD equivalent
- SDK method: `RestClient.getTickers({ instType: 'OPTION', instFamily: 'BTC-USD' })`
- Returns all options for the instFamily in one call
