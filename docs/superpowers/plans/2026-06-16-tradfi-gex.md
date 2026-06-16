# TradFi GEX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated GEX page to the TradFi frontend (Bars + Bands) powered by a live-signed dealer-flow model reconstructed from DXLink trades via Lee-Ready classification.

**Architecture:** The TradFi service grows an in-memory `TradfiFlowBook` (net taker flow per contract, keyed by canonical symbol, Lee-Ready-signed, ET-day reset). `buildChain` builds a `BookLookup` from each contract's live OI + that flow and passes it to the already-called `buildEnrichedChain`, so `/chains`, `/ws/chain`, and a new `/gex-all-expiries` route emit *signed* GEX. The frontend adds a `TradfiGexView` page reusing the crypto GEX rendering (shared wall math + channel primitive + CSS) fed by TradFi hooks. Crypto code paths are untouched.

**Tech Stack:** TypeScript, Fastify, `@oggregator/core` (GEX + dealer-book primitives), React 19 + Vite, TanStack Query, Zustand, lightweight-charts, Vitest.

**Key safety property:** At zero net flow the lookup returns `dealerContracts = ±OI`, which makes `computeGex` byte-identical to today's naive TradFi GEX. The signed path can never be *worse* than current behavior; it only refines as flow arrives.

---

## File Structure

**Backend — `packages/tradfi/src/`**
- `runtime/flow-book.ts` *(new)* — `TradfiFlowBook` + `classifyTrade` (Lee-Ready) + `etDayKey`. Pure flow accumulator; no I/O.
- `tastytrade/state.ts` *(modify)* — `applyEvent` gains optional `flowBook`; records trade flow in the `Trade` case.
- `tastytrade/feed.ts` *(modify)* — owns `readonly flowBook`; passes it to `applyEvent`.
- `runtime/chain.ts` *(modify)* — `buildChain` gains optional `flowBook`; builds the `BookLookup`; passes it to `buildEnrichedChain`.
- `app.ts` *(modify)* — `TradfiDeps` gains optional `flowBook`; register the new route.
- `routes/chains.ts` *(modify)* — pass `deps.flowBook` to `buildChain`.
- `routes/ws-chain.ts` *(modify)* — `ChainPusher` accepts + uses `flowBook`.
- `routes/gex-all-expiries.ts` *(new)* — aggregate signed GEX across expiries.
- `index.ts` *(modify)* — wire `flowBook: feed.flowBook` into `buildApp`.

**Frontend — `packages/web/src/`**
- `features/gex/index.ts` *(modify, additive)* — export `computeGammaWalls`, `GammaChannelPrimitive`, `GexStrike` for reuse.
- `features/tradfi/queries.ts` *(modify)* — add `useTradfiAllExpiriesGex`.
- `features/tradfi/TradfiGexBandsChart.tsx` *(new)* — bands chart over `/underlying-candles`, reusing shared wall math + channel primitive.
- `features/tradfi/TradfiGexView.tsx` *(new)* + reuses `@features/gex/GexView.module.css`.
- `features/tradfi/TradfiApp.tsx` *(modify)* — Chain | GEX page switcher.
- `stores/app-store.ts` *(modify)* — `tradfiPage` state + setter.

**Conventions for the executor**
- Run a single test file: `pnpm --filter @oggregator/<pkg> exec vitest run <path>` (pkg = `tradfi` or `web`).
- Typecheck a package: `pnpm --filter @oggregator/<pkg> typecheck`.
- If a tradfi typecheck reports a missing `@oggregator/core` export (e.g. `BookLookup`), rebuild core: `pnpm --filter @oggregator/core build`.
- Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work stays on branch `feat/tradfi-gex` (already created).
- Tasks 8 + 9 import the crypto `@features/gex/GexView.module.css` for visual parity. If a lint/import-boundary rule rejects the cross-feature CSS import, the fallback is to `cp packages/web/src/features/gex/GexView.module.css packages/web/src/features/tradfi/TradfiGex.module.css` and import that local copy instead (same class names, zero behavior change). Try the shared import first.

---

## Task 1: `TradfiFlowBook` + Lee-Ready classifier

**Files:**
- Create: `packages/tradfi/src/runtime/flow-book.ts`
- Test: `packages/tradfi/src/runtime/flow-book.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/tradfi/src/runtime/flow-book.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyTrade, etDayKey, TradfiFlowBook } from './flow-book.js';

// 2026-06-16 11:00 ET and 2026-06-17 11:00 ET (15:00Z, EDT = UTC-4).
const DAY1 = Date.parse('2026-06-16T15:00:00Z');
const DAY2 = Date.parse('2026-06-17T15:00:00Z');

describe('classifyTrade (Lee-Ready)', () => {
  it('quote rule: above mid is a buy, below mid is a sell', () => {
    expect(classifyTrade(1.6, 1.0, 2.0, null, 1)).toBe(1);
    expect(classifyTrade(1.4, 1.0, 2.0, null, 1)).toBe(-1);
  });

  it('at-mid falls back to the tick rule', () => {
    expect(classifyTrade(1.5, 1.0, 2.0, 1.4, -1)).toBe(1); // uptick vs last
    expect(classifyTrade(1.5, 1.0, 2.0, 1.6, 1)).toBe(-1); // downtick vs last
  });

  it('zero tick carries the prior direction', () => {
    expect(classifyTrade(1.5, 1.0, 2.0, 1.5, -1)).toBe(-1);
  });

  it('no quote uses the tick rule', () => {
    expect(classifyTrade(2.0, null, null, 1.0, 1)).toBe(1);
  });
});

describe('TradfiFlowBook', () => {
  it('accumulates signed customer flow (buys positive, sells negative)', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('SPX-C-5000', 1.6, 10, 1.0, 2.0, DAY1); // buy +10
    book.recordTrade('SPX-C-5000', 1.4, 4, 1.0, 2.0, DAY1); //  sell −4
    expect(book.netFlowFor('SPX-C-5000')).toBe(6);
  });

  it('ignores null/non-positive size or null price', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('X', null, 10, 1, 2, DAY1);
    book.recordTrade('X', 1.6, null, 1, 2, DAY1);
    book.recordTrade('X', 1.6, 0, 1, 2, DAY1);
    expect(book.netFlowFor('X')).toBe(0);
  });

  it('clears all flow on ET-day rollover', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('X', 1.6, 10, 1.0, 2.0, DAY1);
    expect(book.netFlowFor('X')).toBe(10);
    book.recordTrade('Y', 1.6, 3, 1.0, 2.0, DAY2); // new session → wipes X
    expect(book.netFlowFor('X')).toBe(0);
    expect(book.netFlowFor('Y')).toBe(3);
  });

  it('etDayKey returns an ET calendar day', () => {
    expect(etDayKey(DAY1)).toBe('2026-06-16');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/flow-book.test.ts`
Expected: FAIL — `Cannot find module './flow-book.js'`.

- [ ] **Step 3: Write the implementation**

`packages/tradfi/src/runtime/flow-book.ts`:

```ts
const ET = 'America/New_York';

/** ET calendar-day key (YYYY-MM-DD) — the session boundary for flow reset. */
export function etDayKey(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Lee-Ready trade-side classification. Quote rule first (trade vs prevailing
 * bid/ask mid), tick rule as fallback for at-mid / no-quote prints, carrying the
 * prior tick direction on a zero tick. +1 = buy-initiated, −1 = sell-initiated.
 */
export function classifyTrade(
  price: number,
  bid: number | null,
  ask: number | null,
  lastPrice: number | null,
  lastDir: 1 | -1,
): 1 | -1 {
  if (bid != null && ask != null) {
    const mid = (bid + ask) / 2;
    if (price > mid) return 1;
    if (price < mid) return -1;
  }
  if (lastPrice != null) {
    if (price > lastPrice) return 1;
    if (price < lastPrice) return -1;
  }
  return lastDir;
}

interface FlowState {
  netFlow: number; // signed customer contracts this session: + net buy, − net sell
  lastTradePrice: number | null;
  lastTickDir: 1 | -1;
}

/**
 * In-memory per-contract net taker flow, keyed by canonical option symbol.
 * Customer-buy is positive. Self-resets on ET-day rollover: the first trade of a
 * new session clears the whole map. No persistence — the signed book is
 * reconstructable from live OI (held by the chain) plus this session's flow.
 */
export class TradfiFlowBook {
  private flow = new Map<string, FlowState>();
  private sessionDayKey: string | null = null;

  recordTrade(
    canonical: string,
    price: number | null,
    size: number | null,
    bid: number | null,
    ask: number | null,
    nowMs: number = Date.now(),
  ): void {
    if (price == null || size == null || size <= 0) return;
    const day = etDayKey(nowMs);
    if (day !== this.sessionDayKey) {
      this.flow.clear();
      this.sessionDayKey = day;
    }
    const st = this.flow.get(canonical) ?? {
      netFlow: 0,
      lastTradePrice: null,
      lastTickDir: 1 as 1 | -1,
    };
    const dir = classifyTrade(price, bid, ask, st.lastTradePrice, st.lastTickDir);
    st.netFlow += dir * size;
    st.lastTradePrice = price;
    st.lastTickDir = dir;
    this.flow.set(canonical, st);
  }

  netFlowFor(canonical: string): number {
    return this.flow.get(canonical)?.netFlow ?? 0;
  }

  resetSession(): void {
    this.flow.clear();
    this.sessionDayKey = null;
  }

  size(): number {
    return this.flow.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/flow-book.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/runtime/flow-book.ts packages/tradfi/src/runtime/flow-book.test.ts
git commit -m "feat(tradfi): TradfiFlowBook + Lee-Ready trade classifier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Record trade flow in the feed

**Files:**
- Modify: `packages/tradfi/src/tastytrade/state.ts`
- Modify: `packages/tradfi/src/tastytrade/feed.ts:142` (call site) + class field
- Test: `packages/tradfi/src/tastytrade/state.test.ts`

- [ ] **Step 1: Write the failing test** (append to `state.test.ts`)

```ts
import { TradfiStore } from '../runtime/store.js';
import { TradfiFlowBook } from '../runtime/flow-book.js';
import { applyEvent } from './state.js';

it('records Lee-Ready-signed flow for option trades when a flow book is passed', () => {
  const store = new TradfiStore();
  store.setInstruments([
    {
      canonical: 'SPX-20260618-5000-C',
      streamerSymbol: '.SPX260618C5000',
      underlying: 'SPX',
      expiry: '2026-06-18',
      strike: 5000,
      right: 'call',
      multiplier: 100,
    } as never,
  ]);
  const flow = new TradfiFlowBook();
  const ts = Date.parse('2026-06-16T15:00:00Z');

  // Prevailing quote: bid 1.0 / ask 2.0 (mid 1.5).
  applyEvent(store, { eventType: 'Quote', eventSymbol: '.SPX260618C5000', bidPrice: 1.0, askPrice: 2.0 }, ts);
  // Trade above mid, size 5 → buy-initiated → +5.
  applyEvent(store, { eventType: 'Trade', eventSymbol: '.SPX260618C5000', price: 1.8, size: 5, dayVolume: 5 }, ts, flow);

  expect(flow.netFlowFor('SPX-20260618-5000-C')).toBe(5);
});

it('does not record flow for underlying (spot) trades', () => {
  const store = new TradfiStore();
  const flow = new TradfiFlowBook();
  applyEvent(store, { eventType: 'Trade', eventSymbol: 'SPX', price: 5000, size: 1, dayVolume: 1 }, Date.now(), flow);
  expect(flow.size()).toBe(0);
});
```

> Use the real `TradfiInstrument` field names if they differ — check `packages/tradfi/src/tastytrade/instrument.ts`. The `as never` cast keeps the fixture minimal; replace with the real shape if the linter objects.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/state.test.ts`
Expected: FAIL — `applyEvent` ignores the 4th arg / flow stays 0.

- [ ] **Step 3: Modify `state.ts`**

Add the import at the top:

```ts
import type { TradfiFlowBook } from '../runtime/flow-book.js';
```

Change the signature:

```ts
export function applyEvent(
  store: TradfiStore,
  ev: DxEvent,
  ts: number,
  flowBook?: TradfiFlowBook,
): void {
```

Replace the `Trade` case body:

```ts
    case 'Trade': {
      patch.last = numOrNull(ev.price);
      patch.volume = numOrNull(ev.dayVolume);
      if (flowBook != null) {
        // Prevailing quote (last Quote merge) classifies aggressor side.
        const q = store.getQuote(ev.eventSymbol);
        flowBook.recordTrade(
          inst.canonical,
          numOrNull(ev.price),
          numOrNull(ev.size),
          q?.bid ?? null,
          q?.ask ?? null,
          ts,
        );
      }
      break;
    }
```

(`inst` is already in scope and non-null past the underlying-spot early return.)

- [ ] **Step 4: Modify `feed.ts`**

Add the import:

```ts
import { TradfiFlowBook } from '../runtime/flow-book.js';
```

Add a public field inside `class TradfiFeed` (near the other private fields, ~line 71):

```ts
  readonly flowBook = new TradfiFlowBook();
```

Update the event loop (line 142):

```ts
        for (const ev of events) applyEvent(this.store, ev, ts, this.flowBook);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/state.test.ts`
Expected: PASS.
Run: `pnpm --filter @oggregator/tradfi typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/tradfi/src/tastytrade/state.ts packages/tradfi/src/tastytrade/feed.ts packages/tradfi/src/tastytrade/state.test.ts
git commit -m "feat(tradfi): record Lee-Ready signed flow from DXLink trades

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Signed GEX in `buildChain`

**Files:**
- Modify: `packages/tradfi/src/runtime/chain.ts`
- Test: `packages/tradfi/src/runtime/chain.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/tradfi/src/runtime/chain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TradfiStore } from './store.js';
import { TradfiFlowBook } from './flow-book.js';
import { buildChain } from './chain.js';

function seedStore(): TradfiStore {
  const store = new TradfiStore();
  store.setInstruments([
    {
      canonical: 'SPX-20260618-5000-C',
      streamerSymbol: '.C',
      underlying: 'SPX',
      expiry: '2026-06-18',
      strike: 5000,
      right: 'call',
      multiplier: 100,
    } as never,
  ]);
  store.setSpot('SPX', 5000);
  store.mergeQuote('.C', { ts: 1, bid: 1, ask: 2, mark: 1.5, gamma: 0.001, openInterest: 1000 });
  return store;
}

describe('buildChain signed GEX', () => {
  it('with no flow book, GEX equals the naive path (unchanged behavior)', () => {
    const a = buildChain(seedStore(), 'SPX', '2026-06-18', 'ws');
    const b = buildChain(seedStore(), 'SPX', '2026-06-18', 'ws', new TradfiFlowBook());
    expect(b.gex).toEqual(a.gex); // empty book ⇒ dealerContracts = +OI ⇒ identical
  });

  it('net customer buying of a call lowers its GEX vs naive', () => {
    const store = seedStore();
    const flow = new TradfiFlowBook();
    flow.recordTrade('SPX-20260618-5000-C', 1.9, 400, 1, 2, Date.now()); // +400 buys
    const naive = buildChain(seedStore(), 'SPX', '2026-06-18', 'ws').gex;
    const signed = buildChain(store, 'SPX', '2026-06-18', 'ws', flow).gex;
    const k = 5000;
    const naiveAt = naive.find((g) => g.strike === k)!.gexUsdMillions;
    const signedAt = signed.find((g) => g.strike === k)!.gexUsdMillions;
    expect(signedAt).toBeLessThan(naiveAt); // dealers less long ⇒ less positive GEX
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/chain.test.ts`
Expected: FAIL — `buildChain` accepts no 5th arg; signed case equals naive.

- [ ] **Step 3: Modify `chain.ts`**

Extend the core import (add `type BookLookup`, `type DealerPosition`):

```ts
import {
  buildComparisonChain,
  buildEnrichedChain,
  type BookLookup,
  type DealerPosition,
  EMPTY_GREEKS,
  type EnrichedChainResponse,
  type NormalizedOptionContract,
  type PremiumValue,
  type VenueId,
  type VenueOptionChain,
} from '@oggregator/core';
```

Add below the store imports:

```ts
import type { TradfiFlowBook } from './flow-book.js';
```

Replace the `buildChain` signature + final lines:

```ts
export function buildChain(
  store: TradfiStore,
  underlying: string,
  expiry: string,
  source: 'ws' | 'rest' = 'ws',
  flowBook?: TradfiFlowBook,
): EnrichedChainResponse {
  const insts = store.instrumentsFor(underlying, expiry);
  const spot = store.getSpot(underlying);
  const forward = deriveForward(insts, store, spot) ?? spot;
  const contracts: Record<string, NormalizedOptionContract> = {};

  for (const inst of insts) {
    const quote = store.getQuote(inst.streamerSymbol) ?? emptyQuote();
    contracts[inst.canonical] = toContract(inst, quote, forward, spot, source);
  }

  const venueChain: VenueOptionChain = {
    venue: TASTYTRADE_VENUE,
    underlying,
    expiry,
    asOf: Date.now(),
    contracts,
  };

  // Live-signed dealer book: magnitude from current OI, sign refined by net taker
  // flow. dealerContracts = naiveBase − netFlow, where naiveBase = ±OI. At zero
  // flow this reproduces the naive GEX exactly (computeGex negates puts itself).
  const lookup: BookLookup | undefined = flowBook
    ? (_venue, symbol) => {
        const c = contracts[symbol];
        if (c == null) return undefined;
        const oi = c.quote.openInterest;
        if (oi == null) return undefined;
        const naiveBase = c.right === 'call' ? oi : -oi;
        const pos: DealerPosition = {
          venue: TASTYTRADE_VENUE,
          symbol,
          underlying,
          expiry,
          strike: c.strike,
          optionType: c.right,
          dealerContracts: naiveBase - flowBook.netFlowFor(symbol),
          lastOi: oi,
          lastSnapshotTs: c.quote.timestamp ?? Date.now(),
        };
        return pos;
      }
    : undefined;

  const comparison = buildComparisonChain(underlying, expiry, [venueChain]);
  return buildEnrichedChain(underlying, expiry, comparison.rows, [venueChain], lookup);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/chain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/runtime/chain.ts packages/tradfi/src/runtime/chain.test.ts
git commit -m "feat(tradfi): signed dealer-flow GEX in buildChain via BookLookup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire `flowBook` through deps + chain routes

**Files:**
- Modify: `packages/tradfi/src/app.ts` (`TradfiDeps`)
- Modify: `packages/tradfi/src/routes/chains.ts` (2 call sites)
- Modify: `packages/tradfi/src/routes/ws-chain.ts` (`ChainPusher`)
- Modify: `packages/tradfi/src/index.ts` (wiring)

- [ ] **Step 1: Modify `app.ts`**

Add the import + the optional dep:

```ts
import type { TradfiFlowBook } from './runtime/flow-book.js';
```

```ts
export interface TradfiDeps {
  store: TradfiStore;
  feed: FeedLike;
  candleClient?: CandleClient;
  flowBook?: TradfiFlowBook;
}
```

- [ ] **Step 2: Modify `chains.ts`** — pass `deps.flowBook` to both `buildChain` calls

Both occurrences of `return buildChain(deps.store, underlying, expiry, 'ws');` become:

```ts
        return buildChain(deps.store, underlying, expiry, 'ws', deps.flowBook);
```

- [ ] **Step 3: Modify `ws-chain.ts`**

Add the import:

```ts
import type { TradfiFlowBook } from '../runtime/flow-book.js';
```

Extend `ChainPusher`:

```ts
export class ChainPusher {
  private disposed = false;
  constructor(
    private readonly store: TradfiStore,
    private readonly send: (data: string) => void,
    private readonly underlying: string,
    private readonly expiry: string,
    private readonly flowBook?: TradfiFlowBook,
  ) {}

  tick(): void {
    if (this.disposed) return;
    this.send(
      JSON.stringify(buildChain(this.store, this.underlying, this.expiry, 'ws', this.flowBook)),
    );
  }

  dispose(): void {
    this.disposed = true;
  }
}
```

Pass `deps.flowBook` at the construction site:

```ts
        const pusher = new ChainPusher(deps.store, (d) => socket.send(d), underlying, expiry, deps.flowBook);
```

- [ ] **Step 4: Modify `index.ts`** — share the feed's flow book with the routes

```ts
  const app = buildApp({ store, feed, candleClient, flowBook: feed.flowBook });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @oggregator/tradfi typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/tradfi/src/app.ts packages/tradfi/src/routes/chains.ts packages/tradfi/src/routes/ws-chain.ts packages/tradfi/src/index.ts
git commit -m "feat(tradfi): thread shared flow book into chain + ws routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `/gex-all-expiries` route

**Files:**
- Create: `packages/tradfi/src/routes/gex-all-expiries.ts`
- Modify: `packages/tradfi/src/app.ts` (register)
- Test: `packages/tradfi/src/routes/gex-all-expiries.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/tradfi/src/routes/gex-all-expiries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import type { TradfiReadiness } from '../tastytrade/feed.js';

function readyFeed() {
  const readiness: TradfiReadiness = {
    catalogLoaded: true, quoteTokenAcquired: true, streaming: true,
    lastDataTs: Date.now(), underlyings: 1, instruments: 2,
  };
  return {
    readiness: () => readiness,
    ensureChainSubscribed: () => {},
    refreshChainQuotes: async () => 0,
  };
}

function seed(store: TradfiStore) {
  store.setInstruments([
    { canonical: 'SPX-20260618-5000-C', streamerSymbol: '.A', underlying: 'SPX', expiry: '2026-06-18', strike: 5000, right: 'call', multiplier: 100 } as never,
    { canonical: 'SPX-20260619-5000-C', streamerSymbol: '.B', underlying: 'SPX', expiry: '2026-06-19', strike: 5000, right: 'call', multiplier: 100 } as never,
  ]);
  store.setSpot('SPX', 5000);
  store.mergeQuote('.A', { ts: 1, gamma: 0.001, openInterest: 1000, bid: 1, ask: 2, mark: 1.5 });
  store.mergeQuote('.B', { ts: 1, gamma: 0.001, openInterest: 500, bid: 1, ask: 2, mark: 1.5 });
}

describe('GET /gex-all-expiries', () => {
  it('aggregates signed GEX across all expiries for the underlying', async () => {
    const store = new TradfiStore();
    seed(store);
    const app = buildApp({ store, feed: readyFeed() });
    const res = await app.inject({ method: 'GET', url: '/gex-all-expiries?underlying=SPX' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { underlying: string; expiries: string[]; spotPrice: number | null; gex: Array<{ strike: number; gexUsdMillions: number }> };
    expect(body.underlying).toBe('SPX');
    expect(body.expiries).toEqual(['2026-06-18', '2026-06-19']);
    expect(body.spotPrice).toBe(5000);
    const at5000 = body.gex.find((g) => g.strike === 5000)!;
    expect(at5000.gexUsdMillions).toBeGreaterThan(0); // both expiries' call OI summed
    await app.close();
  });

  it('400s without an underlying', async () => {
    const app = buildApp({ store: new TradfiStore(), feed: readyFeed() });
    const res = await app.inject({ method: 'GET', url: '/gex-all-expiries' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/routes/gex-all-expiries.test.ts`
Expected: FAIL — route not registered (404).

- [ ] **Step 3: Write the route**

`packages/tradfi/src/routes/gex-all-expiries.ts`:

```ts
import { combineGex, type GexStrike } from '@oggregator/core';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';

export interface TradfiAllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export function gexAllExpiriesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>(
      '/gex-all-expiries',
      async (req, reply): Promise<TradfiAllExpiriesGexResponse | { error: string }> => {
        const { underlying } = req.query;
        if (!underlying) {
          return reply.status(400).send({ error: 'underlying query param required' });
        }

        const r = deps.feed.readiness();
        if (!r.catalogLoaded) {
          return reply.status(503).send({ error: 'catalog not loaded' });
        }

        const expiries = deps.store.listExpiries(underlying);
        if (expiries.length === 0) {
          return { underlying, expiries: [], spotPrice: null, gex: [] };
        }

        // Index-first scope: keep every expiry of this underlying streaming so the
        // ALL view fills in. ensureChainSubscribed is idempotent and self-throttles.
        const snapshots = expiries.map((expiry) => {
          deps.feed.ensureChainSubscribed(underlying, expiry);
          return buildChain(deps.store, underlying, expiry, 'ws', deps.flowBook);
        });

        const gex = combineGex(snapshots.map((s) => s.gex));
        const first = snapshots[0];
        const spotPrice =
          first != null ? (first.stats.indexPriceUsd ?? first.stats.forwardPriceUsd) : null;

        return { underlying, expiries, spotPrice, gex };
      },
    );
  };
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import:

```ts
import { gexAllExpiriesRoute } from './routes/gex-all-expiries.js';
```

Register alongside the others:

```ts
  void app.register(gexAllExpiriesRoute(deps));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/routes/gex-all-expiries.test.ts`
Expected: PASS.

- [ ] **Step 6: Full tradfi suite + commit**

Run: `pnpm --filter @oggregator/tradfi exec vitest run`
Expected: all green.

```bash
git add packages/tradfi/src/routes/gex-all-expiries.ts packages/tradfi/src/routes/gex-all-expiries.test.ts packages/tradfi/src/app.ts
git commit -m "feat(tradfi): /gex-all-expiries route aggregating signed GEX

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Export shared GEX rendering pieces

**Files:**
- Modify: `packages/web/src/features/gex/index.ts`

- [ ] **Step 1: Add additive exports** (no behavior change to `GexView`)

`packages/web/src/features/gex/index.ts`:

```ts
export { default as GexView } from './GexView';
export { computeGammaWalls, GEX_WALL_FLOOR_M, type GammaWalls } from './gex-wall-utils';
export { GammaChannelPrimitive } from './GammaChannelPrimitive';
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/features/gex/index.ts
git commit -m "refactor(web): export gex wall utils + channel primitive for reuse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `useTradfiAllExpiriesGex` hook

**Files:**
- Modify: `packages/web/src/features/tradfi/queries.ts`
- Test: `packages/web/src/features/tradfi/queries.test.ts` (exists — append)

- [ ] **Step 1: Write the failing test** (append)

```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import * as http from '@lib/tradfi-http';
import { useTradfiAllExpiriesGex } from './queries';

afterEach(() => vi.restoreAllMocks());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

it('useTradfiAllExpiriesGex fetches the aggregated payload', async () => {
  vi.spyOn(http, 'tradfiFetchJson').mockResolvedValue({
    underlying: 'SPX', expiries: ['2026-06-18'], spotPrice: 5000,
    gex: [{ strike: 5000, gexUsdMillions: 12 }],
  });
  const { result } = renderHook(() => useTradfiAllExpiriesGex('SPX'), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data?.gex[0]?.gexUsdMillions).toBe(12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/queries.test.ts`
Expected: FAIL — `useTradfiAllExpiriesGex` is not exported.

- [ ] **Step 3: Add the hook to `queries.ts`**

Add the import + key + hook:

```ts
import type { GexStrike } from '@shared/enriched';
```

```ts
export interface TradfiAllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export function useTradfiAllExpiriesGex(underlying: string, enabled = true) {
  return useQuery({
    queryKey: ['tradfi-gex-all', underlying] as const,
    queryFn: () =>
      tradfiFetchJson<TradfiAllExpiriesGexResponse>(
        `/gex-all-expiries?underlying=${encodeURIComponent(underlying)}`,
      ),
    enabled: enabled && Boolean(underlying),
    refetchInterval: 5000,
    placeholderData: (prev: TradfiAllExpiriesGexResponse | undefined) => prev,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/queries.ts packages/web/src/features/tradfi/queries.test.ts
git commit -m "feat(web): useTradfiAllExpiriesGex hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `TradfiGexBandsChart`

**Files:**
- Create: `packages/web/src/features/tradfi/TradfiGexBandsChart.tsx`

This reuses `computeGammaWalls` + `GammaChannelPrimitive` (Task 6) and the gex CSS module, but sources candles from `/underlying-candles`. No crypto file is modified.

- [ ] **Step 1: Write the component**

`packages/web/src/features/tradfi/TradfiGexBandsChart.tsx`:

```tsx
import { computeGammaWalls, GammaChannelPrimitive } from '@features/gex';
import gexStyles from '@features/gex/GexView.module.css';
import type { GexStrike } from '@shared/enriched';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type Time,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';

const CALL_WALL_COLOR = '#00E997';
const PUT_WALL_COLOR = '#CB3855';
const FLIP_COLOR = '#F0B90B';
const SPOT_COLOR = '#50D2C1';

// Range → interval mapping (both are protocol enums).
const RANGES: Array<{ range: InstrumentCandleRange; interval: InstrumentCandleInterval; label: string }> = [
  { range: '1d', interval: '5m', label: '1d' },
  { range: '7d', interval: '1h', label: '7d' },
  { range: '30d', interval: '4h', label: '30d' },
  { range: 'max', interval: '1d', label: 'max' },
];

function tsToSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

interface Props {
  underlying: string;
  gex: GexStrike[];
  spotPrice: number | null;
}

export default function TradfiGexBandsChart({ underlying, gex, spotPrice }: Props) {
  const [rangeIdx, setRangeIdx] = useState(2); // default 30d
  const sel = RANGES[rangeIdx]!;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const channelRef = useRef<GammaChannelPrimitive | null>(null);
  const callLineRef = useRef<IPriceLine | null>(null);
  const putLineRef = useRef<IPriceLine | null>(null);
  const flipLineRef = useRef<IPriceLine | null>(null);
  const spotLineRef = useRef<IPriceLine | null>(null);

  const { data, isLoading, error, refetch } = useTradfiUnderlyingCandles({
    underlying,
    interval: sel.interval,
    range: sel.range,
  });

  const walls = useMemo(() => computeGammaWalls(gex, spotPrice), [gex, spotPrice]);

  // Mount/unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa0a6',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: CALL_WALL_COLOR,
      downColor: PUT_WALL_COLOR,
      wickUpColor: CALL_WALL_COLOR,
      wickDownColor: PUT_WALL_COLOR,
      borderVisible: false,
      priceLineVisible: false,
    }) as ISeriesApi<'Candlestick', Time>;
    const channel = new GammaChannelPrimitive();
    series.attachPrimitive(channel);
    chartRef.current = chart;
    seriesRef.current = series;
    channelRef.current = channel;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      channelRef.current = null;
      callLineRef.current = null;
      putLineRef.current = null;
      flipLineRef.current = null;
      spotLineRef.current = null;
    };
  }, []);

  // Candle data.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data) return;
    series.setData(
      data.candles.map((c) => ({
        time: tsToSec(c.ts) as Time,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    );
  }, [data]);

  // Walls.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    channelRef.current?.update(walls.callWall, walls.putWall);
    const sync = (
      ref: React.MutableRefObject<IPriceLine | null>,
      price: number | null,
      color: string,
      label: string,
      dashed: boolean,
    ) => {
      if (ref.current) {
        series.removePriceLine(ref.current);
        ref.current = null;
      }
      if (price == null) return;
      ref.current = series.createPriceLine({
        price,
        color,
        lineWidth: 2,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(price).toLocaleString()} ${label}`,
      });
    };
    sync(callLineRef, walls.callWall, CALL_WALL_COLOR, 'CALL WALL', false);
    sync(putLineRef, walls.putWall, PUT_WALL_COLOR, 'PUT WALL', false);
    sync(flipLineRef, walls.gammaFlip, FLIP_COLOR, 'FLIP', true);
  }, [walls]);

  // Spot line.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (spotPrice != null) {
      spotLineRef.current = series.createPriceLine({
        price: spotPrice,
        color: SPOT_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(spotPrice).toLocaleString()} SPOT`,
      });
    }
  }, [spotPrice]);

  return (
    <div>
      <div className={gexStyles.bandsControls}>
        <div className={gexStyles.bandsToggle}>
          {RANGES.map((r, i) => (
            <button
              key={r.range}
              type="button"
              className={gexStyles.bandsTab}
              data-active={i === rangeIdx || undefined}
              onClick={() => setRangeIdx(i)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className={gexStyles.bandsChartWrap}>
        <div className={gexStyles.bandsChartCanvas} ref={containerRef} />
        {isLoading && !data && <div className={gexStyles.bandsOverlay}>Loading underlying history…</div>}
        {error && (
          <div className={gexStyles.bandsOverlay}>
            <div>Underlying history unavailable</div>
            <button type="button" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors. (If `computeGammaWalls`/`GammaChannelPrimitive` resolve errors, confirm Task 6 landed.)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/features/tradfi/TradfiGexBandsChart.tsx
git commit -m "feat(web): TradfiGexBandsChart over /underlying-candles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `TradfiGexView` page

**Files:**
- Create: `packages/web/src/features/tradfi/TradfiGexView.tsx`
- Test: `packages/web/src/features/tradfi/TradfiGexView.test.tsx`

Reuses `@features/gex/GexView.module.css` for visual parity. Per-expiry GEX comes from `useTradfiChain` (`chain.gex` + `chain.stats.indexPriceUsd`); ALL mode from `useTradfiAllExpiriesGex`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/features/tradfi/TradfiGexView.test.tsx`:

```tsx
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./queries', () => ({
  useTradfiExpiries: () => ({ data: { underlying: 'SPX', expiries: ['2026-06-18'] } }),
  useTradfiChain: () => ({
    data: {
      stats: { indexPriceUsd: 5000, forwardPriceUsd: 5000 },
      gex: [{ strike: 5000, gexUsdMillions: 12 }],
    },
    isLoading: false,
  }),
  useTradfiAllExpiriesGex: () => ({ data: { gex: [], spotPrice: 5000 }, isLoading: false }),
}));
vi.mock('@stores/app-store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel({ tradfiUnderlying: 'SPX' }) }));

import TradfiGexView from './TradfiGexView';

afterEach(cleanup);

it('renders the GEX title and a strike bar', () => {
  render(<TradfiGexView />);
  expect(screen.getByText(/Gamma Exposure/i)).toBeTruthy();
  expect(screen.getByText('5,000')).toBeTruthy(); // strike label
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/TradfiGexView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

`packages/web/src/features/tradfi/TradfiGexView.tsx`:

```tsx
import { EmptyState, Spinner } from '@components/ui';
import styles from '@features/gex/GexView.module.css';
import { dteDays, fmtUsd, formatExpiry } from '@lib/format';
import type { GexStrike } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useEffect, useState } from 'react';
import { useTradfiAllExpiriesGex, useTradfiChain, useTradfiExpiries } from './queries';
import TradfiGexBandsChart from './TradfiGexBandsChart';

type Mode = 'all' | string;
type Version = 'bars' | 'bands';

export default function TradfiGexView() {
  const underlying = useAppStore((s) => s.tradfiUnderlying);

  const { data: expiriesData } = useTradfiExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  const [mode, setMode] = useState<Mode>('');
  useEffect(() => {
    if (mode === 'all') return;
    if (expiries.length > 0 && (!mode || !expiries.includes(mode))) {
      setMode(expiries.length > 1 ? expiries[1]! : expiries[0]!);
    }
  }, [expiries, mode]);

  const isAll = mode === 'all';
  const [version, setVersion] = useState<Version>('bars');

  const { data: chain, isLoading: chainLoading } = useTradfiChain(underlying, isAll ? '' : mode);
  const { data: allGex, isLoading: allLoading } = useTradfiAllExpiriesGex(underlying, isAll);

  const gex: GexStrike[] = isAll ? (allGex?.gex ?? []) : (chain?.gex ?? []);
  const spotPrice = isAll
    ? (allGex?.spotPrice ?? null)
    : (chain?.stats.indexPriceUsd ?? chain?.stats.forwardPriceUsd ?? null);
  const isLoading = isAll ? allLoading : chainLoading;

  const maxMagnitude = Math.max(...gex.map((g) => Math.abs(g.gexUsdMillions)), 1);
  const sorted = [...gex].sort((a, b) => b.strike - a.strike);
  const nonzero = gex.filter((g) => Math.abs(g.gexUsdMillions) > 0.001);
  const spotStrike =
    spotPrice != null
      ? nonzero.reduce<number | null>((best, row) => {
          if (best == null) return row.strike;
          return Math.abs(row.strike - spotPrice) < Math.abs(best - spotPrice) ? row.strike : best;
        }, null)
      : null;

  if (isLoading && gex.length === 0) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading GEX data…" />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Gamma Exposure (GEX)</span>
            <div className={styles.gexModeToggle}>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={version === 'bars' || undefined}
                onClick={() => setVersion('bars')}
              >
                Bars
              </button>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={version === 'bands' || undefined}
                onClick={() => setVersion('bands')}
              >
                Bands
              </button>
            </div>
          </div>
          <span className={styles.subtitle}>Dealer hedging pressure per strike in $M</span>
        </div>
        {spotPrice != null && <div className={styles.spotBadge}>Spot: {fmtUsd(spotPrice)}</div>}
      </div>

      <div className={styles.expiryPicker}>
        <button
          key="all"
          className={styles.expiryBtn}
          data-active={isAll}
          onClick={() => setMode('all')}
          title="Sum GEX across every listed expiry"
        >
          ALL
          <span className={styles.dteBadge}>Σ</span>
        </button>
        {expiries.map((e) => {
          const dte = dteDays(e);
          return (
            <button
              key={e}
              className={styles.expiryBtn}
              data-active={e === mode}
              onClick={() => setMode(e)}
            >
              {formatExpiry(e)}
              <span className={styles.dteBadge} data-urgent={dte <= 1}>
                {dte}d
              </span>
            </button>
          );
        })}
      </div>

      {nonzero.length === 0 ? (
        <EmptyState
          icon="◈"
          title={isAll ? 'No GEX data across listed expiries' : 'No GEX data for this expiry'}
          detail="Open interest and flow populate once the chain has warmed."
        />
      ) : version === 'bands' ? (
        <TradfiGexBandsChart underlying={underlying} gex={gex} spotPrice={spotPrice} />
      ) : (
        <div className={styles.chart}>
          <div className={styles.axis}>
            <div className={styles.axisLeft}>
              <span className={styles.axisLabel}>← Negative (accelerator)</span>
            </div>
            <div className={styles.axisCenter}>0</div>
            <div className={styles.axisRight}>
              <span className={styles.axisLabel}>Positive (magnet) →</span>
            </div>
          </div>
          <div className={styles.bars}>
            {sorted.map((g) => {
              const pct = (Math.abs(g.gexUsdMillions) / maxMagnitude) * 100;
              const positive = g.gexUsdMillions >= 0;
              const isNearSpot = g.strike === spotStrike;
              return (
                <div key={g.strike} className={styles.barRow} data-near-spot={isNearSpot || undefined}>
                  <div className={styles.strikeLabel} data-near-spot={isNearSpot}>
                    {g.strike.toLocaleString()}
                    {isNearSpot && <span className={styles.spotMarker}>◄ SPOT</span>}
                  </div>
                  <div className={styles.barTrack}>
                    <div className={styles.leftHalf}>
                      {!positive && (
                        <div
                          className={styles.bar}
                          data-type="negative"
                          style={{ width: `${pct}%` }}
                          title={`${g.strike}: ${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                        />
                      )}
                    </div>
                    <div className={styles.spine} />
                    <div className={styles.rightHalf}>
                      {positive && (
                        <div
                          className={styles.bar}
                          data-type="positive"
                          style={{ width: `${pct}%` }}
                          title={`${g.strike}: +${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                        />
                      )}
                    </div>
                  </div>
                  <div className={styles.valueLabel}>
                    {positive ? '+' : ''}
                    {g.gexUsdMillions.toFixed(1)}M
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/TradfiGexView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/TradfiGexView.tsx packages/web/src/features/tradfi/TradfiGexView.test.tsx
git commit -m "feat(web): TradfiGexView page (bars + bands)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: TradFi page nav (Chain | GEX)

**Files:**
- Modify: `packages/web/src/stores/app-store.ts`
- Modify: `packages/web/src/features/tradfi/TradfiApp.tsx`
- Test: `packages/web/src/stores/app-store.test.ts` (exists — append)

- [ ] **Step 1: Write the failing test** (append to `app-store.test.ts`)

```ts
import { useAppStore } from './app-store';

it('tradfiPage defaults to chain and can switch to gex', () => {
  expect(useAppStore.getState().tradfiPage).toBe('chain');
  useAppStore.getState().setTradfiPage('gex');
  expect(useAppStore.getState().tradfiPage).toBe('gex');
  useAppStore.getState().setTradfiPage('chain'); // reset for other tests
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/stores/app-store.test.ts`
Expected: FAIL — `tradfiPage` undefined.

- [ ] **Step 3: Add state to `app-store.ts`**

Add the type near the top (after imports):

```ts
export type TradfiPage = 'chain' | 'gex';
```

In `interface AppState`, add the field + setter:

```ts
  tradfiPage: TradfiPage;
```
```ts
  setTradfiPage: (p: TradfiPage) => void;
```

In the store object, add the initial value (near `tradfiExpiry: ''`):

```ts
  tradfiPage: 'chain',
```

And the setter (near `setTradfiExpiry`):

```ts
  setTradfiPage: (tradfiPage) => set({ tradfiPage }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/stores/app-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the switcher into `TradfiApp.tsx`**

Replace the file body to add the nav + page mount:

```tsx
import { useAppStore } from '@stores/app-store';
import { useTradfiUnderlyings } from './queries';
import TradfiChainView from './TradfiChainView';
import TradfiGexView from './TradfiGexView';
import styles from './TradfiApp.module.css';

export default function TradfiApp() {
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const page = useAppStore((s) => s.tradfiPage);
  const setPage = useAppStore((s) => s.setTradfiPage);
  const { data } = useTradfiUnderlyings();
  const underlyings = data?.underlyings ?? [];

  return (
    <div className={styles.root} data-mode="tradfi">
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => setAssetMode('crypto')}>
          ← oggregator
        </button>
        <span className={styles.brand}>TRADFI</span>
        <nav className={styles.pageNav}>
          <button
            type="button"
            className={styles.pageTab}
            data-active={page === 'chain' || undefined}
            onClick={() => setPage('chain')}
          >
            Chain
          </button>
          <button
            type="button"
            className={styles.pageTab}
            data-active={page === 'gex' || undefined}
            onClick={() => setPage('gex')}
          >
            GEX
          </button>
        </nav>
        <select
          className={styles.select}
          value={underlying}
          onChange={(e) => setUnderlying(e.target.value)}
        >
          {underlyings.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <span className={styles.delayed}>15-min delayed</span>
      </header>
      <main className={styles.main}>{page === 'gex' ? <TradfiGexView /> : <TradfiChainView />}</main>
    </div>
  );
}
```

- [ ] **Step 6: Add nav styles to `TradfiApp.module.css`**

Append:

```css
.pageNav {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}
.pageTab {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #1f2937;
  border-radius: 6px;
  color: #9aa0a6;
  font: inherit;
  cursor: pointer;
}
.pageTab[data-active] {
  color: #e6e6e6;
  border-color: #50d2c1;
  background: #0e3333;
}
```

- [ ] **Step 7: Run the existing TradfiApp test (if present) + commit**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/`
Expected: green (no existing TradfiApp render test should regress; `TradfiChainView` still mounts on the default page).

```bash
git add packages/web/src/stores/app-store.ts packages/web/src/stores/app-store.test.ts packages/web/src/features/tradfi/TradfiApp.tsx packages/web/src/features/tradfi/TradfiApp.module.css
git commit -m "feat(web): TradFi Chain | GEX page nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full verification + regression

**Files:** none (verification only)

- [ ] **Step 1: TradFi package — full suite + typecheck**

Run: `pnpm --filter @oggregator/tradfi exec vitest run`
Run: `pnpm --filter @oggregator/tradfi typecheck`
Expected: all green.

- [ ] **Step 2: Web package — full suite + typecheck + build**

Run: `pnpm --filter @oggregator/web exec vitest run`
Run: `pnpm --filter @oggregator/web typecheck`
Run: `pnpm --filter @oggregator/web build`
Expected: all green.

- [ ] **Step 3: Crypto-GEX regression sanity**

Confirm no crypto files changed except the additive `features/gex/index.ts` exports:

Run: `git diff --stat main -- packages/web/src/features/gex packages/server packages/core`
Expected: only `packages/web/src/features/gex/index.ts` appears (3 added export lines); `GexView.tsx`, `GexBandsChart.tsx`, `packages/server`, `packages/core` untouched.

- [ ] **Step 4: TradFi `/chains` non-GEX regression**

Reason about the diff: `buildChain` only adds a `bookLookup`; `computeGex` is the sole consumer. `strikes`, `stats`, greeks, quotes in `EnrichedChainResponse` are unchanged. The existing `TradfiChainView.test.tsx` and `chains` tests must still pass (covered by Step 1).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(tradfi-gex): verification pass — suites + typecheck + build green

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deploy notes (post-merge, not part of task execution)

- Ship is a **manual Scaleway redeploy** of `@oggregator/tradfi` + the web build. **No DB migration** — the flow book is in-memory.
- If the web app reaches TradFi via `VITE_TRADFI_API_BASE`, no change is needed; the new `/gex-all-expiries` route is served by the same TradFi service.
- The ALL-expiries view force-subscribes every expiry of the chosen underlying (index-first scope). Watch DXLink subscription volume on first rollout for the widest index (SPX); if it strains the feed, gate ALL behind an explicit toggle or cap the number of expiries.

## Out of scope (v1)

- Persisted flow history / dealer book (resets on restart by design).
- Equity single-name coverage at scale (index-first only).
- DRY extraction of the shared bars renderer + bands chart (v1 duplicates into the TradFi feature to keep crypto byte-identical; a later refactor can extract a presentational core).
