# @oggregator/web

React 19 + Vite + TypeScript dashboard for cross-venue crypto options data. Mobile-first responsive design.

## Views

- **Chain** — Option chain with calls/puts mirrored around strike, best-price highlighting, IV chips, spread pills, expandable per-venue detail, and quick trade
- **Builder** — Multi-leg options builder with templates, custom legs, live repricing, draggable payoff strikes, and venue comparison
- **Surface** — IV surface heatmap (expiry × delta grid) with term structure indicator
- **Flow** — Live options trade flow with whale detection (🐋 $100K+) plus an institutional RFQ / block trade mode
- **Analytics** — OI by venue, call/put summary, put/call ratio by expiry, DVOL chart with HV overlay, OI by strike, and cross-expiry curves
- **GEX** — Gamma exposure by strike showing dealer positioning (magnet vs accelerator)
- **Alpha** — Credit-spread analysis plus a Thalex BTC short-dated OTM call scanner

## Mobile

Fully responsive with:
- Bottom tab navigation
- Shared toolbar with asset + expiry + hamburger settings
- Full-screen settings drawer (venues, expiry, asset, My IV)
- Card-based chain layout replacing the 15-column desktop grid
- Touch-optimized tap targets (44px minimum)
- PWA ready (manifest, safe areas, homescreen install)

## Alpha lotto scanner

Open `#alpha/BTC` to scan liquid Thalex BTC calls with 4–14 DTE. The panel shows mark and
ask, OTM and expiry breakeven moves, mark/ask/conservative capacity for the configured buying
power, constant-IV Black-76 estimates for 5x/10x/25x, and expiry intrinsic outcomes after
10%/15%/20% BTC moves. Premium cap, minimum OTM, and buying power are configurable; results
can be downloaded as CSV.

Scanner values are estimates, not executable orders. Most short-dated OTM options expire
worthless, and the UI does not assume that API orders satisfy funded-account or Strategy
Builder eligibility rules.

## Commands

```bash
pnpm dev          # dev server on :5173 (proxies /api → :3100)
pnpm build        # tsc --noEmit && vite build
pnpm typecheck    # tsc --noEmit
pnpm test:run     # vitest
```

## Chain transport

- `useChainWs` is the primary path for the chain view
- Browser subscribes to `WS /ws/chain` with `{ underlying, expiry, venues }`
- Server coalesces venue deltas into enriched snapshots every 200ms before pushing them to the browser
- Incoming snapshots are written into the TanStack Query cache via `queryClient.setQueryData(...)`
- `useChainQuery` still exists as the REST bootstrap / fallback path while the socket is connecting

## Stack

| Concern | Library |
|---------|---------|
| Build | Vite 6 + SWC |
| UI | React 19 |
| Server state | TanStack Query v5 |
| Client state | Zustand v5 |
| Charts | Lightweight Charts v5 |
| Validation | Zod |
| Styling | CSS Modules |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `/api` | API base URL (override for split deploys) |
