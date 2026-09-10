# @oggregator/trading

The paper-trading execution layer for oggregator. This package owns orders, fills, positions, cash, and PnL — sourced from the live cross-venue options chain that the rest of the monorepo aggregates.

This document describes what the package **actually does** and, equally important, **what it does not do**. It is intentionally not framed as a "matching engine" — there is no order book, no matching algorithm, and no resting-order lifecycle. It is a **quote-sourced instant-fill simulator** built on top of the aggregator's live top-of-book data.

---

## Two audiences, one source of truth

### For the strategic trader (plain-language summary)

You submit an order in base-underlying exposure, such as `0.05 BTC`. The simulator compares executable bids or asks for that same exposure, including venue taker fees, and books the fill immediately. Venues without verified multiplier, minimum, step, tick, price, and fee metadata remain visible for analytics but cannot receive paper orders.

The realism it gives you:

- **Prices are live.** They come from the same WebSocket feeds the dashboard shows you. If the market moves, the quote you would have filled at moves with it.
- **Venue selection is fee-aware.** If you restrict to Deribit, you pay Deribit's spread and fees. If you leave it open, buys minimize ask plus fee and sells maximize bid minus fee.
- **Contract conventions are normalized.** Native contract quantity, size, minimum, step, price, and fee are converted to base exposure exactly once. Native values remain attached to fills for audit.
- **Fees are venue-specific.** The enrichment pipeline applies the venue fee formula and premium cap to the executable side; there is no execution fallback fee.
- **PnL is honest.** Realized PnL accrues as positions are closed against weighted-average entry; unrealized PnL marks every open leg to the cross-venue mid.

The realism it does **not** give you — be aware of this when judging a strategy:

- **No persistent liquidity consumption.** Repeated paper orders can use the same displayed liquidity. The realistic fill model uses reported L1/L2 size when available and a spread penalty otherwise, but does not mutate a shared simulated book.
- **No latency.** The fill timestamp is `clock.now()` at submission. In a live venue, your order would race the tape.
- **No queue position.** Limit orders, stops, and iceberg orders are not supported at all — the only order kind is a market order that fills instantly.
- **No liquidation or circuit breakers.** An approximation margin engine can reject underfunded orders, but it is not venue risk parity and there is no liquidation lifecycle.

If your strategy's edge depends on any of those missing behaviors, this simulator will overstate it.

### For the quant / engineer (architectural detail)

The package is organized as ports-and-adapters:

```
src/
  book/           Pure domain: Order, Fill, Position, Account, PnL, money, errors
  desk/           Application services that compose the domain
    place-order.ts      OrderPlacementService — accept → fill → persist → ledger
    apply-fill.ts       Folds one Fill into position + cash ledger atomically
    compute-pnl.ts      PnlService — snapshot equity from positions + marks + cash
    portfolio-greeks.ts Stub (returns zeros; real impl deferred)
  gateways/       Ports (interfaces) — Clock, QuoteProvider, FillEngine,
                  OrderRepository, PositionRepository
  adapters/       Concrete implementations
    paper-fill-engine.ts       Quote selection and fill planning
    runtime-quote-provider.ts  Reads from ChainRuntimeRegistry (live aggregator)
    postgres-order-repository.ts
    postgres-position-repository.ts
```

The domain layer (`book/`) has no I/O and no framework dependencies. All persistence and live-data access goes through ports in `gateways/`. This is what makes the tests in `book/position.test.ts` and `book/pnl.test.ts` pure and deterministic, and what would let a backtest adapter slot in beside the paper adapter without touching the domain.

---

## The fill engine in full

The entire execution logic lives in `src/adapters/paper-fill-engine.ts` (~100 lines). Pseudocode:

```
executeOrder(order, venueFilter):
  for each leg in order.legs:
    venues = leg.preferredVenues ?? venueFilter
    books  = quoteProvider.getBooks(legKey, venues)   # top-of-book per venue
    chosen = pickBestEligibleBook(books, leg.side)    # fee-inclusive equal-base routing
    if chosen is null: throw NoLiquidityError(legIndex)
    priceUsd = chosen.ask (if buy) | chosen.bid (if sell)
    feesUsd  = chosen.sideTakerFeeUsdPerBase * quantity
    plan.push({leg, venue, priceUsd, feesUsd, benchmarks, underlyingSpot})
  return plan.map(toFill(filledAt = clock.now()))
```

Semantics worth knowing:

- **All-or-nothing planning across legs.** If any leg has no fresh, valid, quantity-compatible quote on a permitted venue, the whole order throws `NoLiquidityError` before the order is persisted.
- **Per-leg venue selection is independent.** Each leg picks its own best venue. A two-leg order may fill one leg on Deribit and the other on OKX, with per-leg `benchmarkBid/Ask/Mid` and `underlyingSpotUsd` recorded for later reconciliation.
- **Quantities.** Order, fill, and position quantities are base-underlying exposure. Venue-native requested and filled quantities are persisted separately when execution metadata exists.
- **Fees.** Bid and ask fee estimates are absolute USD per base unit, supplied by enrichment and multiplied by filled base quantity.
- **Freshness.** Quote source timestamps must be valid, not in the future, and at most 60 seconds old at one decision time shared by all legs. Invalid or stale venues are excluded before price selection.
- **Timestamping.** A single later `clock.now()` is used for all fills in an order. `SystemClock` is the production implementation; `FixedClock` is used in tests. Source quote time is checked for execution but is not yet persisted on fills, and venue-side acknowledgment delay is not modeled.

### Quote provider

`RuntimeQuoteProvider` calls into `ChainRuntimeRegistry` from `@oggregator/core`, acquires a chain runtime for `(underlying, expiry, venues)`, and extracts the `(strike, optionRight)` execution projection. Quotes without complete execution metadata are omitted. `getMark()` averages finite USD-per-base marks from executable venues.

### Order placement service

`OrderPlacementService.place()` is the single entry point:

1. Validate legs (non-empty, positive quantity) — else `InvalidOrderError`.
2. Build the `Order` with every quantity labeled `base`.
3. Plan execution. Invalid, below-minimum, off-step, stale, or unquotable orders fail before persistence.
4. Persist the accepted order and run the margin check. Margin failures persist as rejected orders.
5. On success: `saveFills()`, then `applyFill()` per fill (position fold + cash ledger entry).
6. Update the order to `filled` with `totalDebitUsd = -sum(fillCashDelta)`.

Position folding (`applyFillToPosition` in `book/position.ts`) handles the four cases explicitly: opening from flat, adding same-direction (weighted-average entry), partial close (realized delta = closedQty × (fillPrice − avgEntry) × priorSign), and flip (close full prior, reopen at fill price). Tests in `book/position.test.ts` cover these paths.

### PnL service

`PnlService.snapshot(accountId)` pulls positions, fill economics, and current cash, fetches a cross-venue average mark for each non-flat position in parallel, and returns:

```
equityUsd      = cashUsd + sum(netQuantity * markPriceUsd)           for positions with mark
unrealizedUsd  = sum( netQuantity × (mark − avgEntryPriceUsd) )    for positions with mark
grossRealized  = sum(signed premium cash flow + netQuantity * avgEntryPriceUsd)
realizedUsd    = grossRealized - feesUsd
totalUsd       = realizedUsd + unrealizedUsd
```

Fill history is authoritative for cumulative realized PnL and fees, including closed and reopened
instruments. A position without fill history falls back to its persisted realized value with zero
reconstructed fees.

Unrealized PnL for a position is `null` when no venue has a current mark — this is surfaced to the client rather than silently zeroed.

Aggregate equity omits unpriced inventory; it is incomplete when any open position lacks a mark
and can overstate equity for unpriced shorts. Cash already includes premium flows and fees, so
neither realized nor unrealized PnL is added again to signed marked inventory.

### Persistence

Postgres-backed when `DATABASE_URL` is set; a `NoopPaperTradingStore` stands in otherwise (routes return `503 persistence_unavailable` in that mode). Migration `0020_paper_fill_quantity_context.sql` adds base-unit labels and nullable native conversion context to fills. Existing rows default to base semantics. The cash balance is derived from the `cash_ledger` table; every fill writes a `deltaUsd` entry alongside the position upsert.

### Transport

- `POST /paper/orders` — submit an order, synchronous fill, returns `{order, fills}`.
- `WS /ws/paper` — pushes `positions` and `pnl` snapshots every 1000 ms, plus `order` / `trade` / `activity` events on the in-process `PaperEventBus` when the REST side emits them. Single-process only; no cross-instance fan-out.

---

## Explicit non-goals

These are design decisions, not missing features. Listed so no one has to re-derive them by reading the code:

| Capability | Status |
| --- | --- |
| Limit, stop, stop-limit, iceberg, post-only, FOK, IOC orders | Not implemented. `OrderKind = 'market'` is the only value in the type. |
| Persistent simulated order-book consumption | Not implemented. Reported depth informs a fill but is not depleted across orders. |
| Full venue L2 parity | Not implemented. The realistic model walks an optional L2 ladder and otherwise applies a bounded spread penalty. |
| Latency / queue position modeling | Not implemented. `filledAt = clock.now()` at submission. |
| Venue-exact portfolio margin, liquidation, circuit breakers | Not implemented. The current margin engine is an approximation and has no liquidation lifecycle. |
| Multiple accounts | Not implemented in transport. `DEFAULT_ACCOUNT_ID = 'paper-default'` is hardcoded in `trading-services.ts`. The domain supports account IDs; the routes do not expose them. |
| Cross-process WS fan-out | Not implemented. `PaperEventBus` is an in-process `Set<Listener>`. |
| Order cancellation / amendment | Not implemented. Fills are synchronous within `place()`, so there is no resting state to cancel. |

---

## When this simulator is useful, and when it is not

Useful for:

- Validating that a multi-leg construction prices, routes, and books correctly against real live cross-venue data.
- Tracking realized vs. unrealized PnL on real strategies at real venue fees, with real spreads.
- Exercising the PnL / positions / activity UI against a live backend.

Not useful for:

- Benchmarking execution algorithms — there is no execution to benchmark.
- Estimating impact or slippage for any size larger than what top-of-book can absorb.
- Validating risk systems, margin models, or liquidation paths — none are simulated.
- Latency-sensitive or queue-sensitive strategies — both are modeled as zero.

If future work adds a real matching engine (resting orders, depth, latency, margin), those non-goals are the scope of that work. The port boundaries in `gateways/` are deliberately the place where that substitution would happen — a new `FillEngine` implementation could sit beside `PaperFillEngine` without the domain or application services changing.
