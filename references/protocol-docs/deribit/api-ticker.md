# public/ticker

> Source: https://docs.deribit.com/api-reference/market-data/public-ticker

Retrieves 24-hour market statistics for a specific trading instrument.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instrument_name` | string | Yes | Unique instrument identifier |

## Response (TickerNotification object)

### Required Fields

- `instrument_name` (string)
- `timestamp` (integer, ms since Unix epoch)
- `state` (string: open, settlement, delivered, inactive, locked, halted, archivized)
- `stats` (object): volume, high, low, price_change, volume_usd
- `open_interest` (number)
- `index_price` (number)
- `best_bid_price` (number, nullable)
- `best_bid_amount` (number, nullable)
- `best_ask_price` (number, nullable)
- `best_ask_amount` (number, nullable)
- `min_price` (number)
- `max_price` (number)
- `mark_price` (number)
- `last_price` (number, nullable)
- `estimated_delivery_price` (number)

### Optional Fields

- `underlying_price` (number, options only)
- `underlying_index` (number, options only)
- `interest_rate` (number, options only)
- `bid_iv` (number, options only)
- `ask_iv` (number, options only)
- `mark_iv` (number, options only)
- `greeks` (object, options only): delta, gamma, rho, theta, vega
- `funding_8h` (number, perpetual only)
- `current_funding` (number, perpetual only)
- `interest_value` (number, perpetual only)
- `delivery_price` (number, when state=closed)
- `settlement_price` (number, when state=open)

## Example

```json
{
  "jsonrpc": "2.0",
  "id": 8106,
  "method": "public/ticker",
  "params": {
    "instrument_name": "BTC-PERPETUAL"
  }
}
```
