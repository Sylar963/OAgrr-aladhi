# ticker.(instrument_name).(interval) — WebSocket Subscription

> Source: https://docs.deribit.com/subscriptions/market-data/tickerinstrument_nameinterval

Real-time ticker data providing comprehensive market information for specified instruments via WebSocket subscription.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instrument_name` | string | Yes | Unique instrument identifier |
| `interval` | string | Yes | Update frequency: `raw` (authorized only), `100ms`, `agg2` (2 seconds) |

## Response Data Structure

### Core Fields

- **instrument_name** (string): Unique instrument identifier
- **timestamp** (integer): Milliseconds since Unix epoch
- **state** (string): Order book lifecycle state (open, settlement, delivered, inactive, locked, halted, archivized)

### Price Data

- **best_bid_price** (number): Current best bid price or null
- **best_bid_amount** (number): Requested order size of all best bids
- **best_ask_price** (number): Current best ask price or null
- **best_ask_amount** (number): Requested order size of all best asks
- **last_price** (number): Price of last trade
- **mark_price** (number): Mark price for the instrument
- **index_price** (number): Current index price
- **settlement_price** (number): Settlement price when state is open (optional)
- **delivery_price** (number): Settlement price when state is closed
- **estimated_delivery_price** (number): Estimated delivery price for the market

### Market Statistics

- **stats** (object):
  - **volume** (number): 24-hour volume in base currency
  - **high** (number): Highest price during 24 hours
  - **low** (number): Lowest price during 24 hours
  - **price_change** (number): 24-hour percentage change (null if no trades)
  - **volume_usd** (number): Volume in USD (futures only)

### Additional Fields

- **open_interest** (number): Outstanding contracts in corresponding units
- **min_price** (number): Minimum price for order placement
- **max_price** (number): Maximum price for order placement

### Options-Specific Data

- **underlying_price** (number): Underlying price for IV calculations
- **underlying_index** (number): Name of underlying future or index_price
- **interest_rate** (number): Interest rate for IV calculations
- **bid_iv** (number): Implied volatility for best bid
- **ask_iv** (number): Implied volatility for best ask
- **mark_iv** (number): Implied volatility for mark price

### Greeks (Options Only)

- **greeks** (object):
  - **delta** (number): Black Scholes Delta
  - **gamma** (number): Rate of change of delta
  - **theta** (number): Minimum of (1 day Theta, lifetime theta)
  - **vega** (number): Sensitivity to implied volatility changes
  - **rho** (number): Sensitivity to interest rate changes

### Perpetual-Specific Data

- **current_funding** (number): Current funding rate
- **funding_8h** (number): 8-hour funding rate
- **interest_value** (number): Value used to calculate realized_funding

## Servers

- **Production**: wss://deribit.com/ws/api/v2
- **Testnet**: wss://test.deribit.com/ws/api/v2

## Example Subscription Request

```json
{
  "jsonrpc": "2.0",
  "method": "public/subscribe",
  "id": 42,
  "params": {
    "channels": ["ticker.BTC-PERPETUAL.100ms"]
  }
}
```

## Example Response

```json
{
  "data": {
    "best_ask_amount": 100,
    "best_ask_price": 36443,
    "best_bid_amount": 5000,
    "best_bid_price": 36442.5,
    "current_funding": 0,
    "estimated_delivery_price": 36441.64,
    "funding_8h": 0.0000211,
    "index_price": 36441.64,
    "instrument_name": "BTC-PERPETUAL",
    "interest_value": 1.7362511643080387,
    "last_price": 36457.5,
    "mark_price": 36446.51,
    "max_price": 36991.72,
    "min_price": 35898.37,
    "open_interest": 502097590,
    "settlement_price": 36169.49,
    "state": "open",
    "stats": {
      "high": 36824.5,
      "low": 35213.5,
      "price_change": 0.7229,
      "volume": 7871.02139035,
      "volume_usd": 284061480
    },
    "timestamp": 1623060194301
  }
}
```

## State Lifecycle Meanings

- **open**: Default running state accepting orders, edits, and cancels
- **settlement**: During settlement/delivery; no new orders accepted; GTD orders canceled
- **delivered**: Final delivered state; all open orders canceled; eventually archived
- **inactive**: Deactivated state; no orders accepted; all open orders canceled
- **locked**: New orders and edits blocked; cancels accepted; settlement possible
- **halted**: Error state; settlement impossible
- **archivized**: Expired instrument final state
