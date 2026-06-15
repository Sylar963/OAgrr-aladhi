# TradFi backend (TastyTrade) — design spec

**Date:** 2026-06-14
**Status:** Approved, pre-implementation
**Branch:** `feat/tastytrade-v2-chain`

## 1. Goal

Stand up a **separate, self-contained TradFi backend service** that serves a live, enriched
listed-options chain from TastyTrade. The single acceptance target for this phase:

> `GET /chains?underlying=AAPL&expiry=YYYY-MM-DD` (on the TradFi service) returns a fully
> enriched options chain — bid/ask/mark/last, greeks, IV — for **SPX, NDX, SPY, QQQ, AAPL,
> NVDA, TSLA**.

The TRADFI button, black theme, and CHAIN page in the web app are a **later phase** (own spec).
This spec is the backend data layer only.

## 2. Decisions (locked)

- **Separate service, not a venue.** TradFi is its own backend process. It does **not** extend
  `SdkBaseAdapter`, does **not** reuse `chainEngines`/the crypto `ChainRuntime`, does **not** share
  the crypto QuoteStore or adapter registry. Mutual exclusivity with crypto is automatic: this
  process only ever boots TastyTrade, so the crypto WS layer is never running alongside it (and is
  never touched — honoring the "don't touch the fragile crypto WS layer" constraint).
- **New package `packages/tradfi` (`@oggregator/tradfi`).** Own entrypoint, own port, own runtime,
  own store, own routes.
- **Reuse only asset-agnostic primitives** from `@oggregator/core` (option/chain canonical types,
  enrichment math, symbol/expiry helpers, logger, `TopicWsClient` transport). Never imports or
  instantiates a crypto adapter or the crypto runtime. No re-deriving Black-Scholes / skew / GEX.
- **Frontend stays one app.** The eventual TRADFI button lives in the existing oggregator dashboard
  top section and points the SPA at this service. Same host.
- **OAuth2 auth** (see §4) — username/password is not a supported path on the Open API.
- **Delete the dead additive scaffold** (see §10): the `/api/v2/*` routes and the `feeds/tastytrade`
  stubs are superseded — migrate the useful Zod schemas first, then remove. The v1-route
  asset-class filtering is **left vestigial with a comment** (crypto routes stay byte-unchanged).

## 3. Package layout

```
packages/tradfi/
  package.json            @oggregator/tradfi (deps: @oggregator/core, @oggregator/protocol,
                          fastify, @fastify/websocket, ws, zod, pino)
  tsconfig.json
  src/
    index.ts              entrypoint — Fastify on TRADFI_PORT (default 3200)
    app.ts                app factory + route registration + feed bootstrap (start/stop)
    config.ts             env loader (§4, §9)
    tastytrade/
      auth.ts             OAuth2 token manager (refresh token + client secret -> access token)
      rest.ts             REST client: api-quote-tokens, option-chains nested, market-data/by-type
      types.ts            Zod schemas for all REST + DXLink payloads (migrated + extended)
      dxlink-client.ts    DXLink WS client (wraps core TopicWsClient + handshake state machine)
      codec.ts            DXLink frame builders + COMPACT FEED_DATA parser
      planner.ts          subscription planning (event types per contract; add/remove diff; underlyings)
      state.ts            merge helpers: Quote/Greeks/Trade/Summary -> live quote; underlying spot map
      health.ts           US market-hours + token-expiry -> health signal
      feed.ts             orchestration: loadMarkets, subscribe/unsubscribe, snapshot
      instrument.ts       TradFi instrument model + canonical symbol building
    runtime/
      store.ts            TradFi quote store (keyed by streamer symbol) — its own, not crypto's
      chain.ts            build ComparisonChain from store; call core enrichment for stats
    routes/
      venues.ts  underlyings.ts  expiries.ts  chains.ts  ws-chain.ts
  test/ (or co-located *.test.ts per repo convention)
references/options-docs/tastytrade/{rest,dxlink}/   captured, secret-masked fixtures
```

No multi-venue adapter abstraction (YAGNI): there is one venue (TastyTrade). ES/NQ later are still
TastyTrade, on a different endpoint (`/futures-option-chains`), not a different venue.

## 4. Authentication — OAuth2 personal grant

Authoritative: *"all tastytrade API users must use OAuth2 access tokens."* Username/password cannot
obtain a quote token. Flow:

1. **Manual, one-time (done):** OAuth app created at my.tastytrade.com with scope `read` (2FA
   required) → **Client ID + Client Secret**; a personal **Grant** → long-lived **Refresh Token**.
2. **Runtime (our code):** `POST https://api.tastyworks.com/oauth/token` with
   `grant_type=refresh_token`, `refresh_token`, `client_secret` → `access_token` (~15 min,
   `expires_in` seconds). Cache it; refresh ~60s before expiry. Send as
   `Authorization: Bearer <access_token>` on every REST request.

Env (gitignored `.env` locally; Scaleway env in prod):

| Var | Purpose |
|---|---|
| `TASTYTRADE_CLIENT_ID` | OAuth client id |
| `TASTYTRADE_CLIENT_SECRET` | OAuth client secret |
| `TASTYTRADE_REFRESH_TOKEN` | long-lived personal-grant refresh token |
| `TASTYTRADE_BASE_URL` | default `https://api.tastyworks.com` |
| `TRADFI_PORT` | default `3200` |
| `TRADFI_UNDERLYINGS` | default `SPX,NDX,SPY,QQQ,AAPL,NVDA,TSLA` |

The credential source is behind the `auth.ts` interface so an authorization-code flow (multi-user)
can be added later without touching the rest of the stack.

**Required headers on all REST calls:** `Authorization: Bearer …`, `User-Agent:
oggregator-tradfi/0.1` (mandatory — requests without a User-Agent are blocked), `Accept:
application/json`.

> Verify at M1: OAuth token endpoint body encoding (form-urlencoded per OAuth2 spec vs JSON) — the
> docs don't state it. Capture the real exchange and fixture it.

## 5. REST layer (`rest.ts`)

Base `https://api.tastyworks.com`. Endpoints used:

- **`GET /api-quote-tokens`** → `{ data: { token, dxlink-url, websocket-url?, level, issued-at?,
  expires-at? } }`. The `token` is the DXLink streamer token (24h life); `dxlink-url` is the WS URL.
  **Read both from the response — never hardcode the URL** (it differs across environments). Requires
  a funded customer account (we have one).
- **`GET /option-chains/{symbol}/nested`** → `NestedOptionChainSerializer`. Yields per contract:
  `strike-price`, OCC `symbol`, `streamer-symbol`, `expiration-date`, `expires-at` (exact ts),
  `exercise-style` (American/European), `settlement-type` (Physical/Cash), `shares-per-contract`
  (multiplier, typically 100), `root-symbol`. This is the instrument catalog source.
- **`GET /market-data/by-type`** → snapshot quotes, **≤100 symbols/request**, **camelCase** fields:
  `bid`, `bidSize`, `ask`, `askSize`, `mid`, `mark`, `last`, `volume`, `open`, `dayHighPrice`,
  `dayLowPrice`, `close`, `prevClose`, `tradingHalted`, … **No greeks/IV.** Params are **singular,
  hyphenated**, array-style: `equity[]=…&equity-option[]=…&index[]=…`. Used for M1 quotes, as a
  snapshot fallback, and for underlying spot.

All payloads validated with Zod `.safeParse()` at the boundary (repo convention).

> Verify at M1: exact nested-chain JSON shape. The migrated schema assumes
> `data.items[].expirations[]` (array) each with `strikes[]` carrying `call`/`put` +
> `call-streamer-symbol`/`put-streamer-symbol`, which matches the known live format; the doc's prose
> ("object keyed by expiration") is imprecise. Capture a live fixture and lock the schema to it.

## 6. DXLink streaming layer

Connection uses the `dxlink-url` from the quote-token response; AUTH uses the quote `token`.
Protocol (confirmed from docs), driven by a state machine in `dxlink-client.ts`:

```
SETUP {type:SETUP,channel:0,version:"0.1-DXF-JS/0.3.0",keepaliveTimeout:60,acceptKeepaliveTimeout:60}
  <- AUTH_STATE UNAUTHORIZED
AUTH  {type:AUTH,channel:0,token:<quote-token>}                 <- AUTH_STATE AUTHORIZED
CHANNEL_REQUEST {type:CHANNEL_REQUEST,channel:1,service:FEED,parameters:{contract:AUTO}}
  <- CHANNEL_OPENED
FEED_SETUP {channel:1,acceptAggregationPeriod:0.1,acceptDataFormat:"COMPACT",acceptEventFields:{…}}
  <- FEED_CONFIG
FEED_SUBSCRIPTION {channel:1,add:[{type,symbol},…]} / {remove:[…]}
  <- FEED_DATA  (streaming)
KEEPALIVE {type:KEEPALIVE,channel:0}  every 30s (60s timeout)
```

**Transport reuse:** wrap core `TopicWsClient` for connect/reconnect/backoff/keepalive. `onOpen`
sends SETUP; the handshake (AUTH → CHANNEL → FEED_SETUP) advances in the message state machine;
once `FEED_CONFIG` arrives, replay the active subscription set (don't use `getReplayMessages`, which
fires before the channel is open). `pingMessage = {type:KEEPALIVE,channel:0}`, `pingIntervalMs =
30000`.

**`acceptEventFields` (COMPACT):**

| Event | Fields (order matters) | Maps to |
|---|---|---|
| `Quote` | eventType, eventSymbol, bidPrice, askPrice, bidSize, askSize | bid, ask, bidSize, askSize |
| `Greeks` | eventType, eventSymbol, volatility, delta, gamma, theta, rho, vega | iv (=volatility, fraction), delta, gamma, theta, rho, vega |
| `Trade` | eventType, eventSymbol, price, dayVolume, size | last (=price), volume (=dayVolume) |
| `Summary` | eventType, eventSymbol, openInterest, prevDayClosePrice | openInterest |

`mark`/`mid` = `(bid + ask) / 2` (DXFeed exposes no mark — compute it). `underlyingPrice` comes from
subscribing to each underlying's own symbol (`SPX`, `AAPL`, …) `Trade`/`Quote` and stamping the
latest spot onto that underlying's option quotes.

**COMPACT FEED_DATA parsing (`codec.ts`):** a frame is `data: [EventName, flat[]]`. Chunk `flat` by
`acceptEventFields[EventName].length`; each chunk is `[eventType, eventSymbol, …fields]` mapped
positionally. Coerce `"NaN"`/`"Infinity"` strings → `null`; numbers may be scientific notation
(`1.3743299E7`). IV is already a fraction — no conversion.

**Subscription per chain:** for each contract `streamer-symbol`, add `Quote`+`Greeks`+`Trade`+
`Summary`; add the underlying symbols once. `remove` on release (ref-counted in `feed.ts`).

**Token lifecycle:** quote token is 24h. Refresh proactively; on AUTH failure or token expiry,
re-fetch the quote token and reconnect/re-AUTH.

## 7. Runtime (own store + chain assembly)

- `runtime/store.ts` — `Map<streamerSymbol, LiveQuote>`, `Map<streamerSymbol, Instrument>`,
  `Map<underlying, spotPrice>`. Its own; not the crypto QuoteStore.
- `runtime/chain.ts` — filter instruments by `underlying + expiry`, assemble a **`ComparisonChain`**
  (reusing core canonical types), then call **core enrichment** to compute ATM IV, 25Δ skew, GEX,
  IV surface, term structure. Response shape aligns with the existing chain snapshot so the web
  chain renderer can be reused in the UI phase.

**Instrument model** (`instrument.ts`): underlying, expiry (YYYY-MM-DD), expiryTs (from
`expires-at`), strike, right, occSymbol, streamerSymbol, exerciseStyle, settlementType, multiplier
(`shares-per-contract`), rootSymbol. Canonical symbol: `BASE/USD:USD-YYMMDD-STRIKE-C/P` (e.g.
`SPX/USD:USD-260620-5000-C`), reusing the core builder. All linear/USD (`inverse:false`).

**Fees:** listed-options fees are fixed-per-contract (not rate×underlying), so the crypto fee model
doesn't apply. v1 returns `estimatedFees: null`; real per-contract fee modeling is a follow-up — it
does not block data.

## 8. Routes (the service's own Fastify app)

- `GET /venues` — TradFi venue descriptor(s) + capabilities.
- `GET /underlyings` — the configured underlyings that loaded successfully.
- `GET /expiries?underlying=AAPL` — expiries (+ exact `expiryTs` from `expires-at`).
- `GET /chains?underlying=AAPL&expiry=YYYY-MM-DD` — enriched `ComparisonChain` + stats. **Acceptance
  target.** Lazily subscribes the requested chain on first request (ref-counted), returns the
  current store snapshot; DXLink keeps it fresh.
- `WS /ws/chain` — coalesced live snapshot push (M3; feeds the later UI). Mirrors the v1 200ms-push
  pattern but reads the TradFi store.

Routes never import crypto adapters. Bootstrap (`app.ts`) logs in via OAuth, loads markets, opens
DXLink; readiness gates `/chains` until the first load completes (mirrors the server's `isReady`).

## 9. Default symbols

`SPX, NDX, SPY, QQQ, AAPL, NVDA, TSLA` (env-overridable via `TRADFI_UNDERLYINGS`). SPX/NDX are
cash-settled European index options (the equity-world stand-ins for ES/NQ) with extended hours;
SPY/QQQ/AAPL/NVDA/TSLA are American-style. Exercise/settlement captured per contract, so mixing is
fine.

## 10. Deletions / migration — **Option A (leave v1 vestigial)**

Two buckets: delete the purely-additive dead files; leave the v1-route asset-class machinery in
place as a vestigial no-op. Chosen for lowest risk — the working crypto routes stay byte-unchanged.

**Delete** (additive scaffold, zero risk to crypto):
- `packages/server/src/routes/v2/**` and its registration in `app.ts`.
- `packages/core/src/feeds/tastytrade/**` and its `core/index.ts` exports — but **first migrate** the
  useful Zod schemas + state shapes into `packages/tradfi`.

**Keep, unchanged, as vestigial no-ops** (do NOT touch working v1 crypto routes):
- The asset-class filtering in v1 routes (`chains.ts`, `expiries.ts`, `surface.ts`,
  `underlyings.ts`, `venues.ts`) stays as `getAdaptersByAssetClass('crypto')`. With no tradfi
  adapter ever registered in the crypto process, it returns all adapters — runtime-identical to the
  pre-`d670b39` behavior. Crypto routes end up byte-unchanged.
- `packages/server/src/asset-class.ts`, the `AssetClass` type + `assetClass` field
  (`shared/types.ts`, `base.ts`), and the `tastytrade` entry in the `sdk-base.ts` `FEE_CAP` map
  (required while `tastytrade` stays in `VENUE_IDS`).
- The `tastytrade` entry in protocol `VENUE_IDS` — leave it (least churn; keeps `FEE_CAP` and shared
  `VenueId` typing valid).

**The only edit to crypto-side code:** add one comment at `asset-class.ts` (the abstraction's hub)
noting it is vestigial after TradFi became a separate service — v1 always serves all (crypto)
adapters; kept deliberately to avoid editing the working v1 routes.

This is scoped handling of the superseded scaffold — not unrelated refactoring.

## 11. Data flow

```
bootstrap:  OAuth refresh -> access token
            GET /api-quote-tokens -> quote token + dxlink-url
            GET /option-chains/{sym}/nested  (x7)  -> instrument catalog
            DXLink: SETUP/AUTH/CHANNEL/FEED_SETUP -> SUBSCRIBE(streamer symbols + underlyings)
            FEED_DATA -> merge -> TradFi store (keyed by streamer symbol)
GET /chains: store -> ComparisonChain -> core enrichment -> JSON  (TradFi port)
```

## 12. Milestones

- **M0 — Scaffold.** Create `packages/tradfi` in the workspace (pnpm + tsconfig + scripts); empty
  Fastify app on `TRADFI_PORT`; perform §10 deletions/migration. Repo green
  (`pnpm typecheck` + `pnpm test`).
- **M1 — REST proof (live Go/No-Go).** `auth` + `rest` + `feed.loadMarkets` + store +
  `/underlyings` + `/expiries` + `/chains` returning real bid/ask/mark/last via
  `market-data/by-type` (no greeks yet). Validates OAuth creds + endpoints against the live account.
- **M2 — DXLink live.** `dxlink-client` + `codec` + `planner` + `state` merge → store populated with
  streaming quotes + greeks/IV; `/chains` returns the full enriched chain. Acceptance target met.
- **M3 — Polish.** Market-hours/health, token refresh, reconnect hardening, `WS /ws/chain` push;
  doc-driven fixtures + tests.

## 13. Testing

Doc-driven (repo convention). Capture **real, secret-masked** payloads into
`references/options-docs/tastytrade/{rest,dxlink}/` (currently empty), then fixture:
`types.test.ts` (all schemas), `codec.test.ts` (COMPACT parse incl. `"NaN"`/scientific notation,
frame builders), `planner.test.ts` (sub add/remove diff), `health.test.ts` (market hours),
`auth.test.ts` (token cache/refresh with mocked fetch). `pnpm precommit` (typecheck + test) green.

## 14. Out of scope (later phases)

- Web: TRADFI button + black theme + CHAIN page in `packages/web`.
- ES/NQ **futures** options (`/futures-option-chains` + CME entitlement) — added once the account is
  confirmed entitled; same venue, different endpoint/symbology.
- Deploy routing on the Scaleway box (new port/unit behind e.g. `tradfi-api.oggregator.xyz`).
- Order placement / account streamer (we use scope `read` only).

## 15. Risks / verify-at-implementation

- OAuth `/oauth/token` body encoding (form vs JSON) — capture live at M1.
- Exact nested-chain JSON shape — lock schema to a live fixture at M1.
- DXLink behavior for index symbols (SPX `.SPXW…` streamer symbols; SPX index spot) — verify at M2.
- REST `market-data/by-type` 100-symbol cap — batch large chains (e.g. SPX) into ≤100-symbol calls.
- Outside market hours DXLink emits few/no events (normal) — health = `market-closed`, show last
  known; do not treat silence as a fault.
</content>
</invoke>
