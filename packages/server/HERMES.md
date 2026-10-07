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
    - skills          # see "Shared learning (skills)" for the required memory/skills keys
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

## Session isolation

Every Ask Hermes request is its own Hermes session, so no state crosses users or threads.
Oggregator owns the history and sends all of it on each request. Paths are in
`~/.hermes/hermes-agent`:

- Hermes ignores the OpenAI `user` field. Without `X-Hermes-Session-Id`, `/v1/chat/completions`
  uses session `api-` + sha256(system prompt + first user message)[:16]
  (`gateway/platforms/api_server.py:1045`, `api_server_openai_routes.py:650-655`). Two requests
  with the same system prompt and context would share that session.
- Keyed by that id: the state.db transcript the turn appends to (`agent/session_persistence.py:262`),
  the system prompt restored from the row (`agent/conversation_loop.py:668-709`), the parked memory
  manager (`api_server_memory_sessions.py`, `api_server.py:2267,4097`), the tool `task_id`
  (`api_server.py:4038`), and the durable turn lease (`agent/turn_facade_lease.py:238-309`). A turn
  that waits on that lease replaces its history with the state.db transcript, which could carry
  another user's turns and `portfolioRef`.
- `X-Hermes-Session-Id` is no fix: it replaces the request's history with the state.db
  transcript and keeps only the last message (`api_server_openai_routes.py:618-648`). That drops
  the context message and our history. `X-Hermes-Session-Key` sets the memory and prompt-cache
  scope but not the session id on this route (`api_server_openai_routes.py:613-616`). Neither is sent.
- The api_server builds a new `AIAgent` for each request (`api_server.py:2195-2275`). Agent
  instances are never cached between requests.

The gateway therefore adds a second system message with a fresh `ogg_scope_` value (16 random
bytes) to each request (`buildHermesChatMessages`). Hermes joins it into the system prompt, so the
derived session id is new for every request. It never reuses a row, waits on a lease or loads
stored history. The thread id is not sent. Hermes appends the system prompt after its own core
prompt (`agent/chat_completion_helpers.py:2176`), so the scope sits just before the per-request
context. Prompt-cache reuse is unaffected.

Profile-wide stores remain shared by every chat on the profile. Background review only writes
memory or skills when the `memory` or `skill_manage` tool is enabled (`agent/turn_finalizer.py:682-685`,
`agent/turn_context.py:712`). Keep built-in memory off and configure no `memory.provider`: either
would carry one user's conversation into other users' prompts. The `skills` toolset is enabled
only behind the owner approval gate in [Shared learning (skills)](#shared-learning-skills).

## Shared learning (skills)

Ask Hermes learns shared, non-private knowledge only as Hermes skills on the profile. Skills are
listed in every chat's system prompt, so nothing reaches them without owner approval. Per-user
memory lives in Oggregator; see [Per-user memory](#per-user-memory).

Profile config (`~/.hermes/profiles/portfolio-chat/config.yaml`; `portfolio-chat-eval` has the
same memory/skills keys):

```yaml
platform_toolsets:
  api_server: [mcp-oggregator, skills]
memory:
  memory_enabled: false
  user_profile_enabled: false
  write_approval: true     # defense in depth; the memory tool is absent anyway
  provider: ""
skills:
  write_approval: true     # every skill_manage write is staged
  guard_agent_created: true
```

Curator and `auxiliary.background_review` keep their defaults. `session_search` stays off.
The api_server re-reads config and resolves toolsets on every request
(`gateway/platforms/api_server.py:2231-2232`), so edits apply to the next chat.

What is learned:

- Book knowledge skills in category `options-trading`: a lean `SKILL.md` plus `references/`
  per chapter, citing `PDF p. N` and labelling equity-market examples. Applied:
  `sinclair-volatility-trading`. Staged, awaiting owner approval: `bennett-trading-volatility`.
  Not learned: Casanovas, Natenberg (0 bytes) and `PDF_AuctionPricing.pdf`. Answers still cite
  only passages `search_options_library` returned.
- Native `/learn` cannot read these PDFs: `read_file` extracts PDFs with anydoc, which rejects
  the whole file when any page is a scan (`NeedsOcrError`, Sinclair p. 1, Bennett p. 83,
  Casanovas p. 88), and hosted OCR is off (`tools/read_extract.py:205-236`,
  `tools/file_tools.py:421-450`). The two book skills were learned from page-marked text
  extractions outside Hermes.
- Generic procedures Hermes proposes with `skill_manage`, in a chat turn or in the background
  review. These are staged and never apply without approval.

Not learned: questions, answers, portfolios, positions, fills, `portfolioRef` or anything else
from a conversation. Built-in memory (`MEMORY.md`, `USER.md`) and memory providers are off.

Approval workflow (interactive CLI on the profile; there is no `hermes skills pending`
subcommand):

```text
hermes -p portfolio-chat
/skills pending          # staged writes with a gist; [auto] marks background review
/skills diff <id>        # full unified diff
/skills approve <id>     # or 'all' (oldest first)
/skills reject <id>      # or 'all'
```

Staged records are JSON files in `~/.hermes/profiles/portfolio-chat/pending/skills/`; the
payload is replayed verbatim on approval. Reject any proposal that mentions a user, a held
position, a size, a quote from a conversation or anything that only holds for one portfolio. Approve
only procedures and principles that hold for every user. Every applied mutation is in
`skills/.curator_ledger.jsonl` (`hermes -p portfolio-chat curator ledger`, `curator rollback
<entry-id>`). Run `/learn` in an interactive session: one-shot `hermes chat -q` hides
`skill_manage` (`agent/oneshot_footprint.py:21`).

Privacy guarantees (paths in `~/.hermes/hermes-agent`):

- The memory tool is not registered when both built-in stores are off
  (`tools/memory_tool.py:229-241`), and the memory review needs that tool
  (`agent/turn_context.py:709-718`).
- With `skills.write_approval: true` every `skill_manage` write stages, whatever its origin
  (`tools/write_approval.py:170-180`). The gate runs before validation or any file write
  (`tools/skill_manager_tool.py:774-780`). Staged writes are invisible to `skills_list` and
  `skill_view` until approved.
- The background review forks after a turn with at least `skills.creation_nudge_interval`
  (default 10) tool iterations (`agent/turn_finalizer.py:682-685`). With memory off it may call
  only the skills toolset, plus `read_file` and `search_files` when the parent advertises them,
  which the api_server profile does not (`agent/background_review.py:1087-1102`). It never loads
  a memory provider (`:918-930`). It reads the whole conversation, so a proposal can contain
  private data; staging is what keeps it out of shared state.
- Known limitation: the api_server builds a new agent per request, so the iteration counter
  never carries across requests. The skill review fires only inside a single request that uses
  at least 10 tool steps; most chats never trigger it.
- `guard_agent_created` scans applied agent writes for dangerous patterns and turns a dangerous
  verdict into a tool error (`tools/skill_manager_tool.py:51-65`, `tools/skills_guard.py:32`).
  It is a scanner, not an approval gate.
- The curator prunes by default (consolidation off) and only manages skills the background
  review created. `/learn` skills are `created_by: learn` and left alone
  (`website/docs/user-guide/features/curator.md`, "What agent-created means").
- Skill usage records hold counters and timestamps only (`tools/skill_usage.py:490-505`).
  Shared-metrics telemetry is off by default (`hermes_cli/config_defaults.py:2290-2295`).

## Per-user memory

Oggregator keeps a small memory per user and sends it only with that user's own requests.
Hermes's built-in memory stays off because it is shared by every user of the profile.

Storage: `portfolio_assistant_user_memory` (migration `0029`), one row per `user_id` with
`items` (at most 12 `{id, text, category, sourceThreadId?, updatedAt}`), `content` (the rendered
list, at most 1,500 characters), `last_distilled_at` and `updated_at`. Every query is keyed by
`user_id`. Categories: `risk_budget`, `preferred_structures`, `experience_level`,
`explanation_style`, `venues`, `goals`, `explicit_note`.

Distillation runs once a day on the same restart-proof `FlushSchedule` as the deferred
market-data stores (marker `.cache/portfolio-assistant-memory.last-flush`, override with
`PORTFOLIO_ASSISTANT_MEMORY_SCHEDULE_PATH`; first run 60 s after a start with no marker):

- Candidates: entitled users with a completed answer newer than their `last_distilled_at` and
  the 7-day lookback, oldest watermark first, at most `PORTFOLIO_ASSISTANT_MEMORY_MAX_USERS_PER_RUN`
  (default 25) per run, one at a time.
- Input per user: their newest 40 completed messages since the watermark (user text up to 1,500
  characters, answers up to 400 and marked as context only), threads labelled `T1`, `T2`, and
  their current items with ids. No portfolio context message is sent; the distillation prompt
  says not to call tools and to reply with JSON only.
- The reply must parse as `{"items":[{category,text,source?,replaces?}],"forget":[ids]}`
  (Zod). Prose, broken JSON or a schema mismatch writes nothing; the next run retries.
- Merge: every item passes a deterministic filter that rejects identifiers (`pref_`, UUIDs,
  wallets, account IDs, emails, long tokens), instrument names, positions, PnL and balances,
  dates and time-relative phrases, and any amount outside `risk_budget`. New items win over
  `replaces`/`forget` targets, identical text and an older `experience_level`; the result is
  newest first, capped at 12 items and 1,500 characters.
- One upsert per user per run, guarded by the `updated_at` read before the model call: a delete
  made while the model was running wins and the write is skipped (`conflict`).
- Each call takes a slot from the chat concurrency cap (`PORTFOLIO_ASSISTANT_MAX_CONCURRENT_REQUESTS`)
  under its own key, so a busy cap defers the user to the next run without blocking their chat.
  It counts in `/api/health` `runtime.portfolioAssistant.activeRequests`, not in chat completion
  metrics, and not against the user's daily question allowance (no `portfolio_assistant_usage`
  row). `provider_allowance_exhausted` or `provider_unavailable` stops the rest of the run.
- Logs: `portfolio assistant memory distilled` (per user: `userIdHash`, counts, rejection
  reasons, tokens; never item text) and `portfolio assistant memory distillation run completed`.

Use: the conversation service loads the asking user's items and the context carries
`userMemoryFacts: { items: [{category, text}], updatedAt } | null`. A failed read sends null.
The prompt treats it as defaults that the current context and the user's message override.
`PORTFOLIO_ASSISTANT_MEMORY_ENABLED=false` stops both distillation and injection.

User control (same bearer auth as the other assistant routes):

| Route | Effect |
| --- | --- |
| `GET /api/portfolio/assistant/memory` | The caller's items (requires the entitlement) |
| `DELETE /api/portfolio/assistant/memory` | Clears every item; keeps an empty row whose watermark stops older chats being re-learned |
| `DELETE /api/portfolio/assistant/memory/items/:itemId` | Removes one item; 404 when the caller has no such item |

Deletes write immediately and do not require the entitlement. The web panel's "Memory" toggle
shows "What Hermes remembers" with per-item delete and "Forget all".

Limits: only threads that still exist at the daily run are read, so a chat cleared with "New
chat" before then is never distilled. Deleting a thread does not remove items learned from it.

## Feedback

Users rate each completed answer with a thumbs up or down. A thumbs down records at once and opens
optional reason chips (`wrong_numbers`, `did_not_answer`, `too_long`, `refused`, `other`) and a note
of at most 200 characters. One vote per user per message; a later vote replaces it.

| Route (same bearer auth, requires the entitlement) | Effect |
| --- | --- |
| `POST /api/portfolio/assistant/threads/:threadId/messages/:messageId/feedback` | `{vote:"up"}` or `{vote:"down", reasons?, note?}`; 404 unless the caller owns the thread and the assistant message, 409 while the answer is not `complete` |
| `GET /api/portfolio/assistant/threads/:threadId/feedback` | The caller's votes in that thread (buffer merged over the table) |

Storage: votes go to a local NDJSON outbox (`.cache/portfolio-assistant-feedback.ndjson`, override
`PORTFOLIO_ASSISTANT_FEEDBACK_CACHE_PATH`), rewritten on each vote and read back on start. The same
restart-proof `FlushSchedule` as the market-data stores (marker `...ndjson.last-flush`, first run
60 s after a start with no marker) writes the whole outbox to `portfolio_assistant_feedback`
(migration `0030`) once a day as one `INSERT ... ON CONFLICT` statement. The statement joins
messages and threads on the voter, so a vote whose thread was deleted or expired is skipped, and the
newest `updated_at` wins. A failed flush keeps the outbox and retries after 15 minutes. Shutdown does
not flush. The outbox holds at most 20,000 votes; new votes beyond that get 503.

Table: primary key `(user_id, message_id)`, `thread_id`, `vote`, `reasons text[]`, `note`,
`run_telemetry jsonb`, `created_at`, `updated_at`. It cascades from `users`, `portfolio_assistant_threads`
and `portfolio_assistant_messages`, so "New chat" (which deletes the thread) and the 30-day thread
retention delete the votes too; "New chat" also drops that thread's buffered votes.

Run telemetry: the conversation service keeps the last 2,000 run summaries for 24 h in memory, keyed
by assistant message id (`requestId`, outcome, error code, duration, model, tool-call counts). A vote
copies the summary into `run_telemetry`. A vote cast after a backend restart or later than 24 h has
none; the `portfolio assistant model run completed` log line carries `assistantMessageId`, so the run
is still findable in the journal while it is retained.

Metrics: `/api/health` `runtime.portfolioAssistant.feedback` has counts only, since process start:
`votesTotal.{up,down}` (a re-submitted identical vote is not counted again), `downReasonsTotal`,
`changedTotal`, `pendingVotes` (current outbox size), `flushedTotal`, `flushSkippedTotal`.

Owner review (read-only; never automatic):

```bash
pnpm --filter @oggregator/server assistant:feedback-report              # last 30 days
pnpm --filter @oggregator/server assistant:feedback-report -- --since-days 7
```

It reads the table inside `READ ONLY` transactions plus the local outbox, and writes
`packages/server/.eval-out/feedback-<date>/report.md` and `summary.json` (gitignored, mode 600).
`report.md` has totals, down-vote reasons, telemetry coverage, every down-voted answer with its
question, answer, note and run summary (user ids as the first 16 hex of the `userIdHash` digest),
and "Candidate eval fixtures": failure patterns grouped by question topic, reasons and tool profile,
with the existing fixtures on that topic and suggested checks. `summary.json` holds only counts and
patterns, no user content. Turn patterns into synthetic fixtures (`src/assistant-eval/EVAL.md`).
Feedback never reaches Hermes skills or memory: do not paste report content into `/learn`,
`skill_manage` or a fixture.

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
