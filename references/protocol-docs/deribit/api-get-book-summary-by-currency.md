# public/get_book_summary_by_currency

> Source: https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency

Retrieves market summary data across all instruments for a specified currency.

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `currency` | Yes | string | BTC, ETH, USDC, USDT, EURR |
| `kind` | No | string | future, option, spot, future_combo, option_combo |

## Response Fields (book_summary object)

| Field | Type | Description |
|-------|------|-------------|
| `instrument_name` | string | Unique instrument identifier |
| `high` | number | 24h highest trade price |
| `low` | number | 24h lowest trade price (nullable) |
| `base_currency` | string | Base currency |
| `quote_currency` | string | Quote currency |
| `volume` | number | 24h traded volume (base currency) |
| `bid_price` | number | Current best bid (nullable) |
| `ask_price` | number | Current best ask (nullable) |
| `mid_price` | number | Average of bid/ask (nullable) |
| `mark_price` | number | Current market price |
| `last` | number | Latest trade price (nullable) |
| `open_interest` | number | Outstanding contracts |
| `creation_timestamp` | integer | Milliseconds since Unix epoch |
| `price_change` | number | 24h change percentage (nullable) |
| `volume_usd` | number | Volume in USD |
| `volume_notional` | number | Volume in quote currency |
| `current_funding` | number | Current funding (perpetual only) |
| `funding_8h` | number | 8-hour funding (perpetual only) |
| `mark_iv` | number | Implied volatility for mark price (options only) |
| `interest_rate` | number | IR for volatility calculations (options only) |
| `underlying_index` | string | Underlying future name or 'index_price' (options only) |
| `underlying_price` | number | Underlying price (options only) |
| `estimated_delivery_price` | number | Estimated delivery price (derivatives only) |

## Example Request

```json
{
  "jsonrpc": "2.0",
  "id": 9344,
  "method": "public/get_book_summary_by_currency",
  "params": {
    "currency": "BTC",
    "kind": "option"
  }
}
```

## Example Response

```json
{
  "jsonrpc": "2.0",
  "id": 3659,
  "result": [
    {
      "volume": 0.55,
      "underlying_price": 121.38,
      "underlying_index": "index_price",
      "quote_currency": "USD",
      "price_change": -26.7793594,
      "open_interest": 0.55,
      "mid_price": 0.2444,
      "mark_price": 80,
      "low": 0.34,
      "last": 0.34,
      "interest_rate": 0.207,
      "instrument_name": "ETH-22FEB19-140-P",
      "high": 0.34,
      "creation_timestamp": 1550227952163,
      "bid_price": 0.1488,
      "base_currency": "ETH",
      "ask_price": 0.34
    }
  ]
}
```
