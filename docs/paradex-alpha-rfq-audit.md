# Paradex Alpha: current flow, gaps and RFQ integration

Reviewed 2026-11-08 (client date). This is a source-code and official-API audit.
Authenticated production account reads were not performed during development.

## Why Thalex worked while Paradex looked empty

| Area | Existing Thalex path | Existing Paradex path | Result and change |
| --- | --- | --- | --- |
| Public prices | Live outright quotes; dedicated Thalex L2 runtime for depth | `feeds/paradex/state.ts` normalizes market-summary bid/ask separately from marks | A mark-only Paradex book correctly fails executable-price gates. Public data was not connected to RFQ BBO. |
| Alpha cards | `spread-scanner.ts` prices synchronized bid/ask pairs, size and fees | Same screen scanner; `isMarkOnly()` labels marks without quotes | Added Screen/RFQ controls without changing the existing screen ranking. |
| Current account equity | Private account equity and margin supported by `ThalexPositionStore` | `ParadexPrivateClient` fetched positions every 15 seconds and account history on demand | No current `GET /account` request existed. Added equity, free collateral, initial and maintenance margin. |
| Margin API | `/portfolio/venue-margin?venue=thalex` | No equivalent Paradex current-account response | Added `/portfolio/paradex/account`; kept Thalex's existing contract. |
| Planning equity | Manual Alpha sizing input | Same manual field | Live Paradex account summary now appears whenever Paradex is active. Explicit “Use equity for this plan” copies a snapshot into the spread input. |
| Private liquidity | Screen-based analytics plus venue-specific depth features | No `GET /rfqs` or per-RFQ BBO reader | Added account-scoped request pagination and bounded-concurrency strategy BBO reads. |

A missing screen quote is not proof that Paradex has no liquidity. Conversely, an RFQ mark
is not an executable maker quote. The two sources answer different questions.

## Implemented data paths

```text
Paradex read-only JWT (existing encrypted credentials)
  -> ParadexPrivateClient.fetchAccountSummary()
     -> GET /v1/account
     -> /api/portfolio/paradex/account
     -> account-scoped TanStack Query (15 seconds)
     -> Alpha and Portfolio equity summaries

  -> ParadexPrivateClient.fetchOpenRfqs(underlying, cursor)
     -> GET /v1/rfqs?state=OPEN&page_size=100[&cursor=...]
     -> filter the current underlying, preserving the upstream cursor
     -> GET /v1/rfqs/{rfq_id}/bbo (at most four concurrent per page)
     -> /api/portfolio/paradex/rfqs?underlying=BTC[&cursor=...]
     -> account-scoped infinite query (5 seconds while RFQ mode is active)
     -> Paradex RFQ cards
```

Both routes inherit the portfolio authentication hook. The account comes from the server's
request session, never from a client-supplied account query. Connection leases keep the
private client alive during a request. New responses have shared protocol schemas and are
validated at both server and web boundaries. Upstream GETs use a 10-second timeout.

RFQ view is available on spread and short/long-straddle venue cards. Other scanner tabs
have a dedicated Paradex source card. It displays the current underlying's open RFQs across
all strategies and expiries, explicitly labeled; it does not pretend they match the selected
screen strikes, size or expiry. The card remains accessible before spread equity is entered.

## Endpoint map

| Purpose | Official endpoint | Handling |
| --- | --- | --- |
| Current equity and margin | [`GET /v1/account`](https://docs.paradex.trade/api/prod/account/get) | `account_value` includes unrealized P&L; `free_collateral` is separate. Optional margin fields stay unknown. |
| Existing account requests | [`GET /v1/rfqs`](https://docs.paradex.trade/api/prod/rfqs/rfq-list) | `state=OPEN`; preserve opaque `next`. An empty page may still have a next page, exposed by “Load next RFQ page.” |
| Maker prices for one request | [`GET /v1/rfqs/{id}/bbo`](https://docs.paradex.trade/api/prod/rfqs/rfq-bbo) | Display signed strategy prices and quantities, mark reference and fetch time. A missing BBO stays unavailable. |
| Eligible RFQ instruments | [`GET /v1/rfqs/markets`](https://docs.paradex.trade/api/prod/rfqs/rfq-markets) | Needed before a future create flow. Listing does not itself supply executable liquidity. Venue quantity grid can differ from the screen grid. |
| Request new quotes | [`POST /v1/rfqs`](https://docs.paradex.trade/api/prod/rfqs/rfq-create) | Requires write credentials and private WebSocket result handling; not part of the read-only integration. |
| Accept a quote | [`POST /v1/rfqs/{id}/execute`](https://docs.paradex.trade/api/prod/rfqs/rfq-execute) | Async signed net strategy execution; not invoked by Alpha. |

[Readonly authentication](https://docs.paradex.trade/api/general-information/api-authentication)
uses `Authorization: Bearer <READONLY-TOKEN>` for GET requests. Endpoint-specific RFQ
permissions still need verification against the connected account; permission failures are
surfaced rather than displayed as zero liquidity.

## Display and accounting invariants

1. Current equity is neither cash collateral nor option-leg P&L nor the latest daily history point.
2. Zero equity is displayed as zero. Negative free collateral is retained.
3. A strategy BBO may be zero or negative. Missing price/quantity is not a usable quote.
4. Prices retain up to eight decimal places and show available strategy quantity. Per-leg
   ratios and any fixed hedge prices remain attached to the same request.
5. RFQ prices are before fees and outside Alpha's screen rankings. No RFQ EV, max-loss,
   margin approval or guaranteed fill is inferred from these raw quotes.
6. A failed refresh, expired RFQ or BBO fetched at least 15 seconds ago suppresses bid/ask.
   Account equity older than 30 seconds, or following a refresh error, cannot be copied into
   the spread plan. Venue `updated_at` and RFQ BBO `created_at` are retained separately from
   local fetch timestamps; fetch time does not assert a new maker quote was posted then.
7. Settlement amounts use the displayed 1:1 USD assumption; no live USDC conversion is applied.

## Operator walkthrough

1. Connect Paradex with the existing read-only connection and activate Paradex for Alpha.
2. Select Paradex in the account dropdown; compare equity/free collateral with the same
   account in Paradex. If needed, click “Use equity for this plan” in a spread tab.
3. Create the desired RFQ in Paradex, then choose RFQ on its Alpha card. Check each request's
   legs, ratios, strategy size, bid/ask quantities and fetched time.
4. If the page is empty and “Load next RFQ page” is available, continue through the cursor.
5. Read access errors mean the token, its expiry or RFQ registration/permissions need checking.
   An empty successful final page means there are no matching open account RFQs.
6. Execute on Paradex. Alpha's read-only connection never creates, cancels or executes a request.

## Further work to generate quotes from Alpha

A complete new-request workflow belongs in `apps/trade`, the existing isolated signing vault.
It needs RFQ registration/availability, eligible markets, minimum block size and the least
common multiple of screen and RFQ quantity increments. Subscribe to the private `rfq`
channel before create, correlate `request_id` with the RESULT event, and use its accepted
`rfq_id` and `allowed_side`. A 202 HTTP response alone does not establish acceptance.
Create can reserve collateral. No credentials or write requests were added to the dashboard.

To rank these quotes alongside screen opportunities later, price the exact accepted structure
with its signed net price, permitted direction, ratios, available quantity, costs and held book.
Do not overwrite public-chain leg prices with independent RFQ leg indications.

## Alpha account selector (2026-11-09, client date)

The account panel now offers Thalex and Paradex whenever either is an active Alpha venue.
Both accounts remain selectable independently of the quote venue. Choosing an account only
changes the displayed balance; “Use equity for this plan” explicitly copies its equity into
the spread sizing input. Changing accounts does not overwrite the current plan.

Thalex reads `/api/portfolio/thalex/account`, backed by the existing authenticated
`private/account_summary` RPC with a 10-second timeout and account-scoped connection lease.
The selected account refreshes every 15 seconds. Equity is cash at its available USD index
prices plus unrealised and session-realised P&L; `remaining_margin` supplies free margin and
`required_margin` supplies initial margin. Maintenance margin remains unavailable. The
response identifies Mainnet/Testnet, and an in-flight result is discarded if its private
client was replaced. Unpriced nonzero cash holdings are identified and prevent adopting
incomplete equity. No historical balance or collateral figure substitutes for current equity.

Regression coverage includes explicit account selection and copying, stale and failed reads,
zero balances, missing margin fields, network changes, and authenticated-account scoping.
Actual connected-account balances still require a signed-in comparison with each venue.
