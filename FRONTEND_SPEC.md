# Frontend Spec — Tier 1 Backend API

Everything below is live and ready to consume. No mocks needed.

## Base URL

```
http://localhost:3100/api
```

---

## Endpoints

### GET /api/chains?underlying=BTC&expiry=2026-03-21&venues=deribit,okx,binance,bybit,derive

The primary endpoint. Returns enriched cross-venue comparison for one expiry.

`venues` is optional — defaults to all connected venues.

**Response shape:**

```typescript
{
  underlying: "BTC",
  expiry: "2026-03-21",
  dte: 1,                              // days to expiry
  stats: {
    spotIndexUsd: 70604 | null,         // BTC spot (same across venues)
    forwardPriceUsd: 70606 | null,      // forward for THIS expiry (venue's underlying reference)
    forwardBasisPct: 0.003 | null,      // (forward - spot) / spot * 100
    atmStrike: 70500 | null,            // strike nearest to forward price
    atmIv: 0.584 | null,               // IV at ATM strike (decimal, not percent)
    putCallOiRatio: 1.42 | null,        // sum(put OI) / sum(call OI)
    totalOiUsd: 5300000000 | null,      // total OI in USD
    skew25d: 0.041 | null,             // 25Δ put IV − 25Δ call IV (decimal)
  },
  strikes: [
    {
      strike: 70000,
      call: {
        venues: {
          deribit: {
            bid: 1058.37,               // USD
            ask: 1128.93,
            mid: 1093.65,
            bidSize: 26.5,
            askSize: 27.5,
            markIv: 0.584,              // decimal (58.4%)
            bidIv: 0.561,
            askIv: 0.616,
            delta: 0.52,
            gamma: 0.00003,
            theta: -45.2,
            vega: 120.5,
            spreadPct: 6.45,            // (ask - bid) / mid * 100
            totalCost: 1131.14,         // mid + spread/2 + taker fee
            estimatedFees: { maker: 2.11, taker: 3.52 },
            openInterest: 82.0,
          },
          okx: { ... },
          binance: { ... },
          // venues not quoting this strike are absent, not null
        },
        bestIv: 0.581,                  // lowest markIv across venues
        bestVenue: "okx",               // venue with lowest markIv
      },
      put: { /* same shape */ },
    },
    // ... more strikes, sorted ascending
  ],
  gex: [
    { strike: 65000, gexUsdMillions: 580.2 },
    { strike: 70000, gexUsdMillions: -140.5 },
    // positive = price magnet, negative = accelerator
    // sorted by strike
  ],
}
```

**Key notes for frontend:**
- `markIv` is a **decimal** (0.584 = 58.4%). Multiply by 100 for display.
- `skew25d` is also decimal.
- `spotIndexUsd` is the BTC spot price. Use this for the "BTC $70,604" display.
- `forwardPriceUsd` is what options are priced against. Show as "Underlying: $70,606" next to the expiry.
- `forwardBasisPct` shows the forward premium. Near expiries ≈ 0%. Far expiries can be 2-5%.
- Venues missing from a strike's `venues` object simply don't quote that strike. Don't show a row for them.
- `bestVenue` is the venue with the cheapest optionality (lowest IV). Highlight this venue's dot.
- `totalCost` includes spread impact + taker fee. This is what it actually costs to enter the trade.
- `gex` array may be empty if gamma/OI data is insufficient.

---

### GET /api/surface?underlying=BTC&venues=deribit,okx

IV surface across all expiries. Rows = expiries, columns = delta levels.

**Response:**

```typescript
{
  underlying: "BTC",
  surface: [
    {
      expiry: "2026-03-21",
      dte: 1,
      delta10p: 0.89 | null,     // 10Δ put IV (deep OTM put)
      delta25p: 0.65 | null,     // 25Δ put IV
      atm: 0.584 | null,        // ATM IV
      delta25c: 0.52 | null,    // 25Δ call IV
      delta10c: 0.48 | null,    // 10Δ call IV (deep OTM call)
    },
    // ... more expiries, sorted nearest first
  ],
  termStructure: "contango" | "flat" | "backwardation",
}
```

**Notes:**
- All IV values are decimals (multiply by 100 for display).
- `null` means no strike exists near that delta level (illiquid expiry).
- `termStructure` compares nearest vs furthest ATM IV.
- This endpoint fetches ALL expiries — may take 2-3 seconds on first call.

---

### GET /api/venues

```typescript
["deribit", "okx", "binance", "bybit", "derive"]
```

---

### GET /api/underlyings

```typescript
{
  deribit: ["BTC", "ETH"],
  okx: ["BTC", "ETH"],
  binance: ["BTC", "ETH"],
  bybit: ["BTC", "ETH"],
  derive: ["BTC", "ETH", "SOL"],
}
```

---

### GET /api/expiries?underlying=BTC

```typescript
{
  deribit: ["2026-03-21", "2026-03-22", ...],
  okx: ["2026-03-21", "2026-03-28", ...],
  binance: ["2026-03-21", "2026-03-28", ...],
  bybit: ["2026-03-21", "2026-03-28", ...],
  derive: ["2026-03-21", "2026-03-27", ...],
}
```

---

### GET /api/health

```typescript
{ status: "ok", venues: ["deribit", "okx", "binance", "bybit", "derive"] }
```

Returns 503 with `{ error: "initializing" }` while adapters are bootstrapping (~5-15 seconds after server start).

---

## What the backend handles (frontend should NOT compute)

| Metric | Backend field | Don't do this on frontend |
|--------|--------------|--------------------------|
| USD conversion (inverse venues) | `bid`, `ask`, `mid`, `mark` are already in USD | Don't multiply by underlying |
| Spread % | `spreadPct` | Don't compute from bid/ask |
| Total execution cost | `totalCost` | Don't add fees yourself |
| Best IV venue | `bestIv`, `bestVenue` | Don't scan venues yourself |
| ATM strike | `stats.atmStrike` | Don't find nearest strike |
| Put/Call ratio | `stats.putCallOiRatio` | Don't sum OI yourself |
| 25Δ skew | `stats.skew25d` | Don't interpolate deltas |
| GEX | `gex[]` | Don't compute gamma exposure |
| Forward basis | `stats.forwardBasisPct` | Don't compute spot vs forward |
| Fee estimation | `estimatedFees` with cap logic | Don't hardcode fee rates |

## What the frontend SHOULD compute (pure UI logic)

| Feature | How |
|---------|-----|
| IV chip color | `markIv < 0.50` → green, `0.50-0.65` → amber, `> 0.65` → red |
| Spread pill color | `spreadPct < 2.5` → green, `2.5-4.5` → amber, `> 4.5` → red |
| "My IV" edge column | `userIv - venue.markIv` per venue. Pure input state. |
| Breakeven at expiry | Call: `strike + mid`. Put: `strike - mid`. |
| IV surface heatmap colors | Color gradient from min to max IV in the grid |
| GEX bar chart | Render `gex[]` as horizontal bars, split at zero |
| ATM badge | Compare `strike === stats.atmStrike` |
| ITM highlight | Call: `strike < stats.forwardPriceUsd`. Put: `strike > stats.forwardPriceUsd`. |

## Data freshness

- Nearest 3 expiries: **live data from boot** (subscribed eagerly at startup)
- Other expiries: data arrives within **1-2 seconds** of first request
- All data updates in real-time via WebSocket (100ms-2s depending on venue)
- The frontend should poll `/api/chains` every 2-5 seconds for the active view, or implement WS streaming (Tier 2 work)

## Error handling

- 503 during bootstrap → retry with backoff (existing `fetchJson` already does this)
- Venue missing from `strikes[].call.venues` → venue has no quote for that strike. Show dash or hide.
- `null` fields → data not available. Show dash.
- Empty `gex[]` → not enough gamma/OI data. Hide GEX tab or show "insufficient data".

## Type imports

All response types are exported from `@oggregator/core`:

```typescript
import type {
  EnrichedChainResponse,
  EnrichedStrike,
  EnrichedSide,
  VenueQuote,
  ChainStats,
  GexStrike,
  IvSurfaceRow,
  TermStructure,
  VenueId,
} from '@oggregator/core';
```
