# Binance EAPI — Exchange Information

Source: https://developers.binance.com/docs/derivatives/options-trading/market-data/Exchange-Information

## Endpoint

`GET /eapi/v1/exchangeInfo`

Returns current exchange trading rules and symbol information.

## Response

```json
{
  "timezone": "UTC",
  "serverTime": 1592387337630,
  "optionContracts": [
    {
      "baseAsset": "BTC",
      "quoteAsset": "USDT",
      "underlying": "BTCUSDT",
      "settleAsset": "USDT"
    }
  ],
  "optionAssets": [
    { "name": "USDT" }
  ],
  "optionSymbols": [
    {
      "symbol": "BTC-220815-50000-C",
      "side": "CALL",
      "strikePrice": "50000",
      "underlying": "BTCUSDT",
      "unit": 1,
      "expiryDate": 1660521600000,
      "quoteAsset": "USDT",
      "status": "TRADING",
      "minQty": "0.01",
      "maxQty": "100",
      "priceScale": 2,
      "quantityScale": 2,
      "initialMargin": "0.15",
      "maintenanceMargin": "0.075",
      "filters": [
        { "filterType": "PRICE_FILTER", "minPrice": "0.02", "maxPrice": "80000.01", "tickSize": "0.01" },
        { "filterType": "LOT_SIZE", "minQty": "0.01", "maxQty": "100", "stepSize": "0.01" }
      ]
    }
  ],
  "rateLimits": [
    { "rateLimitType": "REQUEST_WEIGHT", "interval": "MINUTE", "intervalNum": 1, "limit": 2400 },
    { "rateLimitType": "ORDERS", "interval": "MINUTE", "intervalNum": 1, "limit": 1200 }
  ]
}
```

## Key Fields

- `optionSymbols[].symbol` — format: `BTC-260328-60000-C` (BASE-YYMMDD-STRIKE-C/P)
- `optionSymbols[].side` — `"CALL"` or `"PUT"`
- `optionSymbols[].underlying` — e.g. `"BTCUSDT"`
- `optionSymbols[].unit` — contract unit (quantity of underlying per contract)
- `optionSymbols[].quoteAsset` — always `"USDT"`
