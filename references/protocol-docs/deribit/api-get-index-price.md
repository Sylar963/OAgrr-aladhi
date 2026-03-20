# public/get_index_price

> Source: https://docs.deribit.com/api-reference/market-data/public-get_index_price

Retrieves the current index price for a specified index name. Index prices are used as reference prices for mark price calculations and settlement.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `index_name` | string | Yes | Index identifier (e.g., btc_usd, eth_usd) |

### Supported Index Names (47 total)

btc_usd, eth_usd, ada_usdc, algo_usdc, avax_usdc, bch_usdc, bnb_usdc, btc_usdc, btcdvol_usdc, buidl_usdc, doge_usdc, dot_usdc, eurr_usdc, eth_usdc, ethdvol_usdc, link_usdc, ltc_usdc, near_usdc, paxg_usdc, shib_usdc, sol_usdc, steth_usdc, ton_usdc, trump_usdc, trx_usdc, uni_usdc, usde_usdc, usyc_usdc, xrp_usdc, btc_usdt, eth_usdt, eurr_usdt, sol_usdt, steth_usdt, usdc_usdt, usde_usdt, btc_eurr, btc_usde, btc_usyc, eth_btc, eth_eurr, eth_usde, eth_usyc, steth_eth, paxg_btc, drbfix-btc_usdc, drbfix-eth_usdc

## Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "index_price": 11628.81,
    "estimated_delivery_price": 11628.81
  }
}
```
