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
| search_options_library | Indexed book passages with page citations |

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

A successful direct `tools/list` request proves server availability, not agent
integration. A fluent answer is not sufficient evidence of tool use.

Private portfolio positions, scenarios and venue trade history remain scoped to the
authenticated context attached by Oggregator. For Thalex and Derive portfolios the
context includes `tradeHistoryFacts`: the 100 most recent fills (30 when compacted)
from the Postgres trade ledger, filtered to the thread underlying. Lifetime totals
stay in `accountingFacts`. The ledger fills while the venue connection is active, so
history starts at the first sync (`historyFromMs`). This MCP connection does not provide all private
platform data or the separate TradFi backend. New private tools require server-bound
user scope; never accept a model-provided account ID as authorization.
