---
name: ws-venue-management
description: >
  Apply this skill when working on venue WebSocket adapters, chain/trade runtimes,
  subscription coordination, fixture-backed regressions, or transport/payload
  optimizations. Use for `ws-client.ts`, `planner.ts`, `state.ts`, `health.ts`,
  `chain-stream-session.ts`, `/ws/chain`, and venue-specific tests.
---

# WS Venue Management

Use this skill for future WebSocket venue fixes, regression fixtures, and performance work
across `packages/core` and `packages/server`.

Read `packages/core/CLAUDE.md` before changing any venue adapter.

---

## Scope

This skill applies when the task touches any of these areas:

- `packages/core/src/feeds/{venue}/ws-client.ts`
- `packages/core/src/feeds/{venue}/planner.ts`
- `packages/core/src/feeds/{venue}/state.ts`
- `packages/core/src/feeds/{venue}/health.ts`
- `packages/core/src/feeds/{venue}/codec.ts`
- `packages/core/src/feeds/shared/`
- `packages/core/src/core/subscription-coordinator.ts`
- `packages/core/src/runtime/chain/`
- `packages/server/src/chain-stream-session.ts`
- `packages/server/src/routes/ws-chain.ts`
- `references/options-docs/{venue}/`

Do not use this skill for generic REST-only work unless the REST path directly affects WS
bootstrap, health, replay, or recovery.

---

## Core model

Treat venue WS work as four separate failure planes. Identify which one is broken before editing code.

1. **Transport**
   Socket lifecycle, heartbeats, reconnects, teardown, backoff, pending timers, listener cleanup.

2. **Control plane**
   Subscribe/unsubscribe RPCs, topic args, request timeouts, empty plans, rejected topics,
   reconnect-after-control-failure.

3. **State/accounting**
   Local subscribed sets, pending request maps, replay caches, stale quote detection,
   request-scoped vs venue-scoped status.

4. **Payload/product surface**
   Snapshot/delta size, fan-out behavior, duplicate status frames, stale client backpressure,
   web-consumed fields vs transport-only fields.

Many bugs look like transport failures but are actually control-plane or local-state poisoning.

---

## Non-negotiable rules

- Zod at the boundary. Fix schemas first if the exchange payload shape changed.
- Do not mutate subscribed state eagerly before subscribe work is actually sent or confirmed.
- Do not let REST or venue status probes mask a known WS `reconnecting` or `down` state.
- Unsupported requests must fail fast and locally. Do not pretend a venue is connected when there
  are no matching instruments.
- Request-scoped failures must stay request-scoped. Do not broadcast them to unrelated subscriptions.
- Clear local unsubscribe state even if the socket is already down. Local state must reflect intent.
- Reconnect on recoverable control-plane dead states such as timed out requests, closed sockets,
  or not-connected send attempts.
- Rebuild `@oggregator/core` after changing `packages/core/src/` before trusting server behavior.

---

## Standard workflow

### 1. Classify the bug first

Use logs, tests, and live probes to answer these questions:

- Did the socket die, or did the venue stay "connected" while quotes stopped moving?
- Did subscribe args become invalid because the instrument set changed?
- Did a synthetic underlying or unsupported tenor create a false status?
- Did local subscribed state survive after unsubscribe, reconnect, or failed control calls?
- Is the problem correctness, or is it a large-frame / stale-client throughput issue?

### 2. Touch the smallest layer that owns the bug

- Schema/payload mismatch: `types.ts`, `codec.ts`
- Topic construction or eager mutation: `planner.ts`
- Reconnect, state cleanup, control retries: `ws-client.ts`
- Staleness and venue readiness: `health.ts`, `state.ts`
- Cross-request fan-out or replay behavior: `subscription-coordinator.ts`
- Large frames / slow consumers: `chain-stream-session.ts`, protocol payload shaping

### 3. Add a regression before or with the fix

Prefer focused tests over broad end-to-end coverage:

- schema regression: `types.test.ts`
- planner/accounting regression: `planner.test.ts`
- staleness/status regression: `health.test.ts`, `state.test.ts`
- transport/control regression: `ws-client.test.ts`
- request fan-out regression: coordinator/session tests

### 4. Rebuild and verify the real consumer

After changing `packages/core/src/`:

```bash
pnpm --filter @oggregator/core test:run -- <targeted tests>
pnpm --filter @oggregator/core build
systemctl --user restart ogg-backend.service
```

Then verify both surfaces:

- REST: representative `/api/chains` or `/api/health`
- WS: direct `/ws/chain` probe for supported and unsupported requests

---

## Fixture strategy

Prefer doc-backed or captured-real payload fixtures over invented shapes.

Sources, in order:

1. `references/options-docs/{venue}/`
2. Existing venue tests in `packages/core/src/feeds/{venue}/`
3. Captured production or local payloads with identifying noise removed

Use fixtures to lock down these classes of bugs:

- numeric strings vs numbers
- missing or nullable greeks / marks / timestamps
- invalid or expired instruments still present in local caches
- rejected subscriptions caused by wrong topic names or synthetic keys
- stale subscribed quotes that stop updating while the socket still looks alive
- unsupported underlyings or expiries that must return `no instruments for request`
- late subscribe acks arriving after unsubscribe

When creating a fixture, preserve the exchange's real field names and wire shape. Do not normalize the
fixture into internal types before testing the parser.

---

## Optimization checklist

Use this when the issue is throughput, memory, or long-run degradation rather than wrong data.

### Transport and lifecycle

- remove leaked listeners and timers on every dispose path
- clear pending request maps and replay caches that can resurrect stale state
- dedupe repeated identical error logs to prevent log storms
- make reconnect paths idempotent

### Control-plane efficiency

- prune expired instruments before subscribe/unsubscribe
- avoid empty subscribe batches
- avoid subscriptions the product does not consume
- derive topics from matched venue instruments, not raw request keys

### Payload pressure

- measure whether clients consume `patch`, `deltas`, or both before sending both
- inspect `snapshot` and `delta` byte size before changing cadence
- prefer reducing duplicated payload structure before adding more buffering
- treat repeated identical `status` frames as a correctness and bandwidth smell

### Health and false-alive detection

- detect globally stale subscribed quotes, not only disconnected sockets
- let transport truth outrank optimistic health probes
- log enough context to separate one bad request from venue-wide failure

---

## Known patterns to preserve

- Shared transports in `feeds/shared/` are preferred over venue-local socket loops.
- Venue logic should stay split by role: `codec.ts`, `planner.ts`, `state.ts`, `health.ts`, `ws-client.ts`.
- `ws-client.ts` should orchestrate; it should not become the dumping ground for parsing and business rules.
- Synthetic underlyings such as `BTC_USDC` or `AVAX_USDC` must be resolved through actual matched venue
  instruments before topic construction.
- Unsupported venue requests should produce immediate, explicit status rather than drifting into stale/no-data states.
- The running server consumes `dist/`, not `src/`.

---

## Validation checklist

Before considering a WS venue task done, verify all that apply:

- targeted tests pass
- `pnpm --filter @oggregator/core build` completed after core changes
- backend restarted if server behavior depends on rebuilt core dist
- supported request returns `subscribed` and a current snapshot
- unsupported request fails explicitly without poisoning other active subscriptions
- reconnect or stale watchdog behavior is covered by at least one regression test
- no new repeated-error log storm was introduced

---

## Useful files

- `packages/core/CLAUDE.md`
- `packages/core/src/feeds/shared/sdk-base.ts`
- `packages/core/src/core/subscription-coordinator.ts`
- `packages/server/src/chain-stream-session.ts`
- `packages/server/src/routes/ws-chain.ts`
- `packages/web/src/hooks/useChainWs.ts`
- `packages/protocol/src/ws.ts`
- `references/options-docs/{venue}/`

If the task is large, start by naming the failure plane, then add the narrowest regression that proves the bug.
