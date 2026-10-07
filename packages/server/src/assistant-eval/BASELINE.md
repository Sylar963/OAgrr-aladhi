# Ask Hermes eval baseline

- **Date:** 2026-10-07 (run `2026-10-07T02-58-24-632Z`, 02:58–03:04 UTC)
- **Model:** `portfolio-chat` Hermes profile through `HermesPortfolioAssistantGateway`, with the request timeout from `HERMES_PORTFOLIO_REQUEST_TIMEOUT_MS` (default 90 s)
- **Code under test:** `main` at `23257c04`. Prompt builder, context builder and core engine are unchanged.
- **Fixtures:** 14 synthetic fixtures from `build-fixtures.ts`. Context timestamp is 2026-10-07T12:00Z, and spot is $83,886.66.
- **Result:** 10 of 14 fixtures pass.

These grades come from re-grading the same saved answers with the final graders (`--regrade`). The first
grading pass also gave 10 of 14 but had two grader defects, which were fixed before recording:
1. A text-line structure detector accepted "add bearish exposure ... call spread ... $4,000" as a proposal.
2. The banned-phrase list missed the "I can't propose" and "my previous … were wrong" wordings.

## Pass rate per check

| Check | Pass | Fail | Unverified | N/A | Pass rate |
| --- | --- | --- | --- | --- | --- |
| numbers | 8 | 1 | 0 | 5 | 89% |
| required_mentions | 3 | 1 | 0 | 10 | 75% |
| structure | 5 | 1 | 0 | 8 | 83% |
| banned_phrases | 12 | 2 | 0 | 0 | 86% |
| length | 14 | 0 | 0 | 0 | 100% |
| tools | 2 | 0 | 0 | 12 | 100% |

The tools check used `assistant mcp tool call` lines from the `ogg-backend.service` journal during each
request window. This is reliable evidence only when no other users are active at the same time.

## Per fixture

| Fixture | Result | Failed checks | Notes |
| --- | --- | --- | --- |
| reference-bearish-budget-18 | FAIL | banned_phrases | Reproduces the reference failure. The answer starts with "I can't propose a bearish trade…" and says "My previous +$232.38 and $82,950 figures were wrong". It flags that the $18.05 figure ignores a rally after Oct 16, but its only table prices closing both legs. No tools were called. |
| reference-max-loss | pass | – | Says the loss is unbounded because the short Oct 30 call stays open after Oct 16. |
| reference-cap-upside | pass | – | Proposes buying an Oct 30 $90k call, priced with a live `option_chain` call. |
| budget-bearish-long-call | pass | – | 0.5× Nov 27 80k/74k put spread. Book max loss $1,175 combined to $1,902.50, under the $2,200 budget. |
| budget-bullish-bear-put-spread | pass | – | |
| budget-long-vol-condor | pass | – | Oct 16 strangle. The answer notes that live tool quotes differ from the fixture snapshot. |
| horizon-plus5-10d | pass | – | Exact cell figures: −$1,050.89 at $88,080.99. |
| horizon-minus10-7d-by-expiry | pass | – | |
| trade-history-fees | FAIL | numbers | Says "the supplied context has no fill-level trade history", although `tradeHistoryFacts` lists 9 fills. Falls back to `accountingFacts.knownFeesUsd`. |
| trade-history-realized | pass | – | The numbers match, but Hermes took them from the position entry price and `accountingFacts`, and again says that fills are not available. |
| market-flow-and-health | pass | – | Called trade_flow, feed_health, market_overview and vol_surface. |
| market-off-book-chain | pass | – | Called list_expiries and option_chain. |
| stale-history-followup | FAIL | banned_phrases | Gives the correct −5%/3d cell (+$1,274.56), then adds "My earlier 'down $302.88 at $86,400' figure was wrong." |
| infeasible-budget-bear-call-spread | FAIL | required_mentions, structure | States the $4,000 existing max loss and advises closing first. It gives neither a concrete structure nor the dollar gap. |

## Reading the results

- **Phase 0 acceptance:** the reference fixture fails on current code for the expected reasons: it refuses and apologises for stale figures.
- **Structure check was lenient.** On the reference fixture it passed because a closing-cost table counted as a proposal. Phase 3 tightened it; see the re-grade below.
- **Required numbers come from the engine.** In `trade-history-realized` the right numbers can come from the wrong source, so a numeric pass does not prove the answer read `tradeHistoryFacts`.
- **Live tools vs synthetic market.** Fixture contexts use a deterministic synthetic market, while MCP tools return live data. Answers that call tools can see different spots or quotes, or a different "now", than the context. Do not compare tool-dependent fixtures number for number.
- **One sample per fixture.** Answers are non-deterministic. Before claiming a regression or an improvement on a single fixture, rerun it (`--fixture <id>`).

## Re-grade after the Phase 3 structure grader change (2026-10-07)

Fixtures that ask for a new trade now carry `expect.requireNewLeg: true` (reference-bearish-budget-18,
the three budget-* fixtures and infeasible-budget-bear-call-spread). For them the structure check
passes only if a proposed row or line trades a leg the book does not already hold (a strike, right
or expiry not in `context.positions`), or if `oggregator_structure_search` was observed in the tool
logs, since its candidates can be buy-backs. Strike-like numbers outside 0.5×–2× the held strikes
are ignored as premiums or P&L. reference-cap-upside keeps the old rule: buying back the short is a
valid way to cap it.

Re-grading the same saved answers (`--regrade .eval-out/2026-10-07T02-58-24-632Z`) still gives
**10 of 14** fixtures passing. Only the structure check changes:

| Check | Pass | Fail | Unverified | N/A | Pass rate |
| --- | --- | --- | --- | --- | --- |
| structure | 4 | 2 | 0 | 8 | 67% (was 83%) |

reference-bearish-budget-18 now fails structure as well as banned_phrases: its only table prices
closing the two held legs. The fixture already failed, so the fixture pass rate is unchanged. The
other checks are as above.


## Phase 4 context sizes (2026-10-07)

`JSON.stringify(context).length` per fixture. "Before" is the pre-Phase-4 builder regenerated on the
same core (`90b0ab52` strategy changes included), "after" is the reshaped context. The 160,000-character
budget is unchanged. Expected numbers, questions and history are identical before and after, and
`riskBudgetFacts.worstLossUsd` equals `payoffFacts.maxLossUsd` on every fixture.

| Fixture | Before | After | Reduction |
| --- | --- | --- | --- |
| budget-bearish-long-call | 45,540 | 28,386 | 37.7% |
| budget-bullish-bear-put-spread | 47,041 | 30,304 | 35.6% |
| budget-long-vol-condor | 50,963 | 35,059 | 31.2% |
| horizon-minus10-7d-by-expiry | 89,658 | 61,023 | 31.9% |
| horizon-plus5-10d | 89,658 | 61,023 | 31.9% |
| infeasible-budget-bear-call-spread | 46,939 | 30,135 | 35.8% |
| market-flow-and-health | 45,540 | 28,386 | 37.7% |
| market-off-book-chain | 47,041 | 30,304 | 35.6% |
| reference-bearish-budget-18 | 67,886 | 43,279 | 36.2% |
| reference-cap-upside | 67,886 | 43,279 | 36.2% |
| reference-max-loss | 67,886 | 43,279 | 36.2% |
| stale-history-followup | 47,041 | 30,304 | 35.6% |
| trade-history-fees | 70,119 | 45,391 | 35.3% |
| trade-history-realized | 70,119 | 45,391 | 35.3% |

Where it came from: `payoffFacts` 7.2–8.4k → 2.0–2.8k (22–26 of 61 points, cents, no `forwardPnlUsd`
at `forwardDays = 0`); `shockFacts` 6.5k → 0.8k (axis arrays plus a P&L matrix instead of 81 cell
objects); `heldExpiryChains` lose in-the-money sides beyond ±2% of the forward, except held strikes
(−7k to −19k). Added: `riskBudgetFacts` (0.45–1.0k) and `toolHints` (0.47k). No fixture reaches 60% of
the budget, so the shock-grid trim does not apply to any of them. Answer quality after Phase 4 has not
been measured against Hermes yet.

## Post-rollout (Phase 7, 2026-10-07)

- **Deploy:** protocol, core and server rebuilt; `ogg-backend.service` and `hermes-gateway.service`
  restarted. A direct `tools/list` on the MCP listener returns 18 tools, including
  `oggregator_evaluate_structure`, `oggregator_structure_search` and `oggregator_put_scanner`.
- **Run A** `2026-10-07T04-44-49-643Z`: server code as committed in `ed0f9014` (Phases 0–6).
- **Run B** `2026-10-07T05-04-30-279Z`: `ed0f9014` plus one prompt change (uncommitted at the time
  of the run): procedure step 3 now asks for the dollar excess over the budget, or "unbounded from
  <date>", when the held book already breaks the constraint.

### Pass rate per check

| Check | Baseline (re-graded) | Run A | Run B |
| --- | --- | --- | --- |
| numbers | 89% (8/9) | 100% (9/9) | 100% (9/9) |
| required_mentions | 75% (3/4) | 75% (3/4) | 100% (4/4) |
| structure | 67% (4/6) | 50% (3/6) | 33% (2/6) |
| banned_phrases | 86% (12/14) | 100% (14/14) | 100% (14/14) |
| length | 100% | 100% | 100% |
| tools | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| **fixtures** | **10/14** | **10/14** | **10/14** |

### Per fixture

| Fixture | Baseline | Run A | Run B |
| --- | --- | --- | --- |
| reference-bearish-budget-18 | FAIL banned, structure | FAIL structure | FAIL structure |
| reference-max-loss | pass | pass | pass |
| reference-cap-upside | pass | FAIL structure* | pass |
| budget-bearish-long-call | pass | pass | pass |
| budget-bullish-bear-put-spread | pass | FAIL structure | FAIL structure† |
| budget-long-vol-condor | pass | pass | FAIL structure* |
| horizon-plus5-10d | pass | pass | pass |
| horizon-minus10-7d-by-expiry | pass | pass | pass |
| trade-history-fees | FAIL numbers | pass | pass |
| trade-history-realized | pass | pass | pass |
| market-flow-and-health | pass | pass | pass |
| market-off-book-chain | pass | pass | pass |
| stale-history-followup | FAIL banned | pass | pass |
| infeasible-budget-bear-call-spread | FAIL mentions, structure | FAIL mentions | FAIL structure |

\* Grader false negative: `ACTION_PATTERN` matches `buy` but not `buying`, so "Buying one Oct 30
$90,000 call…" and "Consider buying 0.1 BTC each of the Oct 30 $84,000 call and put" are not seen as
proposals. Re-grading both runs with `buy(?:ing|s)?|sell(?:ing|s)?|bought|sold` gives **11/14** for each.
The grader was not changed in this phase.
† The right ("calls") is only in the table header, and the grader reads rows alone.

What improved: no apologies or "I can't propose" wording in any answer (the stale-history and
reference fixtures previously failed on this), `tradeHistoryFacts` is now read for fees, and the
infeasible-budget answer states the gap after the step 3 change ("**$4,000** … **$2,700 above** your
$1,300 portfolio limit"). The reference fixture still proposes only closing both held legs, which
does not satisfy `requireNewLeg`; it no longer refuses outright.

### Tool usage

From `assistant mcp tool call` lines in the backend journal. Run A: every constraint fixture except
the two reference ones called `oggregator_structure_search` then `oggregator_evaluate_structure` 2–3
times; market fixtures called trade_flow, block_flow, feed_health, market_overview, vol_surface and
option_chain. Run B: only `infeasible-budget-bear-call-spread` logged a successful structure_search;
the other constraint fixtures logged no successful calls. That journal line is written only on success:
calls rejected with a tool input error (such as an unknown `portfolioRef`) are not logged, so the
observed lists understate attempts. The answers themselves report that the reference was rejected.

### Limitations of this eval

- **Fake `portfolioRef`.** Fixtures carry `pref_evalFixtureNotResolvable`, which the live backend
  cannot resolve, so every ref-scoped call errors on the held book. Answers then hedge ("could not
  verify book-wide worst loss") or fall back to standalone evaluation. The structure tools work
  without a ref, but the book-wide budget check, which is the point of Phases 1–3, is not exercised by
  this eval. Constraint-fixture results are a lower bound for production behaviour.
- **Synthetic market vs live tools.** Fixture contexts use the synthetic market at 2026-10-07T12:00Z,
  while tools quote the live market at run time (earlier than the snapshot). Answers note that "quotes
  predate the portfolio snapshot". Do not compare tool-dependent numbers.
- One sample per fixture per run; Run A and Run B differ on fixtures the prompt change does not touch
  (budget-long-vol-condor, reference-cap-upside), which is sampling noise.

## Workstream 3 eval: real refs + synthetic tools (2026-10-07)

### What changed in the harness

- `--mcp eval` (new default) starts the production MCP handler and tool registry in the runner on
  `127.0.0.1:3192` (`createAssistantMcpHandler`, shared with `portfolio-assistant-services.ts`). Each
  sample gets a real `portfolioRef` for the fixture's held book, chain/surface/overview/expiries/IV
  history and both structure tools answer from the fixture's synthetic market at 2026-10-07T12:00Z, and
  tool usage is read exactly from the runner's `AssistantRunRegistry`. Setup and the per-tool data
  sources are in `EVAL.md`.
- `--samples N` (default 3), `--concurrency N` (default 1, max 3). Reports give per-fixture `x/N`, a
  majority verdict, per-check rates over all samples and a Wilson 95% interval.
- Graders: an imperative "Short the …" or "go long" counts as an action, a "Calls"/"Puts" table header
  applies to its rows, and `requireNewLeg` is unchanged. Re-grading the saved runs: Run A 10/14 → 11/14,
  Run B 10/14 → 12/14 (budget-bullish-bear-put-spread now passes; its right is only in the header).

### Status: `--mcp eval` has not been run

The eval needs a Hermes profile `portfolio-chat-eval` whose MCP URL is port 3192. That profile was not
created. `portfolio-chat` holds a profile-local Codex OAuth grant whose refresh token is identical to the
one in `~/.codex/auth.json`, and no root grant exists. Hermes refresh tokens for `openai-codex` are
single-use. A clone carries no `auth.json`, but with `auth.adopt_external_logins` on (the default) Hermes
would adopt `~/.codex/auth.json` into it. That puts the same refresh token in a third place, and the
first holder to refresh revokes it for the others. `EVAL.md` lists the safe setup: an independent device
login for the eval profile, with external adoption turned off first. This needs an interactive login.

### Validation run: `--mcp live`, 3 samples (`2026-10-07T16-48-25-731Z`)

This run uses the old behaviour: the production profile, the fake ref and live tools. It checks the
sampling and grader changes only. It does not measure the book-wide budget path.

**Samples passed: 31/42 (74%, Wilson 95% 59–85%). Fixtures passing by majority: 11/14.**

| Check | Pass | Fail | N/A | Pass rate |
| --- | --- | --- | --- | --- |
| numbers | 21 | 6 | 15 | 78% |
| required_mentions | 9 | 3 | 30 | 75% |
| structure | 9 | 9 | 24 | 50% |
| banned_phrases | 42 | 0 | 0 | 100% |
| length | 42 | 0 | 0 | 100% |
| tools | 6 | 0 | 36 | 100% |

| Fixture | Passed | Failed checks (samples) | Tools (journal, successful calls only) |
| --- | --- | --- | --- |
| budget-bearish-long-call | 2/3 | timeout ×1 | structure_search, evaluate_structure |
| budget-bullish-bear-put-spread | 2/3 | timeout ×1 | structure_search, evaluate_structure |
| budget-long-vol-condor | 1/3 | timeout ×2 | structure_search, evaluate_structure |
| horizon-minus10-7d-by-expiry | 3/3 | – | – |
| horizon-plus5-10d | 3/3 | – | – |
| infeasible-budget-bear-call-spread | 0/3 | timeout ×3 (two with partial text) | structure_search, evaluate_structure |
| market-flow-and-health | 3/3 | – | trade_flow, block_flow, feed_health, market_overview, vol_surface |
| market-off-book-chain | 3/3 | – | option_chain |
| reference-bearish-budget-18 | 0/3 | structure ×3, timeout ×1 | – |
| reference-cap-upside | 3/3 | – | option_chain, evaluate_structure |
| reference-max-loss | 3/3 | – | – |
| stale-history-followup | 3/3 | – | – |
| trade-history-fees | 2/3 | numbers ×1 | – |
| trade-history-realized | 3/3 | – | – |

Tool usage is approximate here: the deployed backend logs only successful calls, and the window is shared
with other users. The Hermes gateway journal for the run shows 30 `portfolioRef is not recognised`
rejections (15 per structure tool). It also shows 8 MCP circuit-breaker pauses of 1–54 s ("rejected the last
3/4 calls … Paused"), which then blocked further calls.

Failures:

- **Provider timeouts (8 of 11 failures).** All of them are on constraint fixtures that call the structure
  tools. The fake ref gets rejected, the breaker pauses the oggregator server, and the 90 s budget runs
  out. `infeasible-budget-bear-call-spread` s1 was cut off mid-table after stating the gap: "its Oct 30
  expiry loss is already **$4,000**, or **$2,700** over budget". In production, an expired ref (15-minute TTL) would set off
  the same rejection-then-breaker cascade.
- **reference-bearish-budget-18 (0/3).** Every answer proposes only closing the held legs: "Close both
  calls, then consider a bearish trade only if … fit within $18" and "Close the Oct 30 $85,000 short call and
  sell the Oct 16 $87,000 long call, then evaluate a bearish put using a valid portfolio reference." No new
  leg is named. The answers blame the rejected reference.
- **trade-history-fees s1.** It lists the five fees but does not give their sum ($81.79): "I can't verify
  the summed total with the available tools."
- Live/synthetic mismatch is visible. budget-bearish-long-call s1 proposes a "Nov 6 $80,000 put" spread on
  Bybit, an expiry that the fixture market does not list.
