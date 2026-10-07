# Ask Hermes eval

```bash
pnpm --filter @oggregator/server eval:assistant -- --dry-run            # validate fixtures, prompt sizes
pnpm --filter @oggregator/server eval:assistant -- --samples 3          # default: --mcp eval
pnpm --filter @oggregator/server eval:assistant -- --mcp live --samples 3
pnpm --filter @oggregator/server eval:assistant -- --regrade .eval-out/<runId>
```

Flags: `--fixture <id>` (repeatable), `--samples N` (1–10, default 3), `--concurrency N` (1–3, default 1),
`--timeout-ms`, `--mcp eval|live`, `--mcp-port` (default `OGG_ASSISTANT_EVAL_MCP_PORT` or 3192),
`--live-api-url` (default `http://127.0.0.1:$PORT`, `none` disables the live proxy), `--out`.
Output goes to `packages/server/.eval-out/<runId>/`: `report.md`, `report.json` and one
`answers/<fixture>.s<sample>.md` per sample.

## Modes

- **`--mcp eval`** (default). The runner starts the production MCP handler and tool registry
  (`createAssistantMcpHandler`, the same factory `portfolio-assistant-services.ts` uses) on
  `127.0.0.1:3192`, bearer `OGG_ASSISTANT_EVAL_MCP_TOKEN`. Each sample gets a real `portfolioRef` minted
  in the runner's `PortfolioRefStore` for the fixture's held book, marked from the fixture's synthetic
  market, and that ref replaces the placeholder in the context sent to Hermes. Structure tools evaluate
  at the fixture clock (2026-10-07T12:00Z). Tool usage is read exactly from the runner's
  `AssistantRunRegistry`: calls carrying the ref are `exact`, calls without one are `single_active`
  while only one sample is in flight. With `--concurrency > 1`, ref-less calls are ambiguous; a missing
  required tool is then graded `unverified`, not `fail`.
- **`--mcp live`**. The production `portfolio-chat` profile and the live backend MCP. Fixture refs do not
  resolve there, tools quote the live market, and tool calls are scraped from the
  `ogg-backend.service` journal. Requires `--concurrency 1`.

### Data sources under `--mcp eval`

| Tools | Source | Why |
| --- | --- | --- |
| list_underlyings, list_expiries, market_overview, option_chain, vol_surface, iv_history, evaluate_structure, structure_search | Synthetic market at the fixture clock | Numbers match the context. IV history is a deterministic series around today's synthetic values. |
| trade_flow, feed_health, news, block_flow | Live backend, read-only GET, with an "Assistant eval: proxied from the live market" note | No synthetic equivalent; only tool usage is graded on them. Timestamps can be later than the snapshot. |
| spot_candles, gamma_exposure, straddle/lotto/put scanners | Refused with "not available in the assistant eval" | Live prices would contradict the fixture market. |
| search_options_library | Local `docs/options-library.sqlite` | Same index as production. |

## Setting up `--mcp eval`

The eval needs a Hermes profile whose `oggregator` MCP server points at port 3192. Do **not** clone
credentials from `portfolio-chat`: its Codex OAuth grant is single-use-refresh and is already shared
with `~/.codex/auth.json`. A copy (or Hermes's automatic adoption of `~/.codex/auth.json` into a
credential-less profile) would put the same refresh token in a third place; the first holder to refresh
revokes it for the others, which can log out the production profile.

1. `hermes profile create portfolio-chat-eval --clone-from portfolio-chat --no-alias` (copies
   `config.yaml`, `.env`, `SOUL.md` and skills; not `auth.json`).
2. Before the profile serves any request, in `~/.hermes/profiles/portfolio-chat-eval/config.yaml` add
   `auth: {adopt_external_logins: false}` and change `mcp_servers.oggregator` to
   `url: http://127.0.0.1:3192/mcp` with `Authorization: Bearer ${OGG_ASSISTANT_EVAL_MCP_TOKEN}`.
3. In the eval profile's `.env`, remove `OGG_ASSISTANT_MCP_TOKEN` and set `OGG_ASSISTANT_EVAL_MCP_TOKEN`
   to a new random secret (`openssl rand -hex 32`). Put the same value in the repo `.env`.
4. Give the profile its own grant: `hermes -p portfolio-chat-eval auth add openai-codex` (device code,
   approved in a browser). It shares the ChatGPT account's rate limits with production; keep
   `--concurrency` at 1 or 2.
5. Optional repo `.env` overrides: `HERMES_PORTFOLIO_EVAL_API_URL` (default: the production URL with
   `/p/portfolio-chat/` replaced by `/p/portfolio-chat-eval/`), `HERMES_PORTFOLIO_EVAL_API_KEY` (default
   `HERMES_PORTFOLIO_API_KEY`), `HERMES_PORTFOLIO_EVAL_MODEL`.
6. Check `GET http://127.0.0.1:8642/p/portfolio-chat-eval/v1/models` with the API key. The multiplexed
   gateway validates `/p/<profile>/` against the profile directories on each request, so a restart
   should not be needed. If it returns 404, restart `hermes-gateway.service` once while
   `/api/health` reports `runtime.portfolioAssistant.activeRequests: 0`.

The runner refuses `--mcp eval` when the Hermes URL is the production profile's.

### Fixtures

`pnpm --filter @oggregator/server eval:assistant:fixtures` regenerates `fixtures/` from the engine
(`build-fixtures.ts`). Expected numbers are engine-derived; trade-history fixtures carry
`tradeHistoryFacts.totals`, and the generator fails if those totals disagree with sums over the
listed fills.

### Tool errors

Recoverable tool errors (bad arguments, unresolvable ref on `hedge_held_shorts`, datasets refused
in the eval, upstream loading or timeouts) come back as normal results with an
`{ ok: false, code, error, hint }` body, so Hermes's circuit breaker does not pause the server
(`HERMES.md`). A structure call with a stale ref evaluates the legs alone with
`heldBook.status: "unresolved"`. The report still shows each call's logged outcome
(`rejected_input`, `timeout`, `failed`).

## Report

`report.md` gives samples passed with a Wilson 95% interval, fixtures passing by majority (more than half
of their samples), per-check pass rates over all samples, per-fixture `x/N` with failed-check counts, and
the exact tool calls per fixture with non-`ok` outcomes. Grades are deterministic
(`assistant-eval-checks.ts`); `--regrade` re-applies them to saved answers without calling Hermes.

## From feedback to fixtures

`pnpm --filter @oggregator/server assistant:feedback-report` (see `HERMES.md`, "Feedback") ends with
"Candidate eval fixtures": one block per failure pattern (question topic, down-vote reasons, tool
profile, answer length, fixtures already on that topic, suggested checks). For a pattern worth
covering:

1. Pick or add a scenario in `build-fixtures.ts` whose book exercises the topic; expected numbers stay
   engine-derived.
2. Write a new synthetic question in the same shape. Never copy a user's question, answer, note,
   position, size or instrument from `report.md`.
3. Encode the suggested checks in `expect` (required tools for `no_tool_calls`, number tolerances for
   `wrong_numbers`, a word ceiling for `too_long`, refusal phrases for `refused`).
4. Regenerate fixtures, run `--dry-run`, then a sampled eval, and record the baseline.
