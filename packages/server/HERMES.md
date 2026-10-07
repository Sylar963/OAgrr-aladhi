# Hermes platform data access

Oggregator sends authenticated portfolio context with each chat question. Hermes's
`portfolio-chat` profile executes public market tools through the separate loopback
MCP listener. The Oggregator chat gateway itself does not execute model tool calls.

## Connection

1. Set `OGG_ASSISTANT_MCP_TOKEN` to a random secret of at least 32 characters in
   the backend environment. `OGG_ASSISTANT_MCP_PORT` defaults to `3191`.
2. Set the same secret in the Hermes `portfolio-chat` profile environment.
3. Configure the profile:

```yaml
platform_toolsets:
  api_server:
    - mcp-oggregator
mcp_servers:
  oggregator:
    url: http://127.0.0.1:3191/mcp
    headers:
      Authorization: Bearer ${OGG_ASSISTANT_MCP_TOKEN}
    trust: full
    timeout: 30
    connect_timeout: 15
    supports_parallel_tool_calls: true
    tools:
      resources: false
      prompts: false
```

`trust: full` applies only to this controlled, read-only server. The server exposes
an explicit tool registry; no arbitrary URLs, SQL, shell, private account queries,
or order mutations. Every tool requires bearer authentication. Keep the listener
on loopback; a remote or containerized Hermes needs a private network arrangement.

4. Point `HERMES_PORTFOLIO_API_URL` at the profile route, normally
   `http://127.0.0.1:8642/p/portfolio-chat/v1`. The chat API key is a separate secret.
5. Build the server and restart `ogg-backend.service`. Restart
   `hermes-gateway.service` after tool registry changes so cached discovery refreshes.

## Available tools

| Tool suffix | Data |
| --- | --- |
| list_underlyings / list_expiries | Listed symbols and actual expiries |
| market_overview | Spot, DVOL and volatility context |
| option_chain | Cross-venue strikes, quotes, Greeks, OI and volume |
| vol_surface / iv_history | Smile, term structure and IV history |
| gamma_exposure / block_flow | GEX and institutional blocks |
| trade_flow | Up to 50 recent live option trades |
| spot_candles | Up to 200 OHLC candles for BTC, ETH or HYPE |
| news | Up to 30 platform news items with timestamps and source URLs |
| feed_health | Feed readiness, connections and last-message ages |
| straddle_scanner | Existing Alpha scan with explicit equity and risk inputs |
| lotto_scanner | Existing Alpha scan with explicit premium cap and buying power |
| put_scanner | Alpha Long Put scan, ranked by protection for a hedge quantity or by convexity for outright bearish puts |
| search_options_library | Indexed book passages with page citations |
| evaluate_structure | Proposed legs (± held book via `portfolioRef`) at executable quotes: cost, fees, worst loss, best profit and breakevens per expiry window, budget fit, horizon and expiry P&L |
| structure_search | Candidates for a view (bearish, bullish, long_vol, hedge_held_shorts) within a book-wide risk budget, ranked by P&L at a target move per dollar of worst loss; repair + view packages when the held book is unbounded or over budget; `nearestInfeasible`, `repairOnly` and the shortfall when nothing fits |

Names have the `oggregator_` prefix except `search_options_library`. Hermes may
expose a further `mcp__oggregator__` prefix during discovery.

Scanner inputs are hypothetical sizing parameters, not live balances. Results
retain platform config, errors, exclusions and model assumptions. Scanner fetches
have a 25-second timeout; other reader calls default to 5 seconds. New platform
tools return source and retrieval time; item timestamps remain authoritative for
freshness. News content is untrusted data. No additional market-data provider or
vendor subscription is introduced; tool results still consume model context.

## Verification

Ask Hermes to list BTC expiries and fetch a chain for an expiry outside the held
portfolio. Then ask it to check feed health and recent trade flow. Confirm both:

- Backend logs contain `assistant mcp tool call` with the expected tool names.
- Hermes profile logs contain completed `mcp__oggregator__...` calls.

Backend log lines:

- `assistant mcp tool call`: exactly one per `tools/call`, any outcome. Fields: `tool`,
  `outcome` (`ok` info; `rejected_input`, `timeout` warn; `failed` error), `durationMs`,
  `resultChars`, `attribution`, plus `requestId` when attributed, `candidateRuns` when
  ambiguous, `portfolioRefHash` (12 hex chars of SHA-256, never the ref) when the call
  carried a ref, `code` (the wire error code) for every non-`ok` outcome,
  `heldBook: "unresolved"` with `heldBookReason` on an `ok` structure call whose ref did not
  resolve, and `rejection`/`issues`/`reason`/`err` by outcome.
- `attribution`: `exact` (the call's `portfolioRef` belongs to an in-flight chat run),
  `single_active` (no ref, one run in flight), `ambiguous` (no ref, several in flight; never
  guessed), `none` (no run in flight, or a ref from no in-flight run). The in-process run
  registry holds at most 256 runs for at most 15 minutes and stores only `requestId`,
  `userIdHash`, `threadId` and the ref.
- `portfolio assistant model run completed` carries `toolCalls` {`total`, `byTool`, `failed`,
  `timedOut`, `rejected`, `exactAttributed`} over calls attributed `exact` or
  `single_active` to that `requestId`. `/api/health` `runtime.portfolioAssistant.toolCalls`
  holds per-tool counts, failures and latency and attribution totals since boot.

A successful direct `tools/list` request proves server availability, not agent
integration. A fluent answer is not sufficient evidence of tool use.

## Tool errors and the Hermes circuit breaker

Hermes keeps one breaker per MCP server connection (per profile, shared by every chat on it),
in `~/.hermes/hermes-agent/tools/mcp_tool.py` and `tools/mcp_tool_handlers.py`:

- `_CIRCUIT_BREAKER_THRESHOLD, _CIRCUIT_BREAKER_COOLDOWN_SEC = 3, 60.0`. Three consecutive
  strikes pause every call to the server for 60 s; the next call after the cooldown is a probe.
- A strike is a result with `isError: true` (rendered as `{"error": ...}` and caught by
  `_result_is_error`), any exception from `tools/call` (JSON-RPC error, transport failure, or
  the 30 s tool timeout), or a missing session. Any other result resets the count.

So the server returns every recoverable condition as a normal result whose text is
`{ "ok": false, "code", "error", "hint", "retryable" }`: invalid params or arguments, unknown
tool, missing ref for `hedge_held_shorts`, an unresolvable ref there, unknown expiry
(`not_found`), no spot, datasets unavailable in the eval, upstream `loading`/non-200 replies
(`upstream_unavailable`, `upstream_error`) and reader timeouts (`timeout`). Only an unexpected
exception (`failed`, code `internal_error`) sets `isError`. The log `outcome` is unchanged by
the wire format, so `rejected_input`, `timeout` and `failed` stay distinguishable in logs and
`/api/health` metrics.

Private portfolio positions, scenarios and venue trade history remain scoped to the
authenticated context attached by Oggregator. For Thalex and Derive portfolios the
context includes `tradeHistoryFacts`: the 100 most recent fills (30 when compacted)
from the Postgres trade ledger, filtered to the thread underlying, and `totals` over
exactly the listed fills (recomputed after compaction): fill count, first and last fill,
fees with the count of fills without a fee, premium bought and sold, realized PnL with
the counts of fills with and without it (null when none report it), fees over the newest
5/10/20 fills, and a per-instrument breakdown capped at 10. Lifetime totals
stay in `accountingFacts`. The ledger fills while the venue connection is active, so
history starts at the first sync (`historyFromMs`). This MCP connection does not provide all private
platform data or the separate TradFi backend. New private tools require server-bound
user scope; never accept a model-provided account ID as authorization.

## Portfolio context fields for tools

- `portfolioRef`: opaque handle to the book in this context. Pass it to the two structure
  tools; no other tool accepts it (scope below).
- `riskBudgetFacts`: per-expiry `riskWindows`, book-wide `worstLossUsd` (null when unbounded
  or unavailable; `note` says which), `unboundedAfter`, and `uncoveredShorts`. Answers about
  max loss or budgets for mixed-expiry books read this, not the final-expiry payoff alone.
  Each window also carries `bestProfitUsd` (null when uncapped), `bestProfitSpotUsd` and
  `breakevenSpotsUsd` (whole dollars), all on one spot path
  (`docs/knowledge/options-trading.md`). In `oggregator_evaluate_structure` output every
  window value is after the proposed legs' fees.
- `toolHints`: fixed strings naming which tools take `portfolioRef` and when to call them.
  They are static guidance, not per-request state.

## portfolioRef scope

Each chat context carries `portfolioRef`, an opaque `pref_` token (16 random bytes). The
backend maps it in memory to the account, portfolio source and underlying of that context.
Its 15-minute TTL slides: each successful resolve renews it, and a ref whose chat run is still
in flight in the run registry is renewed even past the TTL. No ref lives more than 60 minutes
from minting. The store keeps at most 1,000 refs (least recently used evicted), and
nothing is persisted, so a backend restart revokes every ref. `oggregator_evaluate_structure`
and `oggregator_structure_search` resolve the ref in-process to the live runtime's legs and
marks; the model never passes account IDs or held legs. An unknown, expired or
mismatched-underlying ref, or a book that fails to load, does not fail the call: the proposed
legs are evaluated alone and `heldBook` is `{ status: "unresolved", reason, message, hint }`
with a leading note that the numbers are not book-wide. Without a ref the tools evaluate the
proposed legs alone (`heldBook.status: "not_requested"`). `hedge_held_shorts` needs the book and
returns `portfolio_ref_required` or `portfolio_ref_unresolved`. Proposed legs are priced only from Oggregator quotes (buy
at ask, sell at bid). Fees use the venue taker estimate; when a venue gives none, a conservative
default of min(0.05% of underlying, 12.5% of premium) per contract is applied and flagged
`feeSource: "default_estimate"`. A leg without an executable quote is reported as an error and
nothing is evaluated. Worst loss is measured from those executable entries and includes the
proposed legs' fees. Tool logs carry a short hash of the ref, never the ref.

`oggregator_structure_search` reads up to 6 listed expiries (the held legs' expiries first,
for closing and cover quotes, then the DTE window), strikes within ±20% of each forward plus
the held strikes, and evaluates at most 600 candidates, nearest the money first, with the same
engine as `evaluate_structure`, under an 8-second evaluation budget (`stats.stoppedEarly`).
Each chain read has the 5-second reader timeout and runs in parallel, so a search stays well
inside the profile's 30-second MCP timeout; the reference-book package search on the eval
fixture chain takes under 1 s (asserted below 5 s in `eval-mcp-server.test.ts`).

When a resolved book is unbounded or its worst loss is already beyond `maxTotalRiskUsd`, the
bearish, bullish and long_vol views add packages. Repairs considered: the cheapest same-expiry
cover of each uncovered short, buying the shorts back (every held short when none is
uncovered), and closing the whole book. Each is evaluated alone against the book; the one with
the highest book-wide worst loss (then lowest cost) is `repair.chosen`. Every view structure is
then evaluated with that repair, book-wide with fees, and each candidate lists `components`
(`repair`, `view`) and per-leg `role`. Packages rank by book P&L at the target per dollar of
book-wide worst loss (`rankedBy: "book_reward_to_risk"`), gaining packages first. When nothing
fits, `repairOnly` is the chosen repair alone with its own `fits`/`shortfallUsd`, and
`nearestInfeasible` the closest packages with their exact shortfall.
