# Derive — public/get_tickers (WS RPC)

Source: https://docs.derive.xyz/reference/public-get_tickers

## Method

`public/get_tickers` (JSON-RPC over WebSocket)

## Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "public/get_tickers",
  "params": {
    "instrument_type": "option",
    "currency": "BTC",
    "expiry_date": "20260327"
  }
}
```

## Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| instrument_type | String | Yes | `option` |
| currency | String | Yes | `BTC`, `ETH`, `SOL` |
| expiry_date | String | **Yes for options** | Format: `YYYYMMDD` (e.g. `20260327`) |

⚠️ **`expiry_date` is REQUIRED for options** — omitting it returns error:
`"Expiry date is required for options"`

⚠️ **Format must be `YYYYMMDD`** — other formats return:
`"Expiry date must be in the format YYYYMMDD"`

## Response

Returns `{ tickers: { "INST_NAME": { ... }, ... } }` — a **dict keyed by instrument name**:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tickers": {
      "BTC-20260327-155000-P": {
        "t": 1773963675269,
        "A": "0",
        "a": "0",
        "B": "0",
        "b": "0",
        "f": null,
        "option_pricing": {
          "d": "-0.99999",
          "t": "0",
          "g": "0",
          "v": "0",
          "i": "0.70527",
          "r": "1716.27839",
          "f": "69727",
          "m": "85272",
          "df": "1",
          "bi": "0",
          "ai": "0"
        },
        "I": "69739",
        "M": "85272",
        "stats": {
          "c": "0",
          "v": "0",
          "pr": "0",
          "n": 0,
          "oi": "0",
          "h": "0",
          "l": "0",
          "p": "0"
        },
        "minp": "82263",
        "maxp": "87954"
      }
    }
  }
}
```

## Abbreviated Field Mapping

### Top-level ticker fields
| Key | Full Name | Description |
|---|---|---|
| `t` | timestamp | Unix ms |
| `B` | best_bid_price | Best bid |
| `b` | best_bid_amount | Bid size |
| `A` | best_ask_price | Best ask |
| `a` | best_ask_amount | Ask size |
| `I` | index_price | Index/underlying price |
| `M` | mark_price | Mark price |
| `f` | funding_rate | Funding (null for options) |

### option_pricing fields
| Key | Full Name | Description |
|---|---|---|
| `d` | delta | Delta |
| `g` | gamma | Gamma |
| `t` | theta | Theta |
| `v` | vega | Vega |
| `i` | iv | Implied volatility |
| `r` | rho | Rho |
| `f` | forward_price | Forward price |
| `m` | mark_price | Mark price (option) |
| `df` | discount_factor | Discount factor |
| `bi` | bid_iv | Bid implied volatility |
| `ai` | ask_iv | Ask implied volatility |

### stats fields
| Key | Full Name | Description |
|---|---|---|
| `oi` | open_interest | Open interest |
| `v` | volume | 24h volume |
| `c` | change | 24h change |

## Notes

- Must call per-expiry — no bulk "all options" call available
- Dict response keyed by instrument name, not an array
- All values are strings (except `stats.n` which is a number)
