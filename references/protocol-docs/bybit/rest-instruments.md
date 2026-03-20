# Bybit — GET /v5/market/instruments-info

Source: https://bybit-exchange.github.io/docs/v5/market/instrument

## Endpoint

`GET /v5/market/instruments-info?category=option`

Rate Limit: Varies by category

## Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| category | String | Yes | `option` |
| baseCoin | String | No | Base coin filter (default returns all) |
| limit | Number | No | Max 1000, default 500 |
| cursor | String | No | Pagination cursor |

## Response

```json
{
  "retCode": 0,
  "retMsg": "success",
  "result": {
    "category": "option",
    "nextPageCursor": "",
    "list": [
      {
        "symbol": "BTC-25DEC26-67000-C-USDT",
        "status": "Trading",
        "baseCoin": "BTC",
        "quoteCoin": "USDT",
        "settleCoin": "USDT",
        "optionsType": "Call",
        "launchTime": "1770351600000",
        "deliveryTime": "1798185600000",
        "deliveryFeeRate": "0.00015",
        "priceFilter": {
          "minPrice": "5",
          "maxPrice": "1110000",
          "tickSize": "5"
        },
        "lotSizeFilter": {
          "maxOrderQty": "500",
          "minOrderQty": "0.01",
          "qtyStep": "0.01"
        },
        "displayName": ""
      }
    ]
  }
}
```

## Key Notes

- Symbol format: `BTC-25DEC26-67000-C-USDT` (5 parts with settle suffix)
- Legacy format: `BTC-28MAR26-60000-C` (4 parts, no suffix)
- `optionsType`: `"Call"` or `"Put"` (not `"C"`/`"P"`)
- Contract size: always 1 (no explicit field)
- `lotSizeFilter.minOrderQty` = 0.01 (minimum lot)
- SDK method: `RestClientV5.getInstrumentsInfo({ category: 'option' })`
