# Binance EAPI — 24hr Ticker Price Change Statistics

Source: https://developers.binance.com/docs/derivatives/options-trading/market-data/24hr-Ticker-Price-Change-Statistics

## Endpoint

`GET /eapi/v1/ticker`

24 hour rolling window price change statistics for all options.

## Response

```json
[
  {
    "symbol": "BTC-200730-9000-C",
    "priceChange": "-16.2038",
    "priceChangePercent": "-0.0162",
    "lastPrice": "1000",
    "lastQty": "1000",
    "open": "1016.2038",
    "high": "1016.2038",
    "low": "0",
    "volume": "5",
    "amount": "1",
    "bidPrice": "999.34",
    "askPrice": "1000.23",
    "openTime": 1592317127349,
    "closeTime": 1592380593516,
    "firstTradeId": 1,
    "tradeCount": 5,
    "strikePrice": "9000",
    "exercisePrice": "3000.3356"
  }
]
```

## Field Mapping

| Field | Description |
|---|---|
| `symbol` | Option symbol |
| `bidPrice` | Best buy price (USDT) |
| `askPrice` | Best sell price (USDT) |
| `lastPrice` | Last trade price |
| `volume` | Trading volume (in contracts) |
| `amount` | Trade amount (in quote asset USDT) |
| `exercisePrice` | Estimated settlement price (1h before exercise) / index price (other times) |
| `strikePrice` | Strike price |

## Notes

- Returns ALL options across all underlyings in a single call
- `exercisePrice` can be used as underlying/index price proxy
- Complements `/eapi/v1/mark` which has greeks but no bid/ask
