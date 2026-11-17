# TradFi analytics

Open TradFi → Analytics, or `#tradfi/analytics/SPX`. The tab follows the existing ticker selector.
Choose all expiries or one expiry, volume or OI, and contracts or USD underlying notional.
Selecting a tenor bar, table entry or heatmap cell focuses that expiry.

## Data and ownership

| Layer | Responsibility |
| --- | --- |
| Protocol `tradfi-analytics.ts` | Shared Zod response contracts and heatmap strike limit |
| Core `services/options-activity.ts` | Pure aggregation of contract counts, coverage and notionals |
| Core `services/options-parity.ts` | Pure matching, quote-quality gates and target-excluded interpolation |
| TradFi `runtime/analytics.ts` | Store projection, session selection, expiry and subscription coverage |
| TradFi `routes/analytics.ts` | Validated API inputs, subscription leases and shared one-second snapshots |
| Web `features/tradfi/analytics/` | TanStack queries, formatting, activity panels and pricing panel |

No dependencies or database tables were added. API values stay in TanStack Query; the existing
store holds ticker/navigation state. UI filters reset on ticker changes. Responses from an old
ticker or expiry are not placeholders for a new request.

## API

| GET path, relative to `/tradfi-api` | Result |
| --- | --- |
| `/analytics?underlying=SPX[&expiry=YYYY-MM-DD]` | Summary, expiry rows, strike rows, heatmap cells, volume session and coverage |
| `/analytics/parity?underlying=SPX&expiry=YYYY-MM-DD` | Call/put pricing pairs, quality status and eligible consistency residuals |

Catalog-not-ready returns 503; invalid queries return 400; unknown tickers and unknown/expired
expiries return 404. No-expiry activity requests include only unexpired contracts. The expiry list
always contains every currently available expiry even when activity is filtered.

Activity leases request Trade + Summary across every strike. Pricing leases request Quote for
the selected expiry. Both use the existing budget, tier union and idle eviction; they do not
create extra feed sockets. Deferred expiries are explicit and excluded from observed coverage.
Other active consumers retain their existing subscription leases.

All summaries and strike/expiry rows cover the entire requested universe. Heatmap cells are
limited to the union of the top 20 strikes for volume/OI in contracts/notional, bounding transport
without changing totals. The UI shows the selected measure's top 20 strikes. Both queries poll
every ten seconds, stop when unmounted, and use one-second shared server snapshots.

## Calculation invariants

- Volume uses `Trade.dayId` and cumulative `dayVolume`. The latest observed trading day for the
  underlying identifies the displayed session; values from different days are never summed.
  A prior session can remain displayed when the provider has not published a new one; its date
  remains visible. REST data without a verified day ID is excluded from session volume.
- A reported zero differs from unavailable data. Partial totals include observed contracts;
  ratios require observations for every listed contract on both sides and a positive denominator.
- Put/call ratios use contract counts. USD underlying notional uses each contract's multiplier
  and the latest available spot; it is not premium traded or a time-of-trade dollar measure.
- OI is the latest reported snapshot. Separate receipt timestamps prevent a Greeks update from
  refreshing the age of a quote, volume observation or OI observation.

## Pricing consistency

Pair identity includes root, expiry timestamp, settlement, multiplier and strike. Only SPXW roots
under SPX enable European consistency initially. Other instruments show usable call-minus-put
spreads and the explicitly labeled zero-rate indication, without European residuals.

For eligible interior strikes, let `w = (K − K_left) / (K_right − K_left)`. Interpolate neighboring
call-minus-put bids and asks separately. The reference never contains the target pair:

```text
referenceBid = (1 − w) × leftSpreadBid + w × rightSpreadBid
referenceAsk = (1 − w) × leftSpreadAsk + w × rightSpreadAsk
midResidual = targetSpreadMid − referenceMid
residualRange = [targetSpreadBid − referenceAsk, targetSpreadAsk − referenceBid]
```

This tests the affine relationship of European call-minus-put prices across strikes without
supplying a discount rate. It does not compare an option-derived forward with itself. Endpoints,
missing pairs, incompatible groups and insufficient/time-mismatched neighbors have no reference.

Source quotes must be at most 20 minutes old, all compared source timestamps within 30 seconds,
and received within two minutes. The source-age limit accommodates the existing delayed feed;
usable does not mean real-time. Quotes need finite nonnegative uncrossed prices and positive sizes.
Displayed leg sizes do not guarantee simultaneous package fills. Residuals are per quoted unit,
before financing, borrow, fees, margin and execution costs. Independent-reference parity valuation
is explicitly unavailable until an appropriate matched reference is connected.

The source reading ledger is in [options-trading.md](../../docs/knowledge/options-trading.md).
