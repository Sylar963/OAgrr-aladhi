# Enterprise Fix Plan

## Context

The backend (`ogg-backend.service`) at `/home/aladhi/aladhi/OAgrr-aladhi` is an options data aggregator connecting to 8+ crypto venues via WebSocket. It streams tickers, mark prices, and index prices. The Node.js event loop blocks for **1–2.6s P50/P99** every 30 seconds, causing:

- WebSocket ping/pong timeouts → venue disconnections (close code 1006)
- Chain data taking seconds to load (longer tenors especially)
- "brittle" UX where any change triggers reconnection

Root cause analysis identified **four synchronous CPU hot paths**. This plan addresses all of them incrementally.

---

## Project Structure

```
packages/core/src/
  core/
    subscription-coordinator.ts   — delta routing, O(N×R×R) bottleneck ← FIXED
    enrichment.ts                 — chain stats, GEX, per-strike enrichment
    types.ts                      — VenueDelta, ChainRequest, etc.
    symbol.ts                     — parseOptionSymbol (memoized)
  feeds/
    deribit/
      state.ts                    — price index fan-out, quote building
      ws-client.ts                — mark price + ticker handlers
    shared/
      sdk-base.ts                 — emitQuoteUpdates, quote store, normPrice
  runtime/chain/
    chain-runtime.ts              — pushDelta, mergeStrikes, buildSnapshot
    projection.ts                 — applyDeltas, full stats/gex recompute
packages/server/src/
  chain-warmup.ts                 — pre-warms nearest 4 expiries
  chain-stream-session.ts         — WS session, backpressure handling
```

### Already Applied (Phase 1, item 1)

`packages/core/src/core/subscription-coordinator.ts` — the `onDelta` handler was refactored from a triple-nested loop (`for each delta × for each request × spread all requests again`) to an inverted index (O(R) index build + O(1) lookup per delta). Live in the current `dist/`.

---

## Full Fix List

### Phase 1 — Event Loop Stability

#### #2: Debounce Deribit price-index fan-out

**File:** `packages/core/src/feeds/deribit/state.ts:102-131`

**Problem:** `applyDeribitPriceIndex` iterates ALL instruments under an index (5,000+ for BTC) on every `deribit_price_index` message (~1s), copying each quote via spread and building a 5,000-element array. `emitQuoteUpdates` then iterates the same 5,000 again. Two concurrent index updates (BTC + ETH) = 10,000 synchronous iterations + fan-out.

**Fix:** Add a debounce/coalesce layer in `DeribitWsAdapter` (not in `state.ts` — keep `state.ts` pure). Before calling `applyDeribitPriceIndex` + `emitQuoteUpdates`, check if a price-index update for the same index is pending within a 50ms window. If so, skip the intermediate ones and only process the latest price.

Implementation sketch:
```typescript
// In deribit/ws-client.ts, add a coalescing mechanism:
private pendingPriceIndexUpdates = new Map<string, { price: number; timestamp: number }>();
private priceIndexTimer: ReturnType<typeof setTimeout> | null = null;

private queuePriceIndexUpdate(indexName: string, price: number, timestamp: number): void {
  this.pendingPriceIndexUpdates.set(indexName, { price, timestamp });
  if (this.priceIndexTimer == null) {
    this.priceIndexTimer = setTimeout(() => this.flushPriceIndexUpdates(), 50);
  }
}

private flushPriceIndexUpdates(): void {
  this.priceIndexTimer = null;
  for (const [indexName, { price, timestamp }] of this.pendingPriceIndexUpdates) {
    const updates = applyDeribitPriceIndex(this.state, this.quoteStore, indexName, price, timestamp);
    this.emitQuoteUpdates(updates);
  }
  this.pendingPriceIndexUpdates.clear();
}
```

Then in `handlePriceIndex` (line 897-910), call `this.queuePriceIndexUpdate(...)` instead of calling `applyDeribitPriceIndex` + `emitQuoteUpdates` directly.

#### #3: Skip full stats/GEX recompute on quote-only deltas

**File:** `packages/core/src/runtime/chain/projection.ts:105-151`

**Problem:** `applyDeltas()` recomputes `computeChainStats` (5 passes over all strikes), `computeGex` (O(S×V)), and sorts ALL strikes every 100ms — even when only 1-2 quotes changed. For a 200-strike chain, this is 2-10ms of wasted CPU on every push cycle.

**Fix:** Cache `lastStats` and `lastGex`. Only recompute when the set of strikes actually changes (adds/removals), or every N cycles (e.g., every 10 pushes). For quote-only changes, return the cached values.

Implementation sketch:
```typescript
export class ChainProjection {
  private lastStats: ChainStats | null = null;
  private lastGex: GexStrike[] | null = null;
  private pushCycleCount = 0;
  private readonly FULL_RECOMPUTE_INTERVAL = 10;

  applyDeltas(deltas: VenueDelta[]): ChainProjectionDelta | null {
    // ... existing delta application logic ...

    const strikesChanged = this.didStrikeSetChange(/* ... */);
    this.pushCycleCount++;

    if (strikesChanged || this.pushCycleCount % this.FULL_RECOMPUTE_INTERVAL === 0) {
      const stats = computeChainStats(strikes, venueChains);
      const gex = computeGex([...this.comparisonRows.values()], strikes, spotPrice);
      this.lastStats = stats;
      this.lastGex = gex;
    }
    // else reuse this.lastStats, this.lastGex

    return { meta, deltas, patch: { stats, strikes: patchStrikes, gex } };
  }
}
```

The `didStrikeSetChange` check is simple: compare the size of `changedStrikes` against existing strikes. If no new strikes were added and none removed, it's quote-only. Can check by maintaining a total strike count after `loadSnapshot` and comparing.

#### #4: Skip mergeStrikes full rebuild on unchanged strikes

**File:** `packages/core/src/runtime/chain/chain-runtime.ts:99-113`

**Problem:** `mergeStrikes` rebuilds a complete `Map` from the existing strikes + incoming strikes, then spreads and sorts every 100ms. When only quotes changed (no new strikes), the full rebuild is wasted work.

**Fix:** If `patch.strikes` is empty or the existing strike set hasn't changed, skip the map rebuild and reuse the existing sorted array.

```typescript
function mergeStrikes(
  existing: EnrichedChainResponse['strikes'],
  incoming: EnrichedChainResponse['strikes'],
): EnrichedChainResponse['strikes'] {
  if (incoming.length === 0) return existing;

  const byStrike = new Map<number, EnrichedChainResponse['strikes'][number]>();
  for (const strike of existing) {
    byStrike.set(strike.strike, strike);
  }
  for (const strike of incoming) {
    byStrike.set(strike.strike, strike);
  }

  // If no new strikes were added and length is unchanged, avoid re-sort
  // by updating in-place in the existing array.
  if (byStrike.size === existing.length) {
    // All incoming already existed — update in-place
    for (const strike of incoming) {
      const idx = existing.findIndex((s) => s.strike === strike.strike);
      if (idx !== -1) {
        // Can't mutate frozen/immutable objects, so we need to work with
        // the approach used in pushDelta. The simplest optimization: skip
        // mergeStrikes entirely when incoming is empty (already handled above)
        // or when strikes only changed by quote values.
      }
    }
  }

  return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}
```

Actually, the simplest fast path: in `pushDelta()` (line 386-433), check if the incoming patch has exactly the same strike keys as before. If so, skip `mergeStrikes` and just replace the existing array fields:

```typescript
// In pushDelta, after getting patch:
this.currentSnapshot = snapshot == null ? null : {
  ...snapshot.data,
  stats: patch.patch.stats,
  strikes: patch.patch.strikes.length > 0
    ? mergeStrikes(snapshot.data.strikes, patch.patch.strikes)
    : snapshot.data.strikes,  // ← fast path: no new strikes
  gex: patch.patch.gex,
};
```

This is the simplest change: if `applyDeltas` returns no strike changes (only quote/GEX changes), skip `mergeStrikes` entirely. But currently `applyDeltas` always returns `patchStrikes` for the changed strikes, even when they're quote-only. So we need to check if the set of strike keys in `patchStrikes` is the same as some previous set. Or even simpler: just check `patch.patch.strikes.length` — if it's 0 we have nothing to merge (but applyDeltas always returns at least the changed strikes).

Better approach: change `mergeStrikes` to short-circuit:

```typescript
function mergeStrikes(
  existing: EnrichedChainResponse['strikes'],
  incoming: EnrichedChainResponse['strikes'],
): EnrichedChainResponse['strikes'] {
  if (incoming.length === 0) return existing;
  // If all incoming strikes already exist in existing at the same index,
  // we can skip the full rebuild.  The common case is quote updates only.
  const allSameKeys = incoming.every((s) => existing.some((e) => e.strike === s.strike));
  if (allSameKeys && incoming.length === existing.length) {
    return existing;  // reuse existing — quotes already updated in place via enrichComparisonRow
  }
  // ...full rebuild...
}
```

Wait, but `existing` elements were not mutated — `enrichComparisonRow` returns a new object. So `existing` is stale. The patch strikes DO contain the updated data. So we can't just skip. 

Simplest correct optimization with the least code change: if `incoming.length === existing.length`, do the merge but skip the sort (since they're in the same order). Actually, the sort is O(S log S) which is the expensive part. If all strikes exist (no adds/removes) and we want to replace them, we can just replace items in a copy:

```typescript
function mergeStrikes(
  existing: EnrichedChainResponse['strikes'],
  incoming: EnrichedChainResponse['strikes'],
): EnrichedChainResponse['strikes'] {
  if (incoming.length === 0) return existing;
  
  const incomingStrikeSet = new Set(incoming.map((s) => s.strike));
  const existingStrikeSet = new Set(existing.map((s) => s.strike));
  
  // Check if sets are identical (no adds, no removes)
  if (incomingStrikeSet.size === existingStrikeSet.size) {
    let allMatch = true;
    for (const strike of incomingStrikeSet) {
      if (!existingStrikeSet.has(strike)) { allMatch = false; break; }
    }
    if (allMatch) {
      // Same strike set — rebuild by updating in-place order to skip sort
      const updated = existing.map((s) => incomingStrikeSet.has(s.strike) 
        ? (incoming.find((is) => is.strike === s.strike) ?? s)
        : s
      );
      return updated;
    }
  }

  // Full rebuild
  const byStrike = new Map<number, EnrichedChainResponse['strikes'][number]>();
  for (const strike of existing) byStrike.set(strike.strike, strike);
  for (const strike of incoming) byStrike.set(strike.strike, strike);
  return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}
```

This preserves order (strikes are already sorted from the first call), so we skip the O(S log S) sort when the strike set is stable.

---

### Phase 2 — Chain Loading UX

#### #5: Extend chain warmup to cover more expiries

**File:** `packages/server/src/chain-warmup.ts:7-14`

**Problem:** Only the nearest 4 (hot) or 2 (warm) expiries are pre-warmed. User clicking a longer-dated tenor requires a full cold-start: subscribe WS → build empty snapshot → wait for first delta batch. The first render is always empty.

**Fix:** Increase `HOT_EXPIRY_COUNT` from 4 to `ALL` (all available expiries for hot underlyings), or at least 8-12. For warm, increase from 2 to 4-6. The cost is proportional to the number of ChainRuntime instances created, but they're reference-counted and shared across users.

Change:
```typescript
const HOT_EXPIRY_COUNT = 12;  // was 4 — covers ~3 months of weekly expiries
const WARM_EXPIRY_COUNT = 6;  // was 2
```

Also add `SOL_USDC` to `WARM_UNDERLYINGS` since it's already in `HOT_UNDERLYINGS` but not in `WARM_UNDERLYINGS` (it's listed, I misread — it IS in HOT). Good.

#### #6: Delay first snapshot until WS data arrives

**File:** `packages/core/src/runtime/chain/chain-runtime.ts:241-297`

**Problem:** In `initialize()`, `buildSnapshot()` is called immediately after all venue acquisitions complete (line 294). The venues just sent WS subscribe messages, but no data has arrived yet. `fetchOptionChain()` reads from the in-memory `quoteStore` which is empty → all-null quotes → empty first render. Data arrives 100-1200ms later via deltas.

**Fix:** After `buildSnapshot()`, wait for a "data has arrived" signal before considering the runtime "ready." One approach: after `buildSnapshot()`, check if the snapshot has any live quotes. If not (all timestamps === 0), defer the snapshot broadcast and wait for the first delta batch to arrive before emitting the first snapshot.

Implementation sketch:
```typescript
private async initialize(): Promise<void> {
  // ... existing venue acquisition ...
  
  // Build initial snapshot from quote store (may be empty if WS data hasn't arrived)
  await this.buildSnapshot();
  
  // If the snapshot has no live quotes, wait for the first WS delta before
  // considering initialization complete. This avoids broadcasting an empty snapshot.
  if (this.currentSnapshot != null && this.snapshotHasLiveData(this.currentSnapshot) === false) {
    await this.waitForFirstData();
  }
}

private snapshotHasLiveData(snapshot: ChainRuntimeSnapshotEvent): boolean {
  return snapshot.meta.maxQuoteTs > 0;
}

private waitForFirstData(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (this.currentSnapshot != null && this.snapshotHasLiveData(this.currentSnapshot)) {
        resolve();
        return;
      }
      // Check if pending deltas have arrived
      if (this.pendingBySymbol.size > 0) {
        this.pushDelta();
        if (this.currentSnapshot != null && this.snapshotHasLiveData(this.currentSnapshot)) {
          resolve();
          return;
        }
      }
      // Poll every 50ms up to 5s, then give up
      setTimeout(check, 50);
    };
    // Timeout after 5s to avoid hanging
    setTimeout(() => resolve(), 5000);
    check();
  });
}
```

Actually, a better approach: hook into the `onDelta` handler. Set a flag `hasReceivedData` to true when the first non-empty delta arrives. In `initialize()`, after `buildSnapshot()`, poll this flag with a short timeout.

---

### Phase 3 — Observability & Resilience

#### #7: Event-loop lag alerting (Grafana/opsgenie)

**File:** `packages/server/src/` (runtime metrics heartbeat)

The backend already logs event-loop lag every 30s (runtime metrics heartbeat) and on every 30s interval when lag exceeds thresholds. The existing logging at `packages/core/src/runtime/chain/health.ts` just logs — doesn't export metrics.

**Fix:** Add a counter metric that increments when event-loop lag exceeds 500ms. Expose via the `/api/health` endpoint or a prometheus endpoint so Grafana can alert. Or simply wire the existing log into a systemd journal alert via journald thresholds.

For a quick implementation without adding dependencies: write a tiny log scraper or add a lightweight `/api/metrics` endpoint that tracks:
```typescript
let eventLoopLagBuckets: Record<string, number> = {};
// In the lag check:
eventLoopLagBuckets[`lag_${Math.floor(lagMs / 100) * 100}`] = (eventLoopLagBuckets[`lag_${Math.floor(lagMs / 100) * 100}`] ?? 0) + 1;
```

#### #8: WebSocket replay queue for topic-ws-client

**File:** `packages/core/src/feeds/shared/topic-ws-client.ts:183-186`

**Problem:** On reconnect, `replaySubscriptions()` calls `this.send(message)` which silently drops messages when `readyState !== WebSocket.OPEN`. The socket may still be connecting when replay messages are sent.

```typescript
// Line 183-186:
private send(message: string | object): void {
  if (this.ws?.readyState !== WebSocket.OPEN) return;
  this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
}
```

**Fix:** Queue replay messages if the socket isn't open yet, then drain on `onopen`:

```typescript
private replayQueue: Array<string | object> = [];

private send(message: string | object): void {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  } else {
    this.replayQueue.push(message);
  }
}

// In onopen handler:
private onOpen(): void {
  // ... existing connect logic ...
  // Drain replay queue
  for (const msg of this.replayQueue) {
    this.ws?.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  this.replayQueue = [];
}
```

And on `replaySubscriptions` (line 197-202):
```typescript
private replaySubscriptions(): void {
  const messages = this.options.getReplayMessages?.() ?? [];
  for (const message of messages) {
    this.send(message);  // now safe — queues if not open
  }
}
```

#### #9: Resync loop guard

**File:** `packages/core/src/runtime/chain/chain-runtime.ts:398-403`

**Problem:** When `applyDeltas()` returns null (venue/contract missing), `pushDelta()` triggers `buildSnapshot()`. If the same deltas arrive during the snapshot build (which takes time due to REST calls across multiple venues), the new snapshot may have the same stale state, causing `applyDeltas` to return null again on the next push → infinite resync loop.

```typescript
if (patch == null) {
  void this.buildSnapshot().catch(/* ... */);
  return;
}
```

**Fix:** Add exponential backoff on resync. Only allow a resync every 1 second minimum, doubling up to 30s:

```typescript
private lastResyncAt = 0;
private resyncBackoffMs = 1000;

// In pushDelta where patch == null:
const now = Date.now();
if (now - this.lastResyncAt >= this.resyncBackoffMs) {
  this.lastResyncAt = now;
  this.resyncBackoffMs = Math.min(this.resyncBackoffMs * 2, 30_000);
  void this.buildSnapshot().catch(/* ... */);
} else {
  // Too soon since last resync — clear pending and let next tick retry
  this.pendingBySymbol.clear();
}
// Reset backoff on successful snapshot
// ... call this.resyncBackoffMs = 1000 in buildSnapshot success path
```

#### #10: Max DTE filter for expiry bar

**File:** `packages/web/src/features/chain/ExpiryBar.tsx`

Exchanges list expiries 5+ years out. These have zero volume and few strikes, but they still appear in the expiry bar. Clicking one triggers a full cold-start with no useful data.

**Fix:** Filter expiries to max 1 year DTE by default, configurable. In `useExpiries()` or in the component, compute DTE and hide expiries beyond `MAX_DTE` (default 365).

---

### Phase 4 — Performance Hardening

#### #11: emitQuoteUpdates per-item cache

**File:** `packages/core/src/feeds/shared/sdk-base.ts:418-438`

**Problem:** `normPrice` does `this.quoteStore.get(inst.exchangeSymbol)` (Map read) + branching logic — called 3× per delta (bid, ask, mark). Also `estimateFees` and `normalizeOpenInterestUsd` repeat expensive branches per item. For 5,000 updates, these redundant lookups add up.

**Fix:** Cache `normPrice` results within a single `emitQuoteUpdates` call. Group by instrument to avoid redundant `quoteStore.get` and `instrumentMap.get`:

```typescript
// Cache normPrice results per instrument within one emitQuoteUpdates call
const normCache = new Map<string, { raw: number|null; rawCurrency: string; usd: number|null }>();

// Slight refactor: compute once per (inst, raw) combo
function cachedNorm(raw: number | null, inst: CachedInstrument) {
  const key = `${inst.exchangeSymbol}:${raw}`;
  let cached = normCache.get(key);
  if (cached == null) {
    cached = this.normPrice(raw, inst);
    normCache.set(key, cached);
  }
  return cached;
}
```

Similarly, pre-compute `estimateFees` and `normalizeOpenInterestUsd` once per instrument instead of per-update, since OI and fees don't change between the `bidPrice` and `askPrice` calls within the same batch.

#### #12: Batch concurrent gex-all-expiries fetches

**File:** `packages/server/src/routes/gex-all-expiries.ts:55-59`

All expiries are acquired via `Promise.all`. For 30+ expiries, this creates 30+ concurrent ChainRuntime initializations, each doing WS subscribe round-trips.

**Fix:** Limit to 5 concurrent:

```typescript
async function mapConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then((r) => { results.push(r); });
    executing.add(p.then(() => executing.delete(p)));
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}
```

#### #13: Parallelize buildIvSurfaceGrid

**File:** `packages/core/src/core/surface-grid.ts:73`

Currently sequential `for...of` over all expiries. Each iteration is `Promise.allSettled` across all venues for one expiry.

**Fix:** Use the same concurrency-limited approach as #12. Collect all expiry chains with a concurrency of 3-5.

#### #14: Node.js --prof flamegraph

Run the backend with `--prof` for 30 minutes:
```bash
node --prof --env-file-if-exists=.env packages/server/dist/index.js
# After 30 min:
node --prof-process isolate-*.log > flame.txt
# Or use speedscope to visualize
```

This produces a flamegraph showing the exact CPU sinks at runtime. Run during peak usage (multiple users viewing chains) to identify remaining hot spots after the above fixes are applied.

---

## Verification

After each phase, run:
```bash
pnpm --filter @oggregator/core build  # rebuild dist/
systemctl --user restart ogg-backend.service  # deploy
```

Monitor event-loop lag:
```bash
journalctl --user -u ogg-backend.service --since "5 min ago" --no-pager | grep "event-loop-lag"
```

Target: `p50Ms < 50`, `p99Ms < 200`.

Run test suite:
```bash
pnpm --filter @oggregator/core test:run
pnpm typecheck
```

---

## Services

```
ogg-backend.service  — main API / WS server
  /home/teal/.config/systemd/user/ogg-backend.service
  ExecStart: node packages/server/dist/index.js

ogg-ingest.service   — trade persistence worker (24/7)
  /home/teal/.config/systemd/user/ogg-ingest.service
  ExecStart: node packages/ingest/dist/index.js

Restart: systemctl --user restart ogg-backend.service
Logs: journalctl --user -u ogg-backend.service --since "5 min ago"
```
