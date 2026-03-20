# Binance EAPI — WebSocket Streams Summary

Source: https://developers.binance.com/docs/derivatives/options-trading/websocket-market-streams

## Available Streams

| Stream | Name Format | Path | Update Speed | Description |
|---|---|---|---|---|
| Trade | `<symbol>@optionTrade` or `<underlying>@optionTrade` | `/public` | 50ms | Raw trade events |
| Index | `<symbol>@index` | `/market` | 1000ms | Underlying index price |
| Mark Price | `<underlying>@optionMarkPrice` | `/market` | 1000ms | Mark price + greeks + bid/ask for ALL options |
| Kline | `<symbol>@kline_<interval>` | `/market` | 1000ms | Candlestick data |
| 24h Ticker | `<symbol>@optionTicker` | `/market` | 1000ms | Per-symbol 24h stats |
| Ticker by Expiry | `<underlying>@ticker@<expirationDate>` | `/market` | 1000ms | 24h stats by underlying + expiry |
| Open Interest | `<underlying>@optionOpenInterest@<expirationDate>` | `/market` | 60s | OI per underlying+expiry |
| New Symbol | `option_pair` | `/market` | 50ms | New symbol listing |
| Partial Depth | `<symbol>@depth<levels>` | `/public` | 100ms/500ms/1000ms | Top bids/asks (10/20/50/100) |
| Diff Depth | `<symbol>@depth1000` | `/public` | 50ms | Incremental depth |

## Key Notes

- All symbols must be **lowercase** in stream names
- `<underlying>` format: `btcusdt` (not `btc` or `BTC-USD`)
- The most useful stream for an aggregator is `btcusdt@optionMarkPrice`:
  - Bulk data for ALL options on an underlying
  - Includes mark price, greeks, bid/ask, IV
  - 1000ms update frequency
- Max 200 streams per connection
- Connections auto-disconnect after 24 hours
