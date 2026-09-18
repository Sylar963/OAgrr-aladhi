# @oggregator/web

React 19 + Vite + TypeScript dashboard for cross-venue crypto options data. Mobile-first responsive design.

## Views

- **Chain** — Option chain with calls/puts mirrored around strike, best-price highlighting, IV chips, spread pills, expandable per-venue detail, and quick trade
- **Builder** — Multi-leg options builder with templates, custom legs, live repricing, draggable payoff strikes, and venue comparison
- **Surface** — IV surface heatmap (expiry × delta grid) with term structure indicator
- **Flow** — Live options trade flow with whale detection (🐋 $100K+) plus an institutional RFQ / block trade mode
- **Analytics** — OI by venue, call/put summary, put/call ratio by expiry, DVOL chart with HV overlay, OI by strike, and cross-expiry curves
- **GEX** — Gamma exposure by strike showing dealer positioning (magnet vs accelerator)
- **Alpha** — Shared regime context for call credit, put credit, and multi-venue long-call scanning

## Mobile

Fully responsive with:
- Bottom tab navigation
- Shared toolbar with asset + expiry + hamburger settings
- Full-screen settings drawer (venues, expiry, asset, My IV)
- Card-based chain layout replacing the 15-column desktop grid
- Touch-optimized tap targets (44px minimum)
- PWA ready (manifest, safe areas, homescreen install)

## Alpha workspace

Open `#alpha/BTC` and choose Spread scanner or Long calls.
The spread scanner defaults to Thalex, filters expiries to the chosen venue, and enumerates
call/put credit and debit verticals for the selected expiry. Compare each venue shows separate
venue groups; legs are never combined across venues. Enter current equity, size per leg, risk
percentage and an extra cost reserve. Equity, risk and reserve persist on this browser and must
be updated manually; they are not live balance or free-margin data.

Candidates require linear matching settlement, known execution metadata and fees, quantity
minimum/step alignment, adequate displayed size, quotes no older than 15 seconds and leg
timestamps within 2 seconds. Unsupported inverse products and other exclusions have explicit
reasons. Entry fees use public taker estimates; Thalex assumes Tier 1 atomic combination
execution and charges the largest leg fee, with the published minimum. The user reserve is
included in payoff, breakeven and model difference; it is not a guarantee of future costs.

The default model difference compares entry against a flat-IV Black-76 benchmark using
the venue's forward and the average leg mark IV. This is not empirical expected profit.
Optional forecast mode uses the entered expected mean expiry move and annual volatility
in a common lognormal distribution. Positive results are labeled for review; no probability
is a calibrated win rate. There is no arbitrary 10%/20% EV gate in the new scanner.

Selecting a candidate shows exact legs, position-dollar economics, expiry scenarios,
an indicative reverse-quote round trip and temporary thesis/exit notes. The connected
venue's Portfolio metrics are read through the existing authenticated endpoint. Portfolio
remains the position-management view; multi-expiry curves now explicitly describe their
same-settlement-price assumption. Alpha never submits an order.

The context strip describes historical IV/RV rather than making a blanket credit-spread
recommendation. Long calls retain the existing active-venue scanner across 4–14 DTE.

Long-call candidates show venue-normalized mark and ask, OTM and expiry breakeven, ATM implied
move, the required 10x move in implied-move units, and buying-power capacity. Selecting a row
reveals 5x/10x/25x constant-IV targets and expiry intrinsic shocks without adding another panel.
Premium cap, minimum OTM, and buying power are configurable, and results can be downloaded as CSV.

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
