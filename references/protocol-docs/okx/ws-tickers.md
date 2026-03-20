# OKX — WebSocket Tickers Channel

Source: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-tickers-channel

## Channel

`tickers`

## URL Path

`/ws/v5/public` (no authentication needed)

## Subscribe Format

**Per-instrument subscription required** — instId is mandatory:

```json
{
  "op": "subscribe",
  "args": [
    {
      "channel": "tickers",
      "instId": "BTC-USD-260321-70000-C"
    }
  ]
}
```

⚠️ **instFamily is NOT supported for tickers channel with OPTION instType**
Using `{ "channel": "tickers", "instType": "OPTION", "instFamily": "BTC-USD" }` 
returns error 60018: "Wrong URL or channel doesn't exist"

## Push Data (verified live 2026-03-20)

```json
{
  "arg": {
    "channel": "tickers",
    "instId": "BTC-USD-260321-70000-C"
  },
  "data": [
    {
      "instType": "OPTION",
      "instId": "BTC-USD-260321-70000-C",
      "last": "0.013",
      "lastSz": "1",
      "askPx": "0.0135",
      "askSz": "2058",
      "bidPx": "0.013",
      "bidSz": "1818",
      "open24h": "0.0335",
      "high24h": "0.0335",
      "low24h": "0.01",
      "sodUtc0": "0.012",
      "sodUtc8": "0.011",
      "volCcy24h": "16.13",
      "vol24h": "1613",
      "ts": "1773966184462"
    }
  ]
}
```

## Field Mapping

| Field | Description |
|---|---|
| `instId` | Instrument ID |
| `last` | Last traded price |
| `askPx` | Best ask price |
| `askSz` | Best ask size |
| `bidPx` | Best bid price |
| `bidSz` | Best bid size |
| `vol24h` | 24h volume (contracts) |
| `volCcy24h` | 24h volume (base currency) |
| `ts` | Ticker generation time (Unix ms) |

## Update Frequency

- Fastest: 1 update per 100ms
- Only pushes when there's a change (trade, best bid/ask change)

## Key Notes

- Requires **per-instrument** subscription — no bulk option
- For options, prices are in settle currency (BTC for BTC-USD options)
- Does NOT include greeks — use `opt-summary` channel for greeks
- Combined with `opt-summary`, provides complete option data:
  - `tickers` → bid/ask/last/volume
  - `opt-summary` → greeks/IV/forward price
