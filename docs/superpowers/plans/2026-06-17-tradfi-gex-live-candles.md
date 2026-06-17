# TradFi GEX Live Underlying Candles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream real OHLC+volume for the TradFi GEX Bands underlying chart via a live DXLink candle subscription, so the forming candle counts per its timeframe and the spot line rides the live close.

**Architecture:** Extend the existing isolated one-shot `CandleClient` with a ref-counted live registry (`subscribeLive`) plus a guarded unsubscribe; add a `/ws/underlying-candles` Fastify route that mirrors `/ws/chain` and pushes coalesced bars; on the web, add a `tradfiWsUrl` helper, a minimal `useTradfiUnderlyingCandlesLive` hook (modeled on `useChainWs`), and wire `TradfiGexBandsChart` to call `series.update` per live bar. GEX walls stay on the existing 5s poll. No new DXLink socket; the one-shot path is byte-identical except one guarded line.

**Tech Stack:** TypeScript, Node + Fastify + `@fastify/websocket` (`@oggregator/tradfi`); React 19 + Vite + TanStack Query + lightweight-charts + Zod v4 (`@oggregator/web`); Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-tradfi-gex-live-candles-design.md`

## Global Constraints

- **No new DXLink socket.** Reuse the channel-1 candle client. The one-shot `getCandles` path stays byte-identical except the `finish()` unsubscribe becomes guarded.
- **Crypto GEX byte-identical; TradFi `/chains`, walls, and Bars view untouched.** Only the Bands candle source changes.
- **Entitlement-agnostic.** TastyTrade is on the free/delayed (~15-min) tier today; real-time arrives on the paid flip with **no code change**. Delayed/stepped updates while testing are the feed, not a bug.
- **Web — Local Zod v4 schemas only.** Do NOT import the protocol's Zod v3 schemas into a Zod v4 `z.object()` (they fail at runtime). Mirror `use-tradfi-underlying-candles.ts`.
- **Web rules:** use `import.meta.env.VITE_*` (never `process.env`); server state via TanStack Query, never Zustand; import only from a feature's `index.ts`; CSS Modules; no `const enum`; path aliases live in `tsconfig.json` + `vite.config.ts`.
- **Web test gotchas:** vitest `globals:false` → import `describe/it/expect/vi` from `vitest`; jsdom has no `matchMedia` (mock `useIsMobile` if a component needs it); plain matchers (no jest-dom); explicit `cleanup()` in `afterEach`; no array-index keys.
- **Every commit ends with this trailer** (shown in full in each commit step):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Deploy (after the plan):** TradFi is the separate `@oggregator/tradfi` service → **manual Scaleway redeploy**; no DB migration. Web: standard build + redeploy. `docs/` is gitignored → `git add -f` the spec/plan.

**Branch:** `feat/tradfi-gex-live-candles` (already created off `main`).

---

## Task 1: Backend — single-bar candle mapper

Factor the per-bar `RawCandle → DTO` mapping out of `mapRawCandles` so the WS route and the REST path produce byte-identical bars.

**Files:**
- Modify: `packages/tradfi/src/runtime/candles.ts`
- Test: `packages/tradfi/src/runtime/candles.test.ts` (create if absent; else append the `describe` block)

**Interfaces:**
- Produces: `export type CandleDto = { ts: number; o: number; h: number; l: number; c: number; vol: number; synthetic: boolean }` and `export function mapRawCandle(bar: RawCandle): CandleDto | null` (returns `null` for a bar with non-finite `time<0`/`o`/`h`/`l`/`c`).

- [ ] **Step 1: Write the failing test**

Add to `packages/tradfi/src/runtime/candles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapRawCandle } from './candles.js';
import type { RawCandle } from '../tastytrade/candle-codec.js';

function raw(over: Partial<RawCandle> = {}): RawCandle {
  return { symbol: 'SPX{=5m}', flags: 0, time: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, v: 3, ...over };
}

describe('mapRawCandle', () => {
  it('maps a finite bar to a DTO', () => {
    expect(mapRawCandle(raw())).toEqual({ ts: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, vol: 3, synthetic: false });
  });
  it('returns null for a non-finite close', () => {
    expect(mapRawCandle(raw({ c: Number.NaN }))).toBeNull();
  });
  it('clamps a negative/NaN volume to 0', () => {
    expect(mapRawCandle(raw({ v: Number.NaN }))?.vol).toBe(0);
    expect(mapRawCandle(raw({ v: -5 }))?.vol).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/candles.test.ts`
Expected: FAIL — `mapRawCandle is not a function` / no exported member `mapRawCandle`.

- [ ] **Step 3: Implement the mapper and refactor `mapRawCandles` to use it**

In `packages/tradfi/src/runtime/candles.ts`, replace the existing `mapRawCandles` function (lines ~40-62) with:

```ts
export type CandleDto = TradfiCandlesResponse['candles'][number];

export function mapRawCandle(b: RawCandle): CandleDto | null {
  if (
    !Number.isFinite(b.time) ||
    b.time < 0 ||
    !Number.isFinite(b.o) ||
    !Number.isFinite(b.h) ||
    !Number.isFinite(b.l) ||
    !Number.isFinite(b.c)
  ) {
    return null;
  }
  return {
    ts: b.time,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    // Clamp to the downstream schema's non-negative contract; a malformed bar
    // must not fail the whole response parse on the web side.
    vol: Number.isFinite(b.v) && b.v >= 0 ? b.v : 0,
    synthetic: false,
  };
}

function mapRawCandles(raw: RawCandle[]): TradfiCandlesResponse['candles'] {
  return raw.map(mapRawCandle).filter((c): c is CandleDto => c !== null);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/candles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/runtime/candles.ts packages/tradfi/src/runtime/candles.test.ts
git commit -m "refactor(tradfi): extract single-bar mapRawCandle for reuse" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — `CandleClient` live registry + guarded unsubscribe

Add a ref-counted live subscription path alongside the one-shot `pending` map. The DXLink subscription for a symbol is removed only when both the one-shot and live consumers are gone.

**Files:**
- Modify: `packages/tradfi/src/tastytrade/candle-client.ts`
- Test: `packages/tradfi/src/tastytrade/candle-client.test.ts` (append a new `describe`, reuse the existing `fakeSocket()` helper)

**Interfaces:**
- Consumes: existing `buildCandleSubscribe`, `buildCandleUnsubscribe`, `CANDLE_CHANNEL`, `isSnapshotComplete`, `RawCandle` (already imported in this file).
- Produces: `subscribeLive(streamerSymbol: string, period: string, fromTimeSec: number, onBar: (bar: RawCandle) => void): () => void` — returns an unsubscribe function. Live consumers receive every finite snapshot **and** live-tail bar for `${streamerSymbol}{=${period}}`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/tradfi/src/tastytrade/candle-client.test.ts` (the `fakeSocket()` helper at the top of that file is reused):

```ts
describe('CandleClient live', () => {
  function ready() {
    const fs = fakeSocket();
    const client = new CandleClient({
      getToken: async () => ({ token: 'T', dxlinkUrl: 'wss://x' }),
      socketFactory: () => fs.sock,
      now: () => 1_700_000_000_000,
    });
    return { fs, client };
  }
  function adds(sent: unknown[]): unknown[] {
    return sent.filter((m) => (m as { type?: string; add?: unknown }).type === 'FEED_SUBSCRIPTION' && (m as { add?: unknown }).add);
  }
  function removes(sent: unknown[]): unknown[] {
    return sent.filter((m) => (m as { type?: string; remove?: unknown }).type === 'FEED_SUBSCRIPTION' && (m as { remove?: unknown }).remove);
  }

  it('subscribes and forwards finite live bars to the consumer', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const seen: number[] = [];
    client.subscribeLive('SPX', '5m', 1, (bar) => seen.push(bar.c));
    expect(adds(fs.sent)).toHaveLength(1);

    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0, 1781553000000, 1, 2, 0, 1.5, 9]] });
    // a terminal SNAPSHOT_END (NaN) bar must NOT tear the live subscription down
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0x0a, 1781553300000, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN']] });

    expect(seen).toEqual([1.5]);
    expect(removes(fs.sent)).toHaveLength(0);
  });

  it('ref-counts: one add for two consumers, removes only after the last leaves', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const a: number[] = [];
    const b: number[] = [];
    const offA = client.subscribeLive('SPX', '5m', 1, (bar) => a.push(bar.c));
    const offB = client.subscribeLive('SPX', '5m', 1, (bar) => b.push(bar.c));
    expect(adds(fs.sent)).toHaveLength(1); // second consumer rides the same wire sub

    offA();
    expect(removes(fs.sent)).toHaveLength(0);

    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0, 1781553000000, 1, 1, 1, 2, 1]] });
    expect(a).toEqual([]); // A unsubscribed
    expect(b).toEqual([2]);

    offB();
    expect(removes(fs.sent)).toHaveLength(1);
  });

  it('does not unsubscribe while a one-shot is still pending for the same symbol, and vice-versa', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const off = client.subscribeLive('SPX', '5m', 1, () => {});
    const p = client.getCandles('SPX', '5m', 1); // one-shot for the same symbol

    // one-shot completes -> must NOT remove (live still present)
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0x08, 1781553000000, 1, 1, 1, 1, 1]] });
    await p;
    expect(removes(fs.sent)).toHaveLength(0);

    // now drop the live consumer -> remove fires (nothing left)
    off();
    expect(removes(fs.sent)).toHaveLength(1);
  });

  it('queues the subscribe until the feed is ready', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen(); // open but NOT ready (no FEED_CONFIG)

    client.subscribeLive('SPX', '5m', 1, () => {});
    expect(adds(fs.sent)).toHaveLength(0);

    fs.emit({ type: 'FEED_CONFIG', channel: 1 });
    expect(adds(fs.sent)).toHaveLength(1);
  });

  it('dispose clears live consumers', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const seen: number[] = [];
    client.subscribeLive('SPX', '5m', 1, (bar) => seen.push(bar.c));
    client.dispose();
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0, 1781553000000, 1, 1, 1, 9, 1]] });
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/candle-client.test.ts`
Expected: FAIL — `client.subscribeLive is not a function`.

- [ ] **Step 3: Implement the live registry**

In `packages/tradfi/src/tastytrade/candle-client.ts`:

(a) Add the field next to `private pending = ...`:

```ts
private live = new Map<string, Set<(bar: RawCandle) => void>>(); // keyed by candle symbol "SYM{=period}"
```

(b) Replace `onData` (lines ~93-102) with:

```ts
private onData(bars: RawCandle[]): void {
  for (const bar of bars) {
    const req = this.pending.get(bar.symbol);
    if (req !== undefined) {
      if (Number.isFinite(bar.c) && Number.isFinite(bar.time)) req.buffer.push(bar);
      if (isSnapshotComplete(bar.flags)) this.finish(bar.symbol);
    }
    const subs = this.live.get(bar.symbol);
    if (subs !== undefined && Number.isFinite(bar.c) && Number.isFinite(bar.time)) {
      for (const cb of subs) cb(bar);
    }
  }
}
```

(c) Replace `finish` (lines ~104-112) — swap the unconditional unsubscribe for the guard:

```ts
private finish(candleSymbol: string): void {
  const req = this.pending.get(candleSymbol);
  if (!req) return;
  clearTimeout(req.timer);
  this.pending.delete(candleSymbol);
  this.maybeUnsubscribe(candleSymbol);
  req.buffer.sort((a, b) => a.time - b.time);
  req.resolve(req.buffer);
}

private maybeUnsubscribe(candleSymbol: string): void {
  if (this.pending.has(candleSymbol)) return;
  if ((this.live.get(candleSymbol)?.size ?? 0) > 0) return;
  this.sock?.send(buildCandleUnsubscribe(CANDLE_CHANNEL, candleSymbol));
}

subscribeLive(
  streamerSymbol: string,
  period: string,
  fromTimeSec: number,
  onBar: (bar: RawCandle) => void,
): () => void {
  const candleSymbol = `${streamerSymbol}{=${period}}`;
  let subs = this.live.get(candleSymbol);
  const firstForSymbol = subs === undefined || subs.size === 0;
  if (subs === undefined) {
    subs = new Set();
    this.live.set(candleSymbol, subs);
  }
  subs.add(onBar);
  if (firstForSymbol) {
    const sendSub = () => {
      if ((this.live.get(candleSymbol)?.size ?? 0) > 0) {
        this.sock?.send(buildCandleSubscribe(CANDLE_CHANNEL, candleSymbol, fromTimeSec));
      }
    };
    if (this.ready) sendSub();
    else this.readyWaiters.push(sendSub);
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const set = this.live.get(candleSymbol);
    if (!set) return;
    set.delete(onBar);
    if (set.size === 0) this.live.delete(candleSymbol);
    this.maybeUnsubscribe(candleSymbol);
  };
}
```

(d) In `dispose()` (lines ~142-152), add `this.live.clear();` right after `this.pending.clear();`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/candle-client.test.ts`
Expected: PASS — the 2 original tests + 5 new live tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/candle-client.ts packages/tradfi/src/tastytrade/candle-client.test.ts
git commit -m "feat(tradfi): ref-counted live candle subscriptions in CandleClient" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend — `/ws/underlying-candles` route

A `CandleStreamer` coalesces bars per `ts` and flushes them on a 200ms interval (mirrors `ChainPusher`); the route subscribes via `subscribeLive` and tears down on socket close.

**Files:**
- Create: `packages/tradfi/src/routes/ws-underlying-candles.ts`
- Modify: `packages/tradfi/src/app.ts`
- Test: `packages/tradfi/src/routes/ws-underlying-candles.test.ts`

**Interfaces:**
- Consumes: `mapRawCandle` (Task 1), `CandleClient.subscribeLive` (Task 2), `intervalToPeriod` + `RawCandle` (candle-codec), `InstrumentCandleIntervalSchema` (`@oggregator/protocol`), `TradfiDeps` (`../app.js`).
- Produces: `export class CandleStreamer { onBar(bar: RawCandle): void; flush(): void; dispose(): void }`, `export function wsUnderlyingCandlesRoute(deps: TradfiDeps)`. Wire message: `{ type: 'bar', ts, o, h, l, c, vol }`.

- [ ] **Step 1: Write the failing test**

Create `packages/tradfi/src/routes/ws-underlying-candles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CandleStreamer } from './ws-underlying-candles.js';
import type { RawCandle } from '../tastytrade/candle-codec.js';

function bar(time: number, c: number, over: Partial<RawCandle> = {}): RawCandle {
  return { symbol: 'SPX{=5m}', flags: 0, time, o: c, h: c, l: c, c, v: 1, ...over };
}

describe('CandleStreamer', () => {
  it('flushes a mapped bar as JSON', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.onBar(bar(1781553000000, 56));
    s.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: 'bar', ts: 1781553000000, c: 56 });
  });

  it('coalesces repeated updates to the same ts into one send with the latest values', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.onBar(bar(1781553000000, 56));
    s.onBar(bar(1781553000000, 57, { h: 57 }));
    s.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).c).toBe(57);
  });

  it('drops invalid bars (non-finite close)', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.onBar(bar(1781553000000, Number.NaN));
    s.flush();
    expect(sent).toHaveLength(0);
  });

  it('sends nothing after dispose', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.dispose();
    s.onBar(bar(1781553000000, 56));
    s.flush();
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/routes/ws-underlying-candles.test.ts`
Expected: FAIL — cannot find module `./ws-underlying-candles.js` / no export `CandleStreamer`.

- [ ] **Step 3: Implement the route**

Create `packages/tradfi/src/routes/ws-underlying-candles.ts`:

```ts
import { InstrumentCandleIntervalSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { mapRawCandle } from '../runtime/candles.js';
import { intervalToPeriod, type RawCandle } from '../tastytrade/candle-codec.js';

const FLUSH_INTERVAL_MS = 200;

// Recent window the live subscription replays before streaming; scaled to the
// interval so it always includes the current forming bar. The full history
// still comes from the REST /underlying-candles snapshot.
const INTERVAL_TO_SECONDS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

interface LiveBarMessage { type: 'bar'; ts: number; o: number; h: number; l: number; c: number; vol: number }

export class CandleStreamer {
  private disposed = false;
  private latest = new Map<number, LiveBarMessage>(); // keyed by bar ts; holds the latest state since last flush

  constructor(private readonly send: (data: string) => void) {}

  onBar(bar: RawCandle): void {
    if (this.disposed) return;
    const dto = mapRawCandle(bar);
    if (!dto) return;
    this.latest.set(dto.ts, { type: 'bar', ts: dto.ts, o: dto.o, h: dto.h, l: dto.l, c: dto.c, vol: dto.vol });
  }

  flush(): void {
    if (this.disposed || this.latest.size === 0) return;
    const bars = [...this.latest.values()].sort((a, b) => a.ts - b.ts);
    this.latest.clear();
    for (const b of bars) this.send(JSON.stringify(b));
  }

  dispose(): void {
    this.disposed = true;
    this.latest.clear();
  }
}

export function wsUnderlyingCandlesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; interval?: string } }>(
      '/ws/underlying-candles',
      { websocket: true },
      (socket, req) => {
        const { underlying, interval } = req.query;
        const i = InstrumentCandleIntervalSchema.safeParse(interval);
        if (!underlying || !i.success) {
          socket.send(JSON.stringify({ type: 'error', message: 'underlying and interval required' }));
          socket.close();
          return;
        }
        if (!deps.candleClient || !deps.candleClient.isReady()) {
          socket.send(JSON.stringify({ type: 'error', message: 'candle feed not ready' }));
          socket.close();
          return;
        }
        const period = intervalToPeriod(i.data);
        const windowSec = (INTERVAL_TO_SECONDS[i.data] ?? 300) * 3;
        const fromTime = Math.floor(Date.now() / 1000) - windowSec;
        const streamer = new CandleStreamer((d) => socket.send(d));
        const unsub = deps.candleClient.subscribeLive(underlying, period, fromTime, (bar) => streamer.onBar(bar));
        const timer = setInterval(() => streamer.flush(), FLUSH_INTERVAL_MS);
        socket.on('close', () => {
          clearInterval(timer);
          unsub();
          streamer.dispose();
        });
      },
    );
  };
}
```

- [ ] **Step 4: Register the route in `app.ts`**

In `packages/tradfi/src/app.ts`, add the import next to the other route imports:

```ts
import { wsUnderlyingCandlesRoute } from './routes/ws-underlying-candles.js';
```

and register it next to `wsChainRoute` inside `buildApp`:

```ts
  void app.register(wsChainRoute(deps));
  void app.register(wsUnderlyingCandlesRoute(deps));
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/routes/ws-underlying-candles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/tradfi/src/routes/ws-underlying-candles.ts packages/tradfi/src/routes/ws-underlying-candles.test.ts packages/tradfi/src/app.ts
git commit -m "feat(tradfi): /ws/underlying-candles live candle stream route" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web — `tradfiWsUrl` helper

Derive a `ws(s)://` URL for the TradFi service from the same base the REST client uses.

**Files:**
- Modify: `packages/web/src/lib/tradfi-http.ts`
- Test: `packages/web/src/lib/tradfi-http.test.ts`

**Interfaces:**
- Produces: `export function tradfiWsUrl(path: string): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/tradfi-http.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tradfiWsUrl } from './tradfi-http';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tradfiWsUrl', () => {
  it('derives a ws URL from the default relative base against the current host', () => {
    vi.stubEnv('VITE_TRADFI_API_BASE', '');
    vi.stubEnv('VITE_TRADFI_WS_URL', '');
    expect(tradfiWsUrl('/ws/underlying-candles?underlying=SPX&interval=5m')).toBe(
      `ws://${window.location.host}/tradfi-api/ws/underlying-candles?underlying=SPX&interval=5m`,
    );
  });

  it('uses wss for an absolute https base and preserves the path + query', () => {
    vi.stubEnv('VITE_TRADFI_WS_URL', '');
    vi.stubEnv('VITE_TRADFI_API_BASE', 'https://tradfi.example.com');
    expect(tradfiWsUrl('/ws/underlying-candles?underlying=SPX&interval=5m')).toBe(
      'wss://tradfi.example.com/ws/underlying-candles?underlying=SPX&interval=5m',
    );
  });

  it('honors an explicit VITE_TRADFI_WS_URL override', () => {
    vi.stubEnv('VITE_TRADFI_WS_URL', 'wss://ws.example.com/');
    expect(tradfiWsUrl('/ws/underlying-candles?underlying=SPX')).toBe(
      'wss://ws.example.com/ws/underlying-candles?underlying=SPX',
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/lib/tradfi-http.test.ts`
Expected: FAIL — no exported member `tradfiWsUrl`.

- [ ] **Step 3: Implement the helper**

Append to `packages/web/src/lib/tradfi-http.ts`:

```ts
export function tradfiWsUrl(path: string): string {
  const wsOverride = import.meta.env.VITE_TRADFI_WS_URL;
  if (wsOverride) return `${wsOverride.replace(/\/$/, '')}${path}`;
  const raw = import.meta.env.VITE_TRADFI_API_BASE;
  if (raw && /^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = u.pathname.replace(/\/$/, '');
    return `${proto}//${u.host}${basePath}${path}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = (raw || '/tradfi-api').replace(/\/$/, '');
  return `${proto}//${window.location.host}${base}${path}`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/lib/tradfi-http.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/tradfi-http.ts packages/web/src/lib/tradfi-http.test.ts
git commit -m "feat(web): tradfiWsUrl helper for the TradFi service" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Web — `useTradfiUnderlyingCandlesLive` hook

A minimal WS consumer modeled on `useChainWs`: idempotent connect, backoff reconnect, StrictMode-safe teardown, params via ref, stable `onBar` via ref.

**Files:**
- Create: `packages/web/src/features/tradfi/use-tradfi-underlying-candles-live.ts`
- Test: `packages/web/src/features/tradfi/use-tradfi-underlying-candles-live.test.ts`

**Interfaces:**
- Consumes: `tradfiWsUrl` (Task 4).
- Produces: `export type LiveBar = { ts: number; o: number; h: number; l: number; c: number; vol: number }` and `export function useTradfiUnderlyingCandlesLive(args: { underlying: string; interval: InstrumentCandleInterval; enabled?: boolean; onBar: (bar: LiveBar) => void }): { connectionState: 'closed' | 'connecting' | 'live' | 'reconnecting' }`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/features/tradfi/use-tradfi-underlying-candles-live.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  pushMessage(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  static reset() { MockWebSocket.instances = []; }
}

vi.stubGlobal('WebSocket', MockWebSocket);

const { useTradfiUnderlyingCandlesLive } = await import('./use-tradfi-underlying-candles-live');

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

function bar(ts: number, c: number) {
  return { type: 'bar', ts, o: c, h: c, l: c, c, vol: 1 };
}

describe('useTradfiUnderlyingCandlesLive', () => {
  it('opens a socket with the underlying + interval in the URL', async () => {
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain('/ws/underlying-candles?underlying=SPX&interval=5m');
  });

  it('calls onBar for a valid bar message and ignores invalid messages', async () => {
    const seen: number[] = [];
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: (b) => seen.push(b.c) }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const ws = MockWebSocket.instances[0]!;
    await act(() => { ws.pushMessage(bar(1781553000000, 56.5)); });
    await act(() => { ws.pushMessage({ type: 'noise' }); });
    expect(seen).toEqual([56.5]);
  });

  it('does not connect when disabled or when underlying is empty', async () => {
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', enabled: false, onBar: () => {} }));
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: '', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('reconnects after the socket closes', async () => {
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const ws = MockWebSocket.instances[0]!;
    await act(() => { ws.onclose?.(); });
    await act(() => vi.advanceTimersByTimeAsync(1600)); // backoff for attempt 0 (<=1500ms)
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('tears down on unmount without reconnecting', async () => {
    const { unmount } = renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/use-tradfi-underlying-candles-live.test.ts`
Expected: FAIL — cannot find module `./use-tradfi-underlying-candles-live`.

- [ ] **Step 3: Implement the hook**

Create `packages/web/src/features/tradfi/use-tradfi-underlying-candles-live.ts`:

```ts
import { tradfiWsUrl } from '@lib/tradfi-http';
import type { InstrumentCandleInterval } from '@oggregator/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

// Local Zod v4 schema (see use-tradfi-underlying-candles.ts — do NOT use the
// protocol's Zod v3 schemas inside a v4 z.object()).
const LiveBarSchema = z.object({
  type: z.literal('bar'),
  ts: z.number().int().nonnegative(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  vol: z.number(),
});

export type LiveBar = { ts: number; o: number; h: number; l: number; c: number; vol: number };
export type LiveConnectionState = 'closed' | 'connecting' | 'live' | 'reconnecting';

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

export function useTradfiUnderlyingCandlesLive(args: {
  underlying: string;
  interval: InstrumentCandleInterval;
  enabled?: boolean;
  onBar: (bar: LiveBar) => void;
}): { connectionState: LiveConnectionState } {
  const { underlying, interval, enabled = true, onBar } = args;

  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;

  const [connectionState, setConnectionState] = useState<LiveConnectionState>('closed');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsRef = useRef({ underlying, interval });
  paramsRef.current = { underlying, interval };

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    const { underlying: u, interval: iv } = paramsRef.current;
    if (!u) return;
    const url = tradfiWsUrl(`/ws/underlying-candles?underlying=${encodeURIComponent(u)}&interval=${iv}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setConnectionState('connecting');

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnectionState('live');
    };
    ws.onmessage = (event: MessageEvent) => {
      let json: unknown;
      try {
        json = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const parsed = LiveBarSchema.safeParse(json);
      if (!parsed.success) return;
      const { ts, o, h, l, c, vol } = parsed.data;
      onBarRef.current({ ts, o, h, l, c, vol });
    };
    ws.onclose = () => {
      wsRef.current = null;
      setConnectionState('reconnecting');
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectRef.current) return;
    const delay = backoffMs(attemptRef.current);
    attemptRef.current++;
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    attemptRef.current = 0;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000, 'unmount');
      wsRef.current = null;
    }
    setConnectionState('closed');
  }, []);

  // Reconnect when params change (underlying + interval are URL-encoded, so a
  // change needs a fresh socket) and tear down on unmount. React runs the
  // cleanup before re-running the effect, so an interval switch closes the old
  // socket before opening the new one.
  useEffect(() => {
    if (!enabled || !underlying) {
      disconnect();
      return;
    }
    connect();
    return () => disconnect();
  }, [enabled, underlying, interval, connect, disconnect]);

  return { connectionState };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/use-tradfi-underlying-candles-live.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/tradfi/use-tradfi-underlying-candles-live.ts packages/web/src/features/tradfi/use-tradfi-underlying-candles-live.test.ts
git commit -m "feat(web): useTradfiUnderlyingCandlesLive WS hook" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Web — wire live candles into `TradfiGexBandsChart`

Extract a pure bar mapper, then feed live bars to `series.update` and drive the spot line from the live close. REST history stays as first paint + fallback; walls untouched.

**Files:**
- Create: `packages/web/src/features/tradfi/live-candle.ts`
- Create: `packages/web/src/features/tradfi/live-candle.test.ts`
- Modify: `packages/web/src/features/tradfi/TradfiGexBandsChart.tsx`
- Test: `packages/web/src/features/tradfi/TradfiGexBandsChart.test.tsx`

**Interfaces:**
- Consumes: `useTradfiUnderlyingCandlesLive` + `LiveBar` (Task 5).
- Produces: `export function tsToSec(ts: number): number`, `export function liveBarToCandle(bar: Pick<LiveBar, 'ts' | 'o' | 'h' | 'l' | 'c'>): { time: Time; open: number; high: number; low: number; close: number }`.

- [ ] **Step 1: Write the failing test for the pure mapper**

Create `packages/web/src/features/tradfi/live-candle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { liveBarToCandle, tsToSec } from './live-candle';

describe('live-candle', () => {
  it('tsToSec converts millisecond timestamps to seconds', () => {
    expect(tsToSec(1781553300000)).toBe(1781553300);
    expect(tsToSec(1781553300)).toBe(1781553300);
  });
  it('liveBarToCandle maps a live bar to a lightweight-charts point', () => {
    expect(liveBarToCandle({ ts: 1781553300000, o: 1, h: 2, l: 0, c: 1.5 })).toEqual({
      time: 1781553300,
      open: 1,
      high: 2,
      low: 0,
      close: 1.5,
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/live-candle.test.ts`
Expected: FAIL — cannot find module `./live-candle`.

- [ ] **Step 3: Implement the pure mapper**

Create `packages/web/src/features/tradfi/live-candle.ts`:

```ts
import type { Time } from 'lightweight-charts';
import type { LiveBar } from './use-tradfi-underlying-candles-live';

export function tsToSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

export function liveBarToCandle(
  bar: Pick<LiveBar, 'ts' | 'o' | 'h' | 'l' | 'c'>,
): { time: Time; open: number; high: number; low: number; close: number } {
  return { time: tsToSec(bar.ts) as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/live-candle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing wiring test**

Create `packages/web/src/features/tradfi/TradfiGexBandsChart.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let capturedOnBar: ((bar: { ts: number; o: number; h: number; l: number; c: number; vol: number }) => void) | null = null;

vi.mock('./use-tradfi-underlying-candles-live', () => ({
  useTradfiUnderlyingCandlesLive: (args: { onBar: (b: unknown) => void }) => {
    capturedOnBar = args.onBar as typeof capturedOnBar;
    return { connectionState: 'live' };
  },
}));

vi.mock('./use-tradfi-underlying-candles', () => ({
  useTradfiUnderlyingCandles: () => ({
    data: { candles: [{ ts: 1781553000000, o: 1, h: 1, l: 1, c: 1, vol: 0, synthetic: false }], markLine: [] },
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

const series = {
  setData: vi.fn(),
  update: vi.fn(),
  createPriceLine: vi.fn(() => ({})),
  removePriceLine: vi.fn(),
  attachPrimitive: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: {},
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dashed: 1 },
  createChart: () => ({ addSeries: () => series, remove: () => {}, timeScale: () => ({}) }),
}));

vi.mock('@features/gex', () => ({
  computeGammaWalls: () => ({ callWall: 100, putWall: 90, gammaFlip: 95 }),
  GammaChannelPrimitive: class {
    update() {}
  },
}));

const { default: TradfiGexBandsChart } = await import('./TradfiGexBandsChart');

afterEach(() => {
  cleanup();
  capturedOnBar = null;
});

describe('TradfiGexBandsChart live wiring', () => {
  it('applies a live bar to the candlestick series via update', () => {
    render(<TradfiGexBandsChart underlying="SPX" gex={[]} spotPrice={100} />);
    expect(typeof capturedOnBar).toBe('function');
    capturedOnBar!({ ts: 1781553300000, o: 56, h: 57, l: 55, c: 56.5, vol: 3 });
    expect(series.update).toHaveBeenCalledWith(
      expect.objectContaining({ open: 56, high: 57, low: 55, close: 56.5 }),
    );
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/TradfiGexBandsChart.test.tsx`
Expected: FAIL — `series.update` not called (live hook not wired yet).

- [ ] **Step 7: Wire the chart**

In `packages/web/src/features/tradfi/TradfiGexBandsChart.tsx`:

(a) Replace the local `tsToSec` (lines ~31-33) with imports near the top:

```ts
import { liveBarToCandle, tsToSec } from './live-candle';
import { useTradfiUnderlyingCandlesLive } from './use-tradfi-underlying-candles-live';
```

Add `useCallback` to the existing React import:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

(b) Replace the existing spot-line effect (lines ~149-167) with an extracted callback + a thin effect:

```ts
  const applySpotLine = useCallback((price: number | null) => {
    const series = seriesRef.current;
    if (!series) return;
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (price != null) {
      spotLineRef.current = series.createPriceLine({
        price,
        color: SPOT_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(price).toLocaleString()} SPOT`,
      });
    }
  }, []);

  useEffect(() => {
    applySpotLine(spotPrice);
  }, [spotPrice, applySpotLine]);

  // Live tail: merge the forming bar (lightweight-charts updates-or-appends by
  // time) and let the spot line ride the live close. REST history above is the
  // first paint + fallback; walls/GEX stay on the 5s poll.
  const handleLiveBar = useCallback(
    (bar: { ts: number; o: number; h: number; l: number; c: number; vol: number }) => {
      const series = seriesRef.current;
      if (!series) return;
      series.update(liveBarToCandle(bar));
      applySpotLine(bar.c);
    },
    [applySpotLine],
  );

  useTradfiUnderlyingCandlesLive({ underlying, interval: sel.interval, onBar: handleLiveBar });
```

- [ ] **Step 8: Run both web tests to confirm they pass**

Run: `pnpm --filter @oggregator/web exec vitest run src/features/tradfi/live-candle.test.ts src/features/tradfi/TradfiGexBandsChart.test.tsx`
Expected: PASS (3 tests total).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/features/tradfi/live-candle.ts packages/web/src/features/tradfi/live-candle.test.ts packages/web/src/features/tradfi/TradfiGexBandsChart.tsx packages/web/src/features/tradfi/TradfiGexBandsChart.test.tsx
git commit -m "feat(web): live counting candle + live spot on TradFi GEX Bands" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification

No new code — confirm both packages are green and type-clean.

- [ ] **Step 1: TradFi tests + typecheck**

Run: `pnpm --filter @oggregator/tradfi test:run`
Expected: PASS — all suites green (includes the new candle-client, mapper, and CandleStreamer tests).

Run: `pnpm --filter @oggregator/tradfi typecheck`
Expected: no type errors.

- [ ] **Step 2: Web tests + typecheck**

Run: `pnpm --filter @oggregator/web test:run`
Expected: PASS — all suites green (includes the new `tradfiWsUrl`, hook, `live-candle`, and Bands wiring tests).

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no type errors.

- [ ] **Step 3: Confirm regression guarantees**

Eyeball the diff: `packages/server` and `packages/core` untouched; `TradfiGexView.tsx`, `gex-all-expiries.ts`, and the crypto `GexBandsChart.tsx` unchanged; the only `candle-client.ts` behavioral change to the one-shot path is `finish()` calling `maybeUnsubscribe`.

- [ ] **Step 4 (optional): Web build**

Run: `pnpm --filter @oggregator/web build`
Expected: `tsc --noEmit` clean + Vite build succeeds.

---

## Deploy (after all tasks pass — ops, not in this branch's code)

1. Merge `feat/tradfi-gex-live-candles` → `main` (PR).
2. **Manual Scaleway redeploy** of the `@oggregator/tradfi` service (new `/ws/underlying-candles` route + candle-client change). No DB migration.
3. Web: standard build + redeploy; ensure the `/tradfi-api` proxy/ingress also forwards WebSocket upgrades for `/ws/underlying-candles` (same path the REST calls use).
4. Verify live on an index (SPX/NDX/RUT) GEX Bands view. **On the free/delayed tier, expect ~15-min stepped updates — not a bug.** Real-time follows the paid entitlement flip with no code change.

## Notes / honest caveats

- Live updates are only as real-time as the TastyTrade data entitlement (delayed today).
- The candle DXLink socket has no auto-reconnect; if it drops, the WS closes and the chart relies on the REST snapshot (never worse than today). Auto-reconnect is a later hardening.
- One-shot ↔ live for the same symbol+period (the normal Bands case: REST history + live tail) is handled by the ref-counted `maybeUnsubscribe` guard — covered by the Task 2 tests.
