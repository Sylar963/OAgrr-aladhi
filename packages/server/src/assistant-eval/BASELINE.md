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
- **Structure check is lenient.** On the reference fixture it passes because a closing-cost table counts as a proposal. The refusal is still caught by banned phrases. Tighten this check once Phase 3 gives a canonical structure output.
- **Required numbers come from the engine.** In `trade-history-realized` the right numbers can come from the wrong source, so a numeric pass does not prove the answer read `tradeHistoryFacts`.
- **Live tools vs synthetic market.** Fixture contexts use a deterministic synthetic market, while MCP tools return live data. Answers that call tools can see different spots or quotes, or a different "now", than the context. Do not compare tool-dependent fixtures number for number.
- **One sample per fixture.** Answers are non-deterministic. Before claiming a regression or an improvement on a single fixture, rerun it (`--fixture <id>`).
