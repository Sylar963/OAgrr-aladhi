# public/get_instruments

> Source: https://docs.deribit.com/api-reference/market-data/public-get_instruments

Retrieves available trading instruments on Deribit.

## Rate Limiting

Sustained rate: 1 request/second. Cost: 10,000 credits out of 500,000 max.

## Parameters

| Name | Required | Type | Description |
|------|----------|------|-------------|
| `currency` | Yes | string | BTC, ETH, USDC, USDT, EURR, or `"any"` |
| `kind` | No | string | future, option, spot, future_combo, option_combo |
| `expired` | No | boolean | `true` to retrieve recently expired instruments |

## Response Fields (instrument object)

| Field | Type | Description |
|-------|------|-------------|
| `kind` | string | Instrument kind |
| `settlement_currency` | string | BTC or ETH (optional, not for spot) |
| `counter_currency` | string | USD or USDC |
| `base_currency` | string | BTC or ETH |
| `quote_currency` | string | USD |
| `min_trade_amount` | number | Minimum trading amount |
| `instrument_name` | string | Unique identifier (e.g., BTC-PERPETUAL) |
| `instrument_id` | integer | Integer ID |
| `is_active` | boolean | Whether tradeable |
| `settlement_period` | string | month, week, or perpetual (optional) |
| `creation_timestamp` | integer | Milliseconds since UNIX epoch |
| `tick_size` | number | Minimal price change |
| `tick_size_steps` | array | Array of tick size step objects |
| `expiration_timestamp` | integer | Milliseconds since UNIX epoch |
| `strike` | number | Strike value (options only) |
| `option_type` | string | call or put (options only) |
| `future_type` | string | linear or reversed (deprecated) |
| `instrument_type` | string | linear or reversed |
| `contract_size` | integer | Contract size |
| `maker_commission` | number | e.g., 0.0001 |
| `taker_commission` | number | e.g., 0.0005 |
| `max_liquidation_commission` | number | Futures only |
| `block_trade_commission` | number | |
| `block_trade_tick_size` | number | |
| `block_trade_min_trade_amount` | number | |
| `max_leverage` | integer | Futures only |
| `price_index` | string | Name of price index (e.g., btc_usdc) |
| `state` | string | open, settlement, delivered, inactive, locked, halted, archivized |

## Example Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "public/get_instruments",
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
  "id": 1,
  "result": [
    {
      "tick_size": 2.5,
      "tick_size_steps": [],
      "taker_commission": 0.0005,
      "settlement_period": "month",
      "settlement_currency": "BTC",
      "quote_currency": "USD",
      "price_index": "btc_usd",
      "min_trade_amount": 10,
      "max_liquidation_commission": 0.0075,
      "max_leverage": 50,
      "maker_commission": 0,
      "kind": "future",
      "is_active": true,
      "instrument_name": "BTC-29SEP23",
      "instrument_id": 138583,
      "instrument_type": "reversed",
      "expiration_timestamp": 1695974400000,
      "creation_timestamp": 1664524802000,
      "counter_currency": "USD",
      "contract_size": 10,
      "block_trade_tick_size": 0.01,
      "block_trade_min_trade_amount": 200000,
      "block_trade_commission": 0.00025,
      "base_currency": "BTC",
      "state": "open"
    }
  ]
}
```
