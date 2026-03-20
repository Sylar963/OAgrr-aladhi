# markprice.options.(index_name) — WebSocket Subscription

> Source: https://docs.deribit.com/subscriptions/market-data/markpriceoptionsindex_name

Options mark price updates for the given `index_name`. Enables real-time valuation, risk monitoring, and P&L calculations for options contracts.

## Parameters

### index_name (Required)

A string parameter identifying the index pair (base cryptocurrency with quote currency).

**Supported Values (47 total):**
`btc_usd`, `eth_usd`, `ada_usdc`, `algo_usdc`, `avax_usdc`, `bch_usdc`, `bnb_usdc`, `btc_usdc`, `btcdvol_usdc`, `buidl_usdc`, `doge_usdc`, `dot_usdc`, `eurr_usdc`, `eth_usdc`, `ethdvol_usdc`, `link_usdc`, `ltc_usdc`, `near_usdc`, `paxg_usdc`, `shib_usdc`, `sol_usdc`, `steth_usdc`, `ton_usdc`, `trump_usdc`, `trx_usdc`, `uni_usdc`, `usde_usdc`, `usyc_usdc`, `xrp_usdc`, `btc_usdt`, `eth_usdt`, `eurr_usdt`, `sol_usdt`, `steth_usdt`, `usdc_usdt`, `usde_usdt`, `btc_eurr`, `btc_usde`, `btc_usyc`, `eth_btc`, `eth_eurr`, `eth_usde`, `eth_usyc`, `steth_eth`, `paxg_btc`, `drbfix-btc_usdc`, `drbfix-eth_usdc`

## Subscription Request

```json
{
  "jsonrpc": "2.0",
  "method": "public/subscribe",
  "id": 42,
  "params": {
    "channels": [
      "markprice.options.btc_usd"
    ]
  }
}
```

## Response Data Structure

Server notifications contain an array of mark price updates:

| Field | Type | Description |
|-------|------|-------------|
| `instrument_name` | string | Unique instrument identifier (e.g., "BTC-2JUN21-37000-P") |
| `mark_price` | number | The calculated mark price for the instrument |
| `iv` | number | Implied volatility of the underlying instrument |
| `timestamp` | integer | Unix epoch timestamp in milliseconds |

## Example Response

```json
{
  "data": [
    {
      "timestamp": 1622470378005,
      "mark_price": 0.0333,
      "iv": 0.9,
      "instrument_name": "BTC-2JUN21-37000-P"
    },
    {
      "timestamp": 1622470378005,
      "mark_price": 0.117,
      "iv": 0.9,
      "instrument_name": "BTC-4JUN21-40500-P"
    }
  ]
}
```
