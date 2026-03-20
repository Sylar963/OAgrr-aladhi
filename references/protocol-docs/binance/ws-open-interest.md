# Binance EAPI — WebSocket Open Interest Stream

Source: https://developers.binance.com/docs/derivatives/options-trading/websocket-market-streams/Open-Interest

## Stream Name

`<underlying>@optionOpenInterest@<expirationDate>`

Example: `ethusdt@openInterest@221125`

## URL Path

`/market`

## Update Speed

**60s**

## Response (array)

```json
[
  {
    "e": "openInterest",
    "E": 1668759300045,
    "s": "ETH-221125-2700-C",
    "o": "1580.87",
    "h": "1912992.178168204"
  }
]
```

## Field Mapping

| Field | Key | Description |
|---|---|---|
| Event type | `e` | `"openInterest"` |
| Event time | `E` | Timestamp (ms) |
| Symbol | `s` | Option symbol |
| OI (contracts) | `o` | Open interest in contracts |
| OI (USDT) | `h` | Open interest in USDT |

## Notes

- Requires expiration date in `YYMMDD` format
- One subscription per underlying+expiry combination
