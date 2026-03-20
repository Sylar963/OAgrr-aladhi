# public/get_order_book

> Source: https://docs.deribit.com/api-reference/market-data/public-get_order_book

Retrieves the order book for a given instrument, along with market values.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instrument_name` | string | Yes | e.g., `BTC-PERPETUAL` |
| `depth` | integer | No | 1, 5, 10, 20, 50, 100, 1000, 10000 |

## Response Fields

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `instrument_name` | string | No | Unique instrument identifier |
| `timestamp` | integer | No | Milliseconds since Unix epoch |
| `state` | string | No | Book state |
| `stats` | object | No | volume, high, low, price_change, volume_usd |
| `open_interest` | number | No | Outstanding contracts |
| `best_bid_price` | number | Yes | Current best bid |
| `best_bid_amount` | number | Yes | Best bid size |
| `best_ask_price` | number | Yes | Current best ask |
| `best_ask_amount` | number | Yes | Best ask size |
| `index_price` | number | No | Current index price |
| `min_price` | number | No | Minimum order price |
| `max_price` | number | No | Maximum order price |
| `mark_price` | number | No | Mark price |
| `last_price` | number | Yes | Last trade price |
| `underlying_price` | number | No | For IV calculations (options only) |
| `underlying_index` | number | No | Underlying future/index (options only) |
| `interest_rate` | number | No | For IV calculations (options only) |
| `bid_iv` | number | No | IV for best bid (options only) |
| `ask_iv` | number | No | IV for best ask (options only) |
| `mark_iv` | number | No | IV for mark price (options only) |
| `greeks` | object | No | delta, gamma, rho, theta, vega (options only) |
| `funding_8h` | number | No | 8-hour funding (perpetual only) |
| `current_funding` | number | No | Current funding (perpetual only) |
| `delivery_price` | number | No | Settlement price (state=closed) |
| `settlement_price` | number | No | Settlement price (state=open) |
| `bids` | array | No | `[price, amount]` pairs, descending |
| `asks` | array | No | `[price, amount]` pairs, ascending |

## Example

```json
{
  "jsonrpc": "2.0",
  "id": 8772,
  "method": "public/get_order_book",
  "params": {
    "instrument_name": "BTC-PERPETUAL",
    "depth": 5
  }
}
```
