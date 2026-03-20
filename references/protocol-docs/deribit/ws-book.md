# book.(instrument_name).(interval) — WebSocket Subscription

> Source: https://docs.deribit.com/subscriptions/orderbook/bookinstrument_nameinterval

Real-time order book updates for a specific instrument.

## Overview

- The initial notification provides a complete snapshot of the order book (bids and asks across all price levels).
- Following notifications contain only incremental modifications to individual price levels.
- Updates use the format `[action, price, amount]`, where action is: `new`, `change`, or `delete`.

Each notification includes a `change_id`. Messages after the first also contain `prev_change_id`. When `prev_change_id` matches the prior message's `change_id`, no messages were skipped.

**Units:** Perpetuals and futures use USD units for `amount`. Options use cryptocurrency contracts (BTC or ETH).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instrument_name` | string | Yes | The name of the instrument |
| `interval` | string | Yes | Notification frequency: `raw` (authorized only), `100ms`, `agg2` |

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `instrument_name` | string | Unique instrument identifier |
| `change_id` | integer | Notification identifier |
| `prev_change_id` | integer | Previous notification ID (absent in first message) |
| `asks` | array | Sell-side price levels as `[action, price, amount]` tuples |
| `bids` | array | Buy-side price levels as `[action, price, amount]` tuples |
| `timestamp` | integer | Last change time (milliseconds since Unix epoch) |
| `type` | string | `snapshot` (initial) or `change` (subsequent updates) |

## Response Example

```json
{
  "data": {
    "type": "snapshot",
    "timestamp": 1554373962454,
    "instrument_name": "BTC-PERPETUAL",
    "change_id": 297217,
    "bids": [
      ["new", 5042.34, 30],
      ["new", 5041.94, 20]
    ],
    "asks": [
      ["new", 5042.64, 40],
      ["new", 5043.3, 40]
    ]
  }
}
```
