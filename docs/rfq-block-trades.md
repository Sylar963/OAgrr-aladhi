# RFQ & Block Trade API Research

> Tested & confirmed 2026-03-21 against live production APIs.
> All response samples are real data from that date.

## Summary

| Venue      | True RFQ API? | Multi-leg? | Public Trade Feed               | Best Fetch Method          | Tested? |
| ---------- | ------------- | ---------- | ------------------------------- | -------------------------- | ------- |
| **Deribit** | ✅ Yes        | ✅ Yes     | ✅ REST + WS                    | **WS** `block_rfq.trades.any` | ✅ REST+WS |
| **OKX**     | ✅ Yes        | ✅ Yes     | ✅ REST only (WS needs instId)  | **REST poll** every 30-60s | ✅ REST+WS |
| **Bybit**   | ✅ Yes        | ✅ 25 legs | ✅ WS only (REST needs auth)    | **WS** `rfq.open.public.trades` | ✅ WS sub |
| **Binance** | ❌ Bilateral  | ❌ 1 leg   | ✅ REST only                    | **REST poll** periodically | ✅ REST   |
| **Derive**  | ✅ Yes        | ✅ Yes     | ❌ All private                  | N/A                        | N/A     |

**What's public:** Only **completed** trades. Live RFQ negotiations (open requests,
competing quotes) are always private across all venues — by design, to prevent
front-running.

---

## Deribit — Block RFQ

Legacy RFQ endpoints were removed 2025-10-07. Everything is now "Block RFQ".

### Public Endpoints (no auth)

#### `public/get_block_rfq_trades`

REST (JSON-RPC). Returns completed block RFQ trades with full leg detail.

```
GET https://www.deribit.com/api/v2/public/get_block_rfq_trades?currency=BTC&count=10
```

| Param      | Type   | Required | Notes                          |
| ---------- | ------ | -------- | ------------------------------ |
| `currency` | string | No       | `BTC`, `ETH`, or omit for all  |
| `count`    | int    | No       | Range [10, 50]                 |

Response shape:
```jsonc
{
  "result": {
    "continuation": "1774084966786:38581",  // pagination cursor
    "block_rfqs": [
      {
        "id": 38594,
        "timestamp": 1774094179284,         // unix ms
        "amount": 50.0,                      // trade size
        "direction": "sell",                 // taker direction
        "mark_price": 0.051568398,           // mark at time of trade
        "trades": [{
          "price": 0.051,                    // executed price (BTC-denominated fraction)
          "amount": 50.0,
          "direction": "sell"
        }],
        "legs": [
          {
            "price": 0.0301,
            "direction": "buy",
            "instrument_name": "BTC-27MAR26-70000-C",
            "ratio": 1
          },
          {
            "price": 0.0209,
            "direction": "buy",
            "instrument_name": "BTC-27MAR26-70000-P",
            "ratio": 1
          }
        ],
        "combo_id": "BTC-STRD-27MAR26-70000",  // null for custom structures
        "index_prices": { "btc_usd": 70607.11 }
      }
    ]
  }
}
```

Key fields:
- `legs[].instrument_name` — standard Deribit option name (e.g. `BTC-27MAR26-70000-C`)
- `legs[].ratio` — leg multiplier (>1 for ratio spreads)
- `combo_id` — named strategy like `BTC-STRD-27MAR26-70000` or `null` for custom
- Prices are BTC/ETH-denominated fractions (multiply by index price for USD)

#### WebSocket: `block_rfq.trades.{currency}` ✅ VERIFIED LIVE

URL: `wss://www.deribit.com/ws/api/v2`

```jsonc
{
  "jsonrpc": "2.0",
  "method": "public/subscribe",
  "params": { "channels": ["block_rfq.trades.any"] },
  "id": 1
}
```

Subscription response: `["block_rfq.trades.any"]` — confirmed working.
Use `.any` for all currencies, or `.BTC` / `.ETH` for specific.
Same payload shape as REST, pushed in real-time on trade execution.

#### Pagination (REST)

Supports cursor-based pagination via `continuation` field.
Tested 8 pages deep (354 trades total going back ~6 days).
Pass `continuation` value from previous response to get older trades.

### Private Endpoints (auth required, not for us)

| Method                             | Role  | Purpose                    |
| ---------------------------------- | ----- | -------------------------- |
| `private/create_block_rfq`         | Taker | Create RFQ                 |
| `private/accept_block_rfq`         | Taker | Execute trade              |
| `private/get_block_rfqs`           | Both  | List RFQs                  |
| `private/get_block_rfq_quotes`     | Taker | View quotes for an RFQ     |
| `private/add_block_rfq_quote`      | Maker | Submit quote               |
| `private/edit_block_rfq_quote`     | Maker | Modify quote               |
| `private/cancel_block_rfq_quote`   | Maker | Cancel quote               |
| `private/cancel_all_block_rfq_quotes` | Maker | Bulk cancel             |

Scopes: `block_rfq:read`, `block_rfq:read_write`

**Official docs:** https://docs.deribit.com/articles/block-rfq-api-walkthrough

---

## OKX — Block Trading (Liquid Marketplace)

### Public Endpoints (no auth)

#### `GET /api/v5/rfq/public-trades`

Returns completed block trades with full multi-leg detail including named strategy.

```
GET https://www.okx.com/api/v5/rfq/public-trades
```

No required params. Returns 100 recent trades (fixed rolling window, no deep pagination).
Supports `limit` param (tested: `?limit=5` works).

⚠️ **No working pagination:** `before`/`after` params with `blockTdId` do not return
older data — always returns the same most recent window. Must poll and store locally
for history.

Response shape:
```jsonc
{
  "code": "0",
  "data": [
    {
      "blockTdId": "3410042614182285312",
      "legs": [
        {
          "instId": "BTC-USD-260529-66000-P",
          "side": "sell",
          "sz": "100",                       // contracts
          "px": "0.0577",                    // BTC-denominated
          "tradeId": "3410042614165508098"
        },
        {
          "instId": "BTC-USD-260925-60000-P",
          "side": "buy",
          "sz": "100",
          "px": "0.0771",
          "tradeId": "3410042614165508099"
        }
      ],
      "strategy": "PUT_DIAGONAL",            // named strategy
      "inverse": false,                      // true = inverse contract
      "cTime": "1774129589348"               // unix ms
    }
  ]
}
```

Observed `strategy` values from live data:
`CALL`, `PUT`, `STRADDLE`, `STRANGLE`, `CALL_SPREAD`, `PUT_SPREAD`,
`CALL_CALENDAR_SPREAD`, `PUT_CALENDAR_SPREAD`, `CALL_DIAGONAL`, `PUT_DIAGONAL`,
`CALL_RATIO`, `PUT_RATIO`, `IRON_CONDOR`, `IRON_BUTTERFLY`,
`CALL_BUTTERFLY_SPREAD`, `CUSTOM`

#### WebSocket: `public-block-trades` ⚠️ REQUIRES instId

Business WS: `wss://ws.okx.com:8443/ws/v5/business`

```jsonc
// ❌ This does NOT work (tested — returns error 60018):
{ "op": "subscribe", "args": [{ "channel": "public-block-trades" }] }
{ "op": "subscribe", "args": [{ "channel": "public-block-trades", "instType": "OPTION" }] }
{ "op": "subscribe", "args": [{ "channel": "public-block-trades", "instFamily": "BTC-USD" }] }

// ✅ This WORKS — but requires specific instId:
{ "op": "subscribe", "args": [{ "channel": "public-block-trades", "instId": "BTC-USD-260327-70000-C" }] }
```

WS response (verified):
```jsonc
{
  "arg": { "channel": "public-block-trades", "instId": "BTC-USD-260327-70000-C" },
  "data": [{
    "instId": "BTC-USD-260327-70000-C",
    "px": "0.0329", "sz": "330", "side": "sell",
    "tradeId": "3409136535080505346",
    "ts": "1774102586087",
    "fillVol": "0.4986662292480468",
    "fwdPx": "71056.55673062222",
    "idxPx": "71007.8",
    "markPx": "0.0331682717904517"
  }]
}
```

**Verdict:** WS is impractical for a block trade feed — would need to subscribe to
every active option instrument. **Use REST polling instead.**

### Volume & OI Stats (Rubik — no auth)

| Endpoint                                              | Returns                                |
| ----------------------------------------------------- | -------------------------------------- |
| `GET /api/v5/rubik/stat/option/open-interest-volume`  | `[timestamp, oi, volume]` arrays       |
| `GET /api/v5/rubik/stat/option/open-interest-volume-expiry` | OI + volume grouped by expiry    |
| `GET /api/v5/rubik/stat/option/open-interest-volume-strike` | OI + volume grouped by strike    |

Param: `ccy=BTC` (required). `expTime=20260327` for strike breakdown.

Rubik response (OI + volume):
```jsonc
// [timestamp, openInterest, volume]
["1774108800000", "40679.25", "1399.87"]
```

Rubik by expiry:
```jsonc
// [ts, expiry, callOI, putOI, callVol, putVol]
["1774108800000", "20260322", "903.96", "1069.24", "222.57", "329.68"]
```

### Private Endpoints (auth required, not for us)

| Endpoint                           | Role  | Purpose            |
| ---------------------------------- | ----- | ------------------ |
| `POST /api/v5/block/rfqs`         | Taker | Create RFQ         |
| `GET /api/v5/block/rfqs`          | Both  | List RFQs          |
| `POST /api/v5/block/create-quote` | Maker | Submit quote       |
| `GET /api/v5/block/quotes`        | Taker | Get quotes         |
| `POST /api/v5/block/execute-quote`| Taker | Accept quote       |
| `POST /api/v5/block/cancel-rfq`   | Taker | Cancel RFQ         |

**Official docs:** https://www.okx.com/docs-v5/en/#block-trading

---

## Bybit — V5 RFQ

### Public Data

**⚠️ No public REST endpoint for block trades confirmed.** The `/v5/rfq/public-trades`
endpoint returned `apiKey is missing` — it requires authentication despite the name.

The regular trade endpoint (`/v5/market/recent-trade?category=option`) includes an
`isBlockTrade` boolean flag, but in testing no block trades appeared in the recent
100 trades sampled. Block trades may be infrequent or filtered.

#### WebSocket: `rfq.open.public.trades`

This is a **public** WebSocket topic (no auth) per Bybit's official docs. We have not
been able to verify the payload shape via REST, but Bybit docs confirm it pushes
completed block trade data.

WS subscription confirmed working (tested live):
```jsonc
// URL: wss://stream.bybit.com/v5/public/option
{ "op": "subscribe", "args": ["rfq.open.public.trades"] }
// Response: { "success": true, "data": { "successTopics": ["rfq.open.public.trades"] } }
```

No block trades observed during the ~8s test window (trades are infrequent).
Payload shape not yet captured — needs longer-running listener.

#### REST Fallback: `isBlockTrade` flag on regular trades

Regular trade response includes `isBlockTrade` flag:
```jsonc
{
  "result": {
    "category": "option",
    "list": [{
      "symbol": "BTC-22MAR26-70500-C-USDT",
      "price": "145",
      "size": "0.04",
      "side": "Sell",
      "time": "1774132287299",
      "isBlockTrade": false,
      "mP": "134.42681967",        // mark price
      "iP": "70270.46040726",      // index price
      "mIv": "0.2497",             // mark IV
      "iv": "0.262"                // trade IV
    }]
  }
}
```

### Private Endpoints (auth required, not for us)

| Endpoint                     | Role  | Purpose            |
| ---------------------------- | ----- | ------------------ |
| `POST /v5/rfq/create-rfq`   | Taker | Create RFQ         |
| `POST /v5/rfq/execute-quote` | Taker | Accept quote      |
| `POST /v5/rfq/cancel-rfq`   | Taker | Cancel RFQ         |
| `GET /v5/rfq/config`         | Both  | LP list & limits   |
| `POST /v5/rfq/create-quote` | Maker | Submit quote       |
| `POST /v5/rfq/cancel-quote` | Maker | Cancel quote       |

Constraints: min 100× regular orderbook size, min $10K notional, up to 25 legs,
quotes expire in ~60s.

**Official docs:** https://bybit-exchange.github.io/docs/v5/rfq/basic-workflow

---

## Binance — Block Trade (Bilateral, NOT true RFQ)

Binance has block trades under the European Options (`eapi`) API, but it is
**not a true RFQ system**:
- Single-leg only (`Max 1` per docs)
- No quote solicitation — maker creates order → gets `blockTradeSettlementKey` →
  shares out-of-band → taker accepts with that key
- No maker discovery or competing quotes

### Public Endpoint (no auth)

#### `GET /eapi/v1/blockTrades`

```
GET https://eapi.binance.com/eapi/v1/blockTrades?limit=5
```

| Param    | Type   | Required | Notes                      |
| -------- | ------ | -------- | -------------------------- |
| `symbol` | string | No       | e.g. `BTC-260323-66000-P`  |
| `limit`  | int    | No       | Default 100, max 500       |

Response shape:
```jsonc
[
  {
    "id": 2422936690928084545,
    "tradeId": 33,
    "symbol": "BTC-260323-66000-P",
    "price": "30",             // USD price
    "qty": "2",                // contracts
    "quoteQty": "60",          // price × qty
    "side": 1,                 // 1 = buy, -1 = sell
    "time": 1774115517340      // unix ms
  }
]
```

**Note:** Unlike Deribit/OKX, Binance block trade data is single-leg only —
no multi-leg strategy info, no strategy name, no leg breakdown. Each entry
is one instrument.

### Private Endpoints (auth required)

| Endpoint                          | Method | Purpose              |
| --------------------------------- | ------ | -------------------- |
| `/eapi/v1/block/order/create`     | POST   | Create block trade   |
| `/eapi/v1/block/order/execute`    | POST   | Accept block trade   |
| `/eapi/v1/block/order/create`     | DELETE | Cancel block trade   |
| `/eapi/v1/block/order/create`     | PUT    | Extend expiry +30min |
| `/eapi/v1/block/order/orders`     | GET    | Query status         |

**Official docs:** https://developers.binance.com/docs/derivatives/options-trading/market-maker-block-trade

---

## Derive — RFQ (All Private)

Derive has the richest RFQ API (REST + WS + JS/Python/Rust guides), but **all
endpoints are private** — authentication via Ethereum-signed headers required.

No public block trade feed exists.

### Private Endpoints

| Endpoint                        | Role  | Purpose              |
| ------------------------------- | ----- | -------------------- |
| `POST /private/send_rfq`       | Taker | Create RFQ           |
| `POST /private/get_rfqs`       | Both  | List RFQs            |
| `POST /private/poll_rfqs`      | Both  | Poll for updates     |
| `POST /private/cancel_rfq`     | Taker | Cancel RFQ           |
| `POST /private/send_quote`     | Maker | Submit quote         |
| `POST /private/replace_quote`  | Maker | Modify quote         |
| `POST /private/get_quotes`     | Both  | Get quotes           |
| `POST /private/poll_quotes`    | Both  | Poll quotes          |
| `POST /private/execute_quote`  | Taker | Accept quote         |
| `POST /private/rfq_get_best_quote` | Taker | Best available quote |

WS channels: `{wallet}.rfqs` (private), `{subaccount_id}.quotes` (private)

Auth: `X-LyraWallet`, `X-LyraTimestamp`, `X-LyraSignature` (Ethereum signing)

**Official docs:** https://docs.derive.xyz/reference/post_private-send-rfq

---

## Volume & Historical Data Endpoints

All venues have public 24h volume. Summary of what's available for charting:

| Venue      | 24h Ticker                                     | Historical Klines        | Open Interest              |
| ---------- | ---------------------------------------------- | ------------------------ | -------------------------- |
| **Deribit** | `public/get_book_summary_by_currency`          | `public/get_tradingview_chart_data` | In book summary (`open_interest`) |
| **OKX**     | `GET /api/v5/market/tickers?instType=OPTION`   | Rubik endpoints (aggregated) | `GET /api/v5/public/open-interest` |
| **Bybit**   | `GET /v5/market/tickers?category=option`       | `GET /v5/market/kline`   | In ticker (`openInterest`) |
| **Binance** | `GET /eapi/v1/ticker`                          | `GET /eapi/v1/klines`    | `GET /eapi/v1/openInterest` |
| **Derive**  | `POST /public/get_ticker`                      | Trade history aggregation | In ticker (`open_interest`) |

### Deribit Book Summary (tested)
```jsonc
{
  "instrument_name": "BTC-25DEC26-100000-C",
  "volume": 1.2,              // 24h contracts
  "volume_usd": 5588.73,      // 24h USD
  "open_interest": 3002.3,
  "mark_price": 0.06653255,
  "mark_iv": 50.01,
  "bid_price": 0.0655,
  "ask_price": 0.0675,
  "underlying_price": 72060.8
}
```

### OKX Rubik OI+Volume (tested)
```jsonc
// open-interest-volume: [timestamp, oi, volume]
["1774108800000", "40679.25", "1399.87"]

// by-expiry: [ts, expiry, callOI, putOI, callVol, putVol]
["1774108800000", "20260322", "903.96", "1069.24", "222.57", "329.68"]

// by-strike: [ts, strike, callOI, putOI, callVol, putVol]
["1774108800000", "30000", "50.51", "299.18", "0", "0"]
```

### Binance Klines (confirmed from docs)
```jsonc
[
  [
    1762779600000,    // open time
    "1300.000",       // open
    "1300.000",       // high
    "1300.000",       // low
    "1300.000",       // close
    "0.1000",         // volume (contracts)
    1762780499999,    // close time
    "130.0000000",    // quote asset volume (USD)
    1,                // number of trades
    "0.1000",         // taker buy base volume
    "130.0000000",    // taker buy quote volume
    "0"               // ignore
  ]
]
```

---

## Integration Priority & How to Fetch

For a "Block Trade / Institutional Flow" feed:

### 1. Deribit — WS (recommended)
**Best approach:** Subscribe to `block_rfq.trades.any` via WS. Real-time, all
currencies, no auth. Richest data: leg ratios, combo IDs, mark prices, index prices.
REST for backfill (paginated, ~6 days of history, 50/page).

### 2. OKX — REST polling (required)
**Best approach:** Poll `GET /api/v5/rfq/public-trades` every 30-60s. Deduplicate
by `blockTdId`. Best strategy labeling (IRON_CONDOR, STRADDLE, etc.). WS exists
but requires per-instrument subscription — impractical.
⚠️ No pagination. Rolling window of 100 trades. Must poll & store for history.

### 3. Bybit — WS (recommended)
**Best approach:** Subscribe to `rfq.open.public.trades` via WS. Subscription
confirmed working. No REST alternative without auth.

### 4. Binance — REST polling
**Best approach:** Poll `GET /eapi/v1/blockTrades` periodically. Simple data
(single-leg only, no strategies). 500 trades go back ~80 days (low activity).
Supports filter by `symbol`. Covers BTC, ETH, SOL, BNB, XRP.

### 5. Derive — Skip
All RFQ data requires Ethereum-signed authentication. No public feed.
