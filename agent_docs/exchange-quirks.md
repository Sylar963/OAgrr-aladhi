# Exchange Quirks

## Gotchas — read these first

- **Derive sends ALL values as strings**: `"B": "25.72862"`, not `25.72862`. The Zod schema types them as `z.string()`. `safeNum()` coerces to number downstream. If you add a new Derive field, type it as string.

- **Deribit decimal strikes**: Strike `420.5` is encoded as `420d5` in instrument names. The regex handles `\d+(?:d\d+)?` and converts `d` → `.`. If you see a parse failure on a Deribit instrument, check for this.

- **Deribit `creation_timestamp` is NOT quote time**: It's when the instrument was listed. Use `Date.now()` for quote timestamps from book summaries.

- **Bybit requires application-level JSON pings**: Send `{"op": "ping"}` every 20 seconds. Bybit does NOT use WS-level ping frames — `ws.on('ping')` will never fire. Without JSON pings, the server drops the connection after ~30 seconds.

- **Bybit REST vs WS field names differ**: REST uses `bid1Price`/`ask1Price`/`markIv`. WS uses `bidPrice`/`askPrice`/`markPriceIv`. Two separate Zod schemas handle this (`BybitRestTickerSchema` vs `BybitWsTickerSchema`).

- **Binance mark price fields are strings**: `"mp": "770.543"`, `"d": "-0.456"`. Even the event timestamp `E` is the only numeric field. Schema uses `z.string()` for all price/greek fields.

- **OKX has no mark price in opt-summary**: The `opt-summary` channel provides greeks and IV but NOT mark price. `fwdPx` (forward price) serves as the underlying/index price proxy.

- **OKX sends greeks in two forms**: `delta` (coin-denominated) and `deltaBS` (USD-denominated/Black-Scholes). We prefer `deltaBS` and fall back to `delta`. Same for gamma, theta, vega.

- **Derive `get_all_instruments` caps at 100**: Only returns SOL options. Must use `get_instruments` per currency (BTC, ETH, SOL separately).

- **Derive API is slow**: Use 30-45s timeouts. Fetching tickers for all expiries takes ~13 seconds.

- **Derive subscribe method is `subscribe`**: NOT `public/subscribe` like Deribit. Using the wrong method returns error code -32601.

- **Derive has no heartbeat**: Unlike Deribit's `public/set_heartbeat` + `test_request` pattern, Derive relies on WS-level ping/pong only.

## Inverse vs linear pricing

| Venue | BTC/ETH | Other |
|-------|---------|-------|
| Deribit | Inverse (premiums in BTC/ETH, multiply by underlying for USD) | Linear (USDC/USDT) |
| OKX | Inverse (same as Deribit) | — |
| Binance | — | Linear (USDT) |
| Bybit | — | Linear (USDT) |
| Derive | — | Linear (USDC) |

## Rate limits that matter

- **Deribit subscribe**: 3,000 credits per call, 30,000 max pool → burst of 10, sustain ~3.3/sec. We batch ticker subs in groups of 10 with 300ms delay.
- **Deribit get_instruments**: 10,000 credits, sustain 1/sec. We call once with `currency: 'any'`.
- **Bybit WS**: Max 2,000 topics per connection. We batch 200/call.
