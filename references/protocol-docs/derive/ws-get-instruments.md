# Derive — public/get_instruments (WS RPC)

Source: https://docs.derive.xyz/reference/public-get_instruments

## Method

`public/get_instruments` (JSON-RPC over WebSocket)

## Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "public/get_instruments",
  "params": {
    "currency": "BTC",
    "instrument_type": "option",
    "expired": false
  }
}
```

## Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| currency | String | Yes | `BTC`, `ETH`, `SOL` |
| instrument_type | String | Yes | `option`, `perp`, `erc20` |
| expired | Boolean | Yes | `false` to get active instruments |

## Response

Returns an **array directly** (not `{ instruments: [...] }`):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    {
      "instrument_type": "option",
      "instrument_name": "BTC-20260327-84000-P",
      "scheduled_activation": 1751014800,
      "scheduled_deactivation": 1774598340,
      "is_active": true,
      "tick_size": "1",
      "minimum_amount": "0.01",
      "maximum_amount": "1000",
      "amount_step": "0.00001",
      "mark_price_fee_rate_cap": "0.125",
      "maker_fee_rate": "0.0003",
      "taker_fee_rate": "0.0003",
      "option_details": {
        "expiry": 1774598400,
        "index": "BTC-USD",
        "option_type": "P",
        "strike": "84000",
        "settlement_price": null
      },
      "quote_currency": "USDC"
    }
  ]
}
```

## Key Fields

| Field | Description |
|---|---|
| `instrument_name` | e.g. `BTC-20260328-60000-C` (YYYYMMDD format) |
| `instrument_type` | `option`, `perp`, `erc20` |
| `option_details.expiry` | Unix timestamp in **seconds** (not ms!) |
| `option_details.option_type` | `C` or `P` |
| `option_details.strike` | Strike price as string |
| `quote_currency` | Always `USDC` for options |

## CRITICAL NOTES

- **`get_all_instruments` caps at 100 results** — only returns SOL options
- **MUST use `get_instruments` per currency** (BTC, ETH, SOL separately)
- Instrument name format: `BTC-YYYYMMDD-STRIKE-C/P` (8-digit date, not 6-digit like Binance/OKX)
- Expiry is in **seconds**, not milliseconds
