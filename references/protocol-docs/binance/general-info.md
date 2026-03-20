# Binance European Options (EAPI) — General Info

Source: https://developers.binance.com/docs/derivatives/options-trading/general-info

## Base Endpoints

| Environment | REST | WebSocket (Public) | WebSocket (Market) | WebSocket (Private) |
|---|---|---|---|---|
| Production | `https://eapi.binance.com` | `wss://fstream.binance.com/public/` | `wss://fstream.binance.com/market/` | `wss://fstream.binance.com/private/` |
| Testnet | `https://testnet.binancefuture.com` | `wss://fstream.binancefuture.com/public/` | `wss://fstream.binancefuture.com/market/` | `wss://fstream.binancefuture.com/private/` |

## Settlement

- All options are **USDT-settled** (linear)
- Quote asset: USDT
- No inverse conversion needed

## Rate Limits

- IP-based rate limiting
- `X-MBX-USED-WEIGHT-(intervalNum)(intervalLetter)` response header shows current usage
- 429 = rate limited, 418 = IP auto-banned
- Bans scale from 2 minutes to 3 days for repeat offenders

## Timestamps

- All timestamps in **milliseconds UTC** by default
- All field names and values are **case-sensitive**
