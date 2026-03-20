# Bybit — GET /v5/market/tickers (Options)

Source: https://bybit-exchange.github.io/docs/v5/market/tickers

## Endpoint

`GET /v5/market/tickers?category=option&baseCoin=BTC`

## Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| category | String | Yes | `option` |
| baseCoin | String | No | e.g. `BTC` |

## Response

```json
{
  "retCode": 0,
  "retMsg": "SUCCESS",
  "result": {
    "category": "option",
    "list": [
      {
        "symbol": "BTC-21MAR26-70000-C-USDT",
        "bidPrice": "930",
        "bidSize": "1.46",
        "bidIv": "0.535",
        "askPrice": "940",
        "askSize": "2.39",
        "askIv": "0.541",
        "lastPrice": "935",
        "highPrice24h": "1820",
        "lowPrice24h": "555",
        "markPrice": "937.69840219",
        "indexPrice": "70055.65003535",
        "markPriceIv": "0.5397",
        "underlyingPrice": "70064.65572325",
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
    ]
  }
}
```

## Field Mapping (REST and WS use same field names)

| Field | Description |
|---|---|
| `symbol` | Option symbol |
| `bidPrice` | Best bid price (USDT) |
| `askPrice` | Best ask price (USDT) |
| `markPrice` | Mark price (USDT) |
| `indexPrice` | Index price |
| `underlyingPrice` | Underlying price |
| `lastPrice` | Last traded price |
| `markPriceIv` | Mark price implied volatility |
| `bidIv` | Bid implied volatility |
| `askIv` | Ask implied volatility |
| `delta` | Delta |
| `gamma` | Gamma |
| `theta` | Theta |
| `vega` | Vega |
| `openInterest` | Open interest |
| `volume24h` | 24h volume |

## Notes

- Returns ALL options for a baseCoin in one call
- All prices are in USDT (linear, no inverse conversion needed)
- Greeks are included in the ticker response
- SDK method: `RestClientV5.getTickers({ category: 'option', baseCoin: 'BTC' })`
