# TradFi Backend (TastyTrade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `@oggregator/tradfi`, a separate backend service that serves a live, enriched TastyTrade listed-options chain via `GET /chains`.

**Architecture:** Standalone Fastify service (own process/port 3200, own runtime + store, own routes). OAuth2 personal-grant auth → REST (`/api-quote-tokens`, `/option-chains/.../nested`, `/market-data/by-type`) for catalog + snapshot quotes, then DXLink WebSocket for live quotes + greeks/IV. Reuses only asset-agnostic primitives from `@oggregator/core` (`buildComparisonChain`, `buildEnrichedChain`, canonical types, `TopicWsClient`). Never instantiates a crypto adapter, so crypto venues never run alongside it.

**Tech Stack:** TypeScript (ESM, NodeNext, strict), Fastify 5, `ws`, Zod, Vitest, pnpm workspace. Reference spec: `docs/superpowers/specs/2026-06-14-tradfi-backend-design.md`. TastyTrade docs: `docs/tastydocs/` (filenames are shuffled — map by heading).

**Conventions (match the monorepo):**
- ESM everywhere; **relative imports end in `.js`** even from `.ts` files.
- `tsconfig.base.json` is strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Omit optional props rather than assigning `undefined`; guard array indexing.
- All external payloads validated with Zod `.safeParse()` at the boundary.
- Secrets live only in the gitignored repo-root `.env` (loaded via `--env-file-if-exists=../../.env`). Never commit them.
- `docs/` is gitignored → commit this plan and the spec with `git add -f`.

---

## File Structure

```
packages/tradfi/
  package.json                     workspace package manifest
  tsconfig.json                    extends base, references core
  vitest.config.ts                 node env, *.test.ts
  src/
    index.ts                       entrypoint: load config, build app, listen on TRADFI_PORT
    app.ts                         Fastify factory: register routes, bootstrap feed, readiness
    config.ts                      env -> TradfiConfig
    logger.ts                      local pino logger
    tastytrade/
      types.ts                     Zod schemas: oauth, quote-token, nested chain, market-data, dxlink frames
      auth.ts                      OAuth2TokenManager (refresh token + secret -> 15min access token)
      rest.ts                      TastytradeRest: quote token, nested chain, market-data/by-type
      instrument.ts                TradfiInstrument model + canonical + nestedChainToInstruments
      codec.ts                     DXLink frame builders + COMPACT FEED_DATA parser   (M2)
      planner.ts                   subscription add/remove diff + underlyings           (M2)
      state.ts                     merge DXLink events into store quotes                (M2)
      dxlink-client.ts             DXLink WS client (wraps core TopicWsClient)          (M2)
      health.ts                    US market-hours + token-expiry signal                (M3)
      feed.ts                      orchestration: loadMarkets, snapshot, subscribe
    runtime/
      store.ts                     TradfiStore: quotes by streamer symbol + instruments + spot
      chain.ts                     store -> VenueOptionChain -> buildComparisonChain -> buildEnrichedChain
    routes/
      venues.ts  underlyings.ts  expiries.ts  chains.ts  ws-chain.ts   (ws-chain M3)
references/options-docs/tastytrade/{rest,dxlink}/   captured, secret-masked fixtures
```

---
---

# MILESTONE M0 — Package scaffold & scaffold cleanup

Produces: an empty but installable `@oggregator/tradfi` that builds, plus removal of the superseded v2/feeds-tastytrade scaffold. Repo green.

### Task 1: Create the `@oggregator/tradfi` package skeleton

**Files:**
- Create: `packages/tradfi/package.json`
- Create: `packages/tradfi/tsconfig.json`
- Create: `packages/tradfi/vitest.config.ts`
- Create: `packages/tradfi/src/logger.ts`
- Create: `packages/tradfi/src/index.ts`

- [ ] **Step 1: Write `package.json`** — match the zod version to `packages/core/package.json` (run `node -p "require('./packages/core/package.json').dependencies.zod"` first and substitute it for `ZOD_VERSION` below; this avoids the known zod 3/4 boundary issue).

```json
{
  "name": "@oggregator/tradfi",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=../../.env src/index.ts",
    "build": "tsc",
    "start": "node --env-file-if-exists=../../.env dist/index.js",
    "lint": "biome lint .",
    "typecheck": "pnpm --filter @oggregator/core build && tsc --noEmit",
    "test": "vitest",
    "test:run": "pnpm --filter @oggregator/core build && vitest run"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@fastify/websocket": "^11.0.0",
    "@oggregator/core": "workspace:*",
    "@oggregator/protocol": "workspace:^",
    "fastify": "^5.0.0",
    "pino": "^9.0.0",
    "ws": "^8.19.0",
    "zod": "ZOD_VERSION"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "pino-pretty": "^13.1.3",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `src/logger.ts`**

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'tradfi' },
});

export function feedLogger(component: string) {
  return logger.child({ component });
}
```

- [ ] **Step 5: Write a placeholder `src/index.ts`**

```ts
import { logger } from './logger.js';

logger.info('tradfi service placeholder — wiring lands in M1');
```

- [ ] **Step 6: Install and verify the package is wired into the workspace**

Run: `pnpm install`
Then: `pnpm --filter @oggregator/tradfi build`
Expected: tsc completes, `packages/tradfi/dist/index.js` exists, exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A packages/tradfi pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(tradfi): scaffold @oggregator/tradfi package"
```

---

### Task 2: Export `TopicWsClient` from `@oggregator/core`

`TopicWsClient` is internal today; the DXLink client (M2) wraps it.

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the export** — append near the other `feeds/shared` exports (after the `BaseAdapter` export, ~line 86):

```ts
export { TopicWsClient, type TopicWsClientOptions } from './feeds/shared/topic-ws-client.js';
```

- [ ] **Step 2: Build core and confirm the export resolves**

Run: `pnpm --filter @oggregator/core build`
Then: `node -e "import('@oggregator/core').then(m => console.log(typeof m.TopicWsClient))"`
Expected: prints `function`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export TopicWsClient for reuse by tradfi"
```

---

### Task 3: Delete the v2 routes and add the vestigial comment

Per spec §10 Option A: delete the additive v2 routes; leave v1 asset-class filtering untouched, with one comment.

**Files:**
- Delete: `packages/server/src/routes/v2/` (entire directory)
- Modify: `packages/server/src/app.ts` (remove v2 registration)
- Modify: `packages/server/src/asset-class.ts` (add comment)

- [ ] **Step 1: Find where v2 routes are registered**

Run: `grep -rn "v2Routes\|v2WsChainRoute\|routes/v2" packages/server/src`
Note every import/registration line.

- [ ] **Step 2: Remove the v2 imports and `app.register(...)` calls** found in Step 1 from `packages/server/src/app.ts` (and any other file that referenced them). Delete only those lines.

- [ ] **Step 3: Delete the directory**

```bash
git rm -r packages/server/src/routes/v2
```

- [ ] **Step 4: Add the vestigial comment** at the top of the `getAdaptersByAssetClass` function in `packages/server/src/asset-class.ts`:

```ts
/**
 * Filter the global adapter registry by asset class.
 *
 * VESTIGIAL: TradFi moved to the separate @oggregator/tradfi service, so no
 * 'tradfi' adapter is ever registered in this (crypto) process. v1 routes call
 * this with 'crypto', which therefore returns all adapters — runtime-identical
 * to getAllAdapters(). Kept as-is to avoid editing the working v1 routes.
 * See docs/superpowers/specs/2026-06-14-tradfi-backend-design.md §10.
 */
```

- [ ] **Step 5: Verify the server still builds**

Run: `pnpm --filter @oggregator/server typecheck`
Expected: exit 0 (no references to the deleted v2 routes remain).

- [ ] **Step 6: Commit**

```bash
git add -A packages/server
git commit -m "refactor(server): remove superseded v2 routes; mark asset-class filter vestigial"
```

---

### Task 4: Remove the `feeds/tastytrade` stubs from core

The stubs are superseded by `@oggregator/tradfi`. Keep `tastytrade` in `VENUE_IDS` + `FEE_CAP` + the `AssetClass` machinery (vestigial, required by types).

**Files:**
- Delete: `packages/core/src/feeds/tastytrade/` (entire directory)
- Modify: `packages/core/src/index.ts` (remove tastytrade adapter exports)
- Modify: `packages/core/src/core/subscription-coordinator.test.ts` (remove the tastytrade line added by `d670b39`, if present)

- [ ] **Step 1: Remove the tastytrade exports** from `packages/core/src/index.ts` — delete these two lines (~164-165):

```ts
export { TastytradeWsAdapter, TastytradeRestClient } from './feeds/tastytrade/index.js';
export type { TastytradeAuth, TastytradeSession } from './feeds/tastytrade/index.js';
```

- [ ] **Step 2: Delete the directory**

```bash
git rm -r packages/core/src/feeds/tastytrade
```

- [ ] **Step 3: Find and fix any remaining references**

Run: `grep -rn "tastytrade" packages/core/src --include="*.ts" | grep -iv "VENUE_IDS\|FEE_CAP"`
For each hit (e.g. a line in `subscription-coordinator.test.ts`), remove the tastytrade-specific reference. Leave the `VENUE_IDS` and `FEE_CAP` `tastytrade` entries in place.

- [ ] **Step 4: Build + test core**

Run: `pnpm --filter @oggregator/core build && pnpm --filter @oggregator/core test:run`
Expected: build exit 0; all core tests pass.

- [ ] **Step 5: Full repo green**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A packages/core
git commit -m "refactor(core): remove superseded tastytrade feed stubs"
```

---
---

# MILESTONE M1 — OAuth + REST + first live `/chains` (snapshot quotes)

Produces: the service authenticates, loads the 7 chains, and `GET /chains` returns an enriched chain with real bid/ask/mark/last via `/market-data/by-type` (no greeks yet). This is the live Go/No-Go.

### Task 5: Config loader

**Files:**
- Create: `packages/tradfi/src/config.ts`
- Test: `packages/tradfi/src/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  TASTYTRADE_CLIENT_ID: 'cid',
  TASTYTRADE_CLIENT_SECRET: 'secret',
  TASTYTRADE_REFRESH_TOKEN: 'refresh',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(3200);
    expect(cfg.baseUrl).toBe('https://api.tastyworks.com');
    expect(cfg.underlyings).toEqual(['SPX', 'NDX', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA']);
  });

  it('parses TRADFI_UNDERLYINGS and TRADFI_PORT', () => {
    const cfg = loadConfig({ ...base, TRADFI_UNDERLYINGS: 'AAPL, SPY ,QQQ', TRADFI_PORT: '4000' });
    expect(cfg.underlyings).toEqual(['AAPL', 'SPY', 'QQQ']);
    expect(cfg.port).toBe(4000);
  });

  it('throws when a required secret is missing', () => {
    expect(() => loadConfig({})).toThrow(/TASTYTRADE_CLIENT_ID/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/config.test.ts`
Expected: FAIL (`loadConfig` not found).

- [ ] **Step 3: Implement `config.ts`**

```ts
export interface TradfiConfig {
  port: number;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  underlyings: string[];
  userAgent: string;
}

const DEFAULT_UNDERLYINGS = ['SPX', 'NDX', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'];

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value == null || value.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TradfiConfig {
  const underlyingsRaw = env.TRADFI_UNDERLYINGS;
  const underlyings = underlyingsRaw
    ? underlyingsRaw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_UNDERLYINGS;

  return {
    port: env.TRADFI_PORT ? Number(env.TRADFI_PORT) : 3200,
    baseUrl: env.TASTYTRADE_BASE_URL ?? 'https://api.tastyworks.com',
    clientId: required(env, 'TASTYTRADE_CLIENT_ID'),
    clientSecret: required(env, 'TASTYTRADE_CLIENT_SECRET'),
    refreshToken: required(env, 'TASTYTRADE_REFRESH_TOKEN'),
    underlyings,
    userAgent: env.TASTYTRADE_USER_AGENT ?? 'oggregator-tradfi/0.1',
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/config.ts packages/tradfi/src/config.test.ts
git commit -m "feat(tradfi): config loader"
```

---

### Task 6: Zod schemas for REST payloads

**Files:**
- Create: `packages/tradfi/src/tastytrade/types.ts`
- Test: `packages/tradfi/src/tastytrade/types.test.ts`

- [ ] **Step 1: Write the failing test** (fixtures derived from `docs/tastydocs/` — replace with captured payloads in M3)

```ts
import { describe, expect, it } from 'vitest';
import {
  OAuthTokenResponseSchema,
  QuoteTokenResponseSchema,
  NestedChainResponseSchema,
  MarketDataResponseSchema,
} from './types.js';

describe('tastytrade REST schemas', () => {
  it('parses an oauth token response', () => {
    const r = OAuthTokenResponseSchema.safeParse({
      access_token: 'abc', token_type: 'Bearer', expires_in: 900,
    });
    expect(r.success).toBe(true);
  });

  it('parses a quote-token response', () => {
    const r = QuoteTokenResponseSchema.safeParse({
      data: { token: 't', 'dxlink-url': 'wss://x/realtime', level: 'api' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data['dxlink-url']).toBe('wss://x/realtime');
  });

  it('parses a nested option chain', () => {
    const r = NestedChainResponseSchema.safeParse({
      data: { items: [{
        'underlying-symbol': 'AAPL',
        'root-symbol': 'AAPL',
        'shares-per-contract': 100,
        expirations: [{
          'expiration-date': '2026-04-17',
          'days-to-expiration': 120,
          'settlement-type': 'Physical',
          'expiration-type': 'Regular',
          strikes: [{
            'strike-price': '200.0',
            call: 'AAPL  260417C00200000',
            put: 'AAPL  260417P00200000',
            'call-streamer-symbol': '.AAPL260417C200',
            'put-streamer-symbol': '.AAPL260417P200',
          }],
        }],
      }] },
    });
    expect(r.success).toBe(true);
  });

  it('parses market-data by-type (camelCase)', () => {
    const r = MarketDataResponseSchema.safeParse({
      data: { items: [{
        symbol: 'AAPL  260417C00200000', instrumentType: 'Equity Option',
        bid: 5.1, ask: 5.3, bidSize: 10, askSize: 12, mid: 5.2, mark: 5.2,
        last: 5.2, volume: 1000, tradingHalted: false,
      }] },
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/types.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `types.ts`** (numeric fields are nullable/optional because TastyTrade omits or sends `null` for illiquid contracts)

```ts
import { z } from 'zod';

const num = z.number().nullable().optional();

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

export const QuoteTokenResponseSchema = z.object({
  data: z.object({
    token: z.string(),
    'dxlink-url': z.string(),
    'websocket-url': z.string().optional(),
    level: z.string().optional(),
    'expires-at': z.string().optional(),
  }),
});
export type QuoteTokenResponse = z.infer<typeof QuoteTokenResponseSchema>;

export const NestedStrikeSchema = z.object({
  'strike-price': z.string(),
  call: z.string().optional(),
  put: z.string().optional(),
  'call-streamer-symbol': z.string().optional(),
  'put-streamer-symbol': z.string().optional(),
});

export const NestedExpirationSchema = z.object({
  'expiration-date': z.string(),
  'days-to-expiration': z.number().optional(),
  'settlement-type': z.string().optional(),
  'expiration-type': z.string().optional(),
  strikes: z.array(NestedStrikeSchema),
});

export const NestedChainResponseSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        'underlying-symbol': z.string(),
        'root-symbol': z.string().optional(),
        'option-chain-type': z.string().optional(),
        'shares-per-contract': z.number().optional(),
        expirations: z.array(NestedExpirationSchema),
      }),
    ),
  }),
});
export type NestedChainResponse = z.infer<typeof NestedChainResponseSchema>;

export const MarketDatumSchema = z.object({
  symbol: z.string(),
  instrumentType: z.string().optional(),
  bid: num, ask: num, bidSize: num, askSize: num,
  mid: num, mark: num, last: num, volume: num,
  open: num, dayHighPrice: num, dayLowPrice: num, close: num, prevClose: num,
  tradingHalted: z.boolean().nullable().optional(),
});
export type MarketDatum = z.infer<typeof MarketDatumSchema>;

export const MarketDataResponseSchema = z.object({
  data: z.object({ items: z.array(MarketDatumSchema) }),
});
export type MarketDataResponse = z.infer<typeof MarketDataResponseSchema>;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/types.ts packages/tradfi/src/tastytrade/types.test.ts
git commit -m "feat(tradfi): zod schemas for tastytrade REST payloads"
```

---

### Task 7: OAuth2 token manager

**Files:**
- Create: `packages/tradfi/src/tastytrade/auth.ts`
- Test: `packages/tradfi/src/tastytrade/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { OAuth2TokenManager } from './auth.js';

function fakeFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

const cfg = {
  baseUrl: 'https://api.tastyworks.com',
  clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh',
};

describe('OAuth2TokenManager', () => {
  it('fetches and caches an access token', async () => {
    const fetchImpl = fakeFetch({ access_token: 'AT1', token_type: 'Bearer', expires_in: 900 });
    const mgr = new OAuth2TokenManager(cfg, fetchImpl);
    expect(await mgr.getAccessToken()).toBe('AT1');
    expect(await mgr.getAccessToken()).toBe('AT1');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached
  });

  it('refreshes when near expiry', async () => {
    const fetchImpl = fakeFetch({ access_token: 'AT2', token_type: 'Bearer', expires_in: 30 });
    const mgr = new OAuth2TokenManager(cfg, fetchImpl);
    await mgr.getAccessToken();
    await mgr.getAccessToken(); // 30s < 60s skew -> refetch
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws on non-ok response', async () => {
    const mgr = new OAuth2TokenManager(cfg, fakeFetch({ error: 'invalid_grant' }, false));
    await expect(mgr.getAccessToken()).rejects.toThrow(/oauth/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/auth.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `auth.ts`** (form-urlencoded per OAuth2 spec; confirm against the live exchange in Task 14 and adjust if TastyTrade wants JSON)

```ts
import { OAuthTokenResponseSchema } from './types.js';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface OAuth2Config {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const EXPIRY_SKEW_MS = 60_000;

export class OAuth2TokenManager implements AccessTokenProvider {
  private token: string | null = null;
  private expiresAtMs = 0;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly cfg: OAuth2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token != null && Date.now() < this.expiresAtMs - EXPIRY_SKEW_MS) {
      return this.token;
    }
    if (this.inflight != null) return this.inflight;
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.cfg.refreshToken,
      client_secret: this.cfg.clientSecret,
      client_id: this.cfg.clientId,
    });

    const res = await this.fetchImpl(`${this.cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'oggregator-tradfi/0.1',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`oauth token refresh failed: ${res.status} ${text}`);
    }

    const parsed = OAuthTokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`oauth token response unparseable: ${parsed.error.message}`);
    }

    this.token = parsed.data.access_token;
    this.expiresAtMs = Date.now() + parsed.data.expires_in * 1000;
    return this.token;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/auth.ts packages/tradfi/src/tastytrade/auth.test.ts
git commit -m "feat(tradfi): OAuth2 token manager"
```

---

### Task 8: REST client

**Files:**
- Create: `packages/tradfi/src/tastytrade/rest.ts`
- Test: `packages/tradfi/src/tastytrade/rest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { TastytradeRest } from './rest.js';

const auth = { getAccessToken: async () => 'AT' };

function jsonFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body == null) return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
}

const cfg = { baseUrl: 'https://api.tastyworks.com', userAgent: 'ua' };

describe('TastytradeRest', () => {
  it('gets a quote token', async () => {
    const rest = new TastytradeRest(cfg, auth, jsonFetch({
      '/api-quote-tokens': { data: { token: 'QT', 'dxlink-url': 'wss://dx/realtime', level: 'api' } },
    }));
    const qt = await rest.getQuoteToken();
    expect(qt.token).toBe('QT');
    expect(qt.dxlinkUrl).toBe('wss://dx/realtime');
  });

  it('sends bearer + user-agent headers', async () => {
    const fetchImpl = jsonFetch({ '/api-quote-tokens': { data: { token: 'QT', 'dxlink-url': 'wss://x', level: 'api' } } });
    const rest = new TastytradeRest(cfg, auth, fetchImpl);
    await rest.getQuoteToken();
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer AT');
    expect(headers['User-Agent']).toBe('ua');
  });

  it('fetches a nested chain', async () => {
    const rest = new TastytradeRest(cfg, auth, jsonFetch({
      '/option-chains/AAPL/nested': { data: { items: [{ 'underlying-symbol': 'AAPL', expirations: [] }] } },
    }));
    const chain = await rest.getNestedChain('AAPL');
    expect(chain.items[0]!['underlying-symbol']).toBe('AAPL');
  });

  it('fetches market data by type with array params', async () => {
    const fetchImpl = jsonFetch({
      '/market-data/by-type': { data: { items: [{ symbol: 'AAPL', bid: 1, ask: 2 }] } },
    });
    const rest = new TastytradeRest(cfg, auth, fetchImpl);
    const data = await rest.getMarketData({ equity: ['AAPL'], equityOption: [], index: [] });
    expect(data[0]!.symbol).toBe('AAPL');
    const calledUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0];
    expect(calledUrl).toContain('equity=AAPL');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/rest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `rest.ts`**

```ts
import type { AccessTokenProvider } from './auth.js';
import {
  MarketDataResponseSchema,
  NestedChainResponseSchema,
  QuoteTokenResponseSchema,
  type MarketDatum,
  type NestedChainResponse,
} from './types.js';

export interface RestConfig {
  baseUrl: string;
  userAgent: string;
}

export interface QuoteToken {
  token: string;
  dxlinkUrl: string;
  expiresAt: string | null;
}

export interface MarketDataParams {
  equity?: string[];
  equityOption?: string[];
  index?: string[];
}

export class TastytradeRest {
  constructor(
    private readonly cfg: RestConfig,
    private readonly auth: AccessTokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string, search?: URLSearchParams): Promise<unknown> {
    const token = await this.auth.getAccessToken();
    const url = `${this.cfg.baseUrl}${path}${search ? `?${search.toString()}` : ''}`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': this.cfg.userAgent,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`tastytrade GET ${path} -> ${res.status} ${text}`);
    }
    return res.json();
  }

  async getQuoteToken(): Promise<QuoteToken> {
    const parsed = QuoteTokenResponseSchema.safeParse(await this.get('/api-quote-tokens'));
    if (!parsed.success) throw new Error(`quote-token unparseable: ${parsed.error.message}`);
    return {
      token: parsed.data.data.token,
      dxlinkUrl: parsed.data.data['dxlink-url'],
      expiresAt: parsed.data.data['expires-at'] ?? null,
    };
  }

  async getNestedChain(symbol: string): Promise<NestedChainResponse['data']> {
    const parsed = NestedChainResponseSchema.safeParse(
      await this.get(`/option-chains/${encodeURIComponent(symbol)}/nested`),
    );
    if (!parsed.success) throw new Error(`nested chain ${symbol} unparseable: ${parsed.error.message}`);
    return parsed.data.data;
  }

  async getMarketData(params: MarketDataParams): Promise<MarketDatum[]> {
    const search = new URLSearchParams();
    for (const s of params.equity ?? []) search.append('equity', s);
    for (const s of params.equityOption ?? []) search.append('equity-option', s);
    for (const s of params.index ?? []) search.append('index', s);
    const parsed = MarketDataResponseSchema.safeParse(await this.get('/market-data/by-type', search));
    if (!parsed.success) throw new Error(`market-data unparseable: ${parsed.error.message}`);
    return parsed.data.data.items;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/rest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/rest.ts packages/tradfi/src/tastytrade/rest.test.ts
git commit -m "feat(tradfi): tastytrade REST client"
```

---

### Task 9: Instrument model + canonical symbol + chain flattening

**Files:**
- Create: `packages/tradfi/src/tastytrade/instrument.ts`
- Test: `packages/tradfi/src/tastytrade/instrument.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildCanonical, nestedChainToInstruments } from './instrument.js';

describe('instrument', () => {
  it('builds the canonical symbol', () => {
    expect(buildCanonical('AAPL', '2026-04-17', 200, 'call')).toBe('AAPL/USD:USD-260417-200-C');
    expect(buildCanonical('SPX', '2026-06-20', 5000, 'put')).toBe('SPX/USD:USD-260620-5000-P');
  });

  it('flattens a nested chain into call+put instruments', () => {
    const data = {
      items: [{
        'underlying-symbol': 'AAPL',
        'root-symbol': 'AAPL',
        'shares-per-contract': 100,
        expirations: [{
          'expiration-date': '2026-04-17',
          'settlement-type': 'Physical',
          'expiration-type': 'Regular',
          strikes: [{
            'strike-price': '200.0',
            call: 'AAPL  260417C00200000',
            put: 'AAPL  260417P00200000',
            'call-streamer-symbol': '.AAPL260417C200',
            'put-streamer-symbol': '.AAPL260417P200',
          }],
        }],
      }],
    };
    const insts = nestedChainToInstruments(data);
    expect(insts).toHaveLength(2);
    const call = insts.find((i) => i.right === 'call')!;
    expect(call.underlying).toBe('AAPL');
    expect(call.expiry).toBe('2026-04-17');
    expect(call.strike).toBe(200);
    expect(call.streamerSymbol).toBe('.AAPL260417C200');
    expect(call.canonical).toBe('AAPL/USD:USD-260417-200-C');
    expect(call.multiplier).toBe(100);
    expect(call.settlementType).toBe('physical'); // 'Physical' -> 'physical'
  });

  it('skips strikes missing a streamer symbol', () => {
    const data = {
      items: [{
        'underlying-symbol': 'AAPL', expirations: [{
          'expiration-date': '2026-04-17',
          strikes: [{ 'strike-price': '200.0' }],
        }],
      }],
    };
    expect(nestedChainToInstruments(data)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/instrument.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `instrument.ts`**

```ts
import type { NestedChainResponse } from './types.js';

export type OptionRight = 'call' | 'put';

export interface TradfiInstrument {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  strike: number;
  right: OptionRight;
  occSymbol: string;
  streamerSymbol: string;
  canonical: string;
  multiplier: number;
  rootSymbol: string;
  settlementType: 'physical' | 'cash';
  expirationType: string | null;
}

export function buildCanonical(
  underlying: string,
  expiry: string,
  strike: number,
  right: OptionRight,
): string {
  const yy = expiry.slice(2, 4);
  const mm = expiry.slice(5, 7);
  const dd = expiry.slice(8, 10);
  const rc = right === 'call' ? 'C' : 'P';
  return `${underlying}/USD:USD-${yy}${mm}${dd}-${strike}-${rc}`;
}

function mapSettlement(raw: string | undefined): 'physical' | 'cash' {
  return raw?.toLowerCase() === 'cash' ? 'cash' : 'physical';
}

export function nestedChainToInstruments(
  data: NestedChainResponse['data'],
): TradfiInstrument[] {
  const out: TradfiInstrument[] = [];

  for (const item of data.items) {
    const underlying = item['underlying-symbol'];
    const rootSymbol = item['root-symbol'] ?? underlying;
    const multiplier = item['shares-per-contract'] ?? 100;

    for (const exp of item.expirations) {
      const expiry = exp['expiration-date'];
      const settlementType = mapSettlement(exp['settlement-type']);
      const expirationType = exp['expiration-type'] ?? null;

      for (const strike of exp.strikes) {
        const strikePrice = Number(strike['strike-price']);
        if (!Number.isFinite(strikePrice)) continue;

        const sides: Array<[OptionRight, string | undefined, string | undefined]> = [
          ['call', strike.call, strike['call-streamer-symbol']],
          ['put', strike.put, strike['put-streamer-symbol']],
        ];

        for (const [right, occ, streamer] of sides) {
          if (occ == null || streamer == null) continue;
          out.push({
            underlying,
            expiry,
            strike: strikePrice,
            right,
            occSymbol: occ,
            streamerSymbol: streamer,
            canonical: buildCanonical(underlying, expiry, strikePrice, right),
            multiplier,
            rootSymbol,
            settlementType,
            expirationType,
          });
        }
      }
    }
  }

  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/instrument.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/instrument.ts packages/tradfi/src/tastytrade/instrument.test.ts
git commit -m "feat(tradfi): instrument model + nested-chain flattening"
```

---

### Task 10: TradFi store

**Files:**
- Create: `packages/tradfi/src/runtime/store.ts`
- Test: `packages/tradfi/src/runtime/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { TradfiStore, emptyQuote } from './store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPL  260417C00200000', streamerSymbol: '.AAPL260417C200',
  canonical: 'AAPL/USD:USD-260417-200-C', multiplier: 100, rootSymbol: 'AAPL',
  settlementType: 'physical', expirationType: 'Regular',
};

describe('TradfiStore', () => {
  it('stores instruments and lists underlyings/expiries', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    expect(s.listUnderlyings()).toEqual(['AAPL']);
    expect(s.listExpiries('AAPL')).toEqual(['2026-04-17']);
    expect(s.instrumentsFor('AAPL', '2026-04-17')).toHaveLength(1);
  });

  it('merges quote patches and reads them back', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    s.mergeQuote('.AAPL260417C200', { bid: 5.1, ask: 5.3, ts: 1 });
    s.mergeQuote('.AAPL260417C200', { iv: 0.4, delta: 0.6, ts: 2 });
    const q = s.getQuote('.AAPL260417C200')!;
    expect(q.bid).toBe(5.1);
    expect(q.iv).toBe(0.4);
    expect(q.delta).toBe(0.6);
    expect(q.ts).toBe(2);
  });

  it('tracks underlying spot', () => {
    const s = new TradfiStore();
    s.setSpot('AAPL', 198.5);
    expect(s.getSpot('AAPL')).toBe(198.5);
  });

  it('emptyQuote has all-null fields', () => {
    expect(emptyQuote().bid).toBeNull();
    expect(emptyQuote().iv).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `store.ts`**

```ts
import type { TradfiInstrument } from '../tastytrade/instrument.js';

export interface TradfiLiveQuote {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
  mark: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  openInterest: number | null;
  volume: number | null;
  ts: number;
}

export function emptyQuote(): TradfiLiveQuote {
  return {
    bid: null, ask: null, bidSize: null, askSize: null, last: null, mark: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
    openInterest: null, volume: null, ts: 0,
  };
}

export class TradfiStore {
  private quotes = new Map<string, TradfiLiveQuote>();
  private instruments = new Map<string, TradfiInstrument>();
  private spot = new Map<string, number>();

  setInstruments(insts: TradfiInstrument[]): void {
    this.instruments.clear();
    for (const i of insts) this.instruments.set(i.streamerSymbol, i);
  }

  allInstruments(): TradfiInstrument[] {
    return [...this.instruments.values()];
  }

  instrumentsFor(underlying: string, expiry: string): TradfiInstrument[] {
    return this.allInstruments().filter((i) => i.underlying === underlying && i.expiry === expiry);
  }

  getInstrument(streamerSymbol: string): TradfiInstrument | undefined {
    return this.instruments.get(streamerSymbol);
  }

  listUnderlyings(): string[] {
    return [...new Set(this.allInstruments().map((i) => i.underlying))].sort();
  }

  listExpiries(underlying: string): string[] {
    const set = new Set<string>();
    for (const i of this.allInstruments()) if (i.underlying === underlying) set.add(i.expiry);
    return [...set].sort();
  }

  mergeQuote(streamerSymbol: string, patch: Partial<TradfiLiveQuote> & { ts: number }): void {
    const prev = this.quotes.get(streamerSymbol) ?? emptyQuote();
    this.quotes.set(streamerSymbol, { ...prev, ...patch });
  }

  getQuote(streamerSymbol: string): TradfiLiveQuote | undefined {
    return this.quotes.get(streamerSymbol);
  }

  setSpot(underlying: string, price: number): void {
    this.spot.set(underlying, price);
  }

  getSpot(underlying: string): number | null {
    return this.spot.get(underlying) ?? null;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/runtime/store.ts packages/tradfi/src/runtime/store.test.ts
git commit -m "feat(tradfi): in-memory store (quotes/instruments/spot)"
```

---

### Task 11: Chain assembly (store → enriched chain)

**Files:**
- Create: `packages/tradfi/src/runtime/chain.ts`
- Test: `packages/tradfi/src/runtime/chain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { TradfiStore } from './store.js';
import { buildChain } from './chain.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

function inst(right: 'call' | 'put', strike: number): TradfiInstrument {
  return {
    underlying: 'AAPL', expiry: '2026-04-17', strike, right,
    occSymbol: `AAPL...${strike}${right}`, streamerSymbol: `.AAPL${strike}${right[0]}`,
    canonical: `AAPL/USD:USD-260417-${strike}-${right === 'call' ? 'C' : 'P'}`,
    multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
  };
}

describe('buildChain', () => {
  it('returns an enriched chain with the requested underlying/expiry', () => {
    const store = new TradfiStore();
    const c = inst('call', 200);
    const p = inst('put', 200);
    store.setInstruments([c, p]);
    store.setSpot('AAPL', 198);
    store.mergeQuote(c.streamerSymbol, { bid: 5, ask: 5.2, mark: 5.1, iv: 0.4, delta: 0.55, ts: 1 });
    store.mergeQuote(p.streamerSymbol, { bid: 6, ask: 6.2, mark: 6.1, iv: 0.42, delta: -0.45, ts: 1 });

    const enriched = buildChain(store, 'AAPL', '2026-04-17');
    expect(enriched.underlying).toBe('AAPL');
    expect(enriched.expiry).toBe('2026-04-17');
    expect(enriched.strikes.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/chain.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `chain.ts`** (reuses core `buildComparisonChain` + `buildEnrichedChain`; `venue: 'tastytrade'` is a valid `VenueId`)

```ts
import {
  buildComparisonChain,
  buildEnrichedChain,
  EMPTY_GREEKS,
  type EnrichedChainResponse,
  type NormalizedOptionContract,
  type PremiumValue,
  type VenueOptionChain,
} from '@oggregator/core';
import type { TradfiStore, TradfiLiveQuote } from './store.js';
import { emptyQuote } from './store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

function premium(value: number | null): PremiumValue {
  return { raw: value, rawCurrency: 'USD', usd: value };
}

function toContract(
  inst: TradfiInstrument,
  quote: TradfiLiveQuote,
  spot: number | null,
  source: 'ws' | 'rest',
): NormalizedOptionContract {
  return {
    venue: 'tastytrade',
    symbol: inst.canonical,
    exchangeSymbol: inst.streamerSymbol,
    base: inst.underlying,
    settle: 'USD',
    expiry: inst.expiry,
    expiryTs: null,
    strike: inst.strike,
    right: inst.right,
    inverse: false,
    contractSize: inst.multiplier,
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
    greeks: {
      ...EMPTY_GREEKS,
      delta: quote.delta,
      gamma: quote.gamma,
      theta: quote.theta,
      vega: quote.vega,
      rho: quote.rho,
      markIv: quote.iv,
    },
    quote: {
      bid: premium(quote.bid),
      ask: premium(quote.ask),
      mark: premium(quote.mark),
      last: quote.last != null ? premium(quote.last) : null,
      bidSize: quote.bidSize,
      askSize: quote.askSize,
      underlyingPriceUsd: spot,
      indexPriceUsd: spot,
      volume24h: quote.volume,
      openInterest: quote.openInterest,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: quote.ts || null,
      source,
    },
  };
}

export function buildChain(
  store: TradfiStore,
  underlying: string,
  expiry: string,
  source: 'ws' | 'rest' = 'ws',
): EnrichedChainResponse {
  const insts = store.instrumentsFor(underlying, expiry);
  const spot = store.getSpot(underlying);
  const contracts: Record<string, NormalizedOptionContract> = {};

  for (const inst of insts) {
    const quote = store.getQuote(inst.streamerSymbol) ?? emptyQuote();
    contracts[inst.canonical] = toContract(inst, quote, spot, source);
  }

  const venueChain: VenueOptionChain = {
    venue: 'tastytrade',
    underlying,
    expiry,
    asOf: Date.now(),
    contracts,
  };

  const comparison = buildComparisonChain(underlying, expiry, [venueChain]);
  return buildEnrichedChain(underlying, expiry, comparison.rows, [venueChain]);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/runtime/chain.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/runtime/chain.ts packages/tradfi/src/runtime/chain.test.ts
git commit -m "feat(tradfi): chain assembly via core enrichment"
```

---

### Task 12: Feed orchestration (REST path)

**Files:**
- Create: `packages/tradfi/src/tastytrade/feed.ts`
- Test: `packages/tradfi/src/tastytrade/feed.test.ts`

- [ ] **Step 1: Write the failing test** (REST client stubbed)

```ts
import { describe, expect, it, vi } from 'vitest';
import { TradfiFeed } from './feed.js';
import { TradfiStore } from '../runtime/store.js';

function stubRest() {
  return {
    getNestedChain: vi.fn(async (symbol: string) => ({
      items: [{
        'underlying-symbol': symbol, 'root-symbol': symbol, 'shares-per-contract': 100,
        expirations: [{
          'expiration-date': '2026-04-17', 'settlement-type': 'Physical',
          strikes: [{
            'strike-price': '200.0',
            call: `${symbol}C`, put: `${symbol}P`,
            'call-streamer-symbol': `.${symbol}200C`, 'put-streamer-symbol': `.${symbol}200P`,
          }],
        }],
      }],
    })),
    // market-data is keyed by OCC symbol; the feed maps OCC -> instrument -> streamer symbol.
    getMarketData: vi.fn(async () => [
      { symbol: 'AAPLC', bid: 5, ask: 5.2, mark: 5.1, last: 5.1, volume: 10 },
      { symbol: 'AAPL', last: 198, mark: 198 },
    ]),
    getQuoteToken: vi.fn(),
  };
}

describe('TradfiFeed (REST)', () => {
  it('loads markets and lists underlyings', async () => {
    const store = new TradfiStore();
    const feed = new TradfiFeed(stubRest() as never, store, ['AAPL']);
    await feed.loadMarkets();
    expect(store.listUnderlyings()).toEqual(['AAPL']);
    expect(store.instrumentsFor('AAPL', '2026-04-17')).toHaveLength(2);
  });

  it('refreshes chain quotes from market-data and sets spot', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    const feed = new TradfiFeed(rest as never, store, ['AAPL']);
    await feed.loadMarkets();
    await feed.refreshChainQuotes('AAPL', '2026-04-17');
    expect(store.getQuote('.AAPL200C')!.bid).toBe(5);
    expect(rest.getMarketData).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/feed.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `feed.ts`** (M1 = REST snapshot; the DXLink hooks are added in M2)

```ts
import type { TastytradeRest } from './rest.js';
import { nestedChainToInstruments, type TradfiInstrument } from './instrument.js';
import type { TradfiStore } from '../runtime/store.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('tradfi-feed');
const MARKET_DATA_BATCH = 90; // under the 100-symbol cap, leaving room for the underlying

export class TradfiFeed {
  private occIndex = new Map<string, TradfiInstrument>();
  private loaded = false;

  constructor(
    private readonly rest: TastytradeRest,
    private readonly store: TradfiStore,
    private readonly underlyings: string[],
  ) {}

  async loadMarkets(): Promise<void> {
    const all: TradfiInstrument[] = [];
    for (const underlying of this.underlyings) {
      try {
        const data = await this.rest.getNestedChain(underlying);
        const insts = nestedChainToInstruments(data);
        all.push(...insts);
        log.info({ underlying, count: insts.length }, 'loaded chain');
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'chain load failed');
      }
    }
    this.store.setInstruments(all);
    this.occIndex.clear();
    for (const i of all) this.occIndex.set(i.occSymbol, i);
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** REST snapshot: fetch quotes for one chain via /market-data/by-type. */
  async refreshChainQuotes(underlying: string, expiry: string): Promise<void> {
    const insts = this.store.instrumentsFor(underlying, expiry);
    if (insts.length === 0) return;

    const occSymbols = insts.map((i) => i.occSymbol);
    for (let i = 0; i < occSymbols.length; i += MARKET_DATA_BATCH) {
      const batch = occSymbols.slice(i, i + MARKET_DATA_BATCH);
      const data = await this.rest.getMarketData({ equityOption: batch });
      const ts = Date.now();
      for (const d of data) {
        const inst = this.occIndex.get(d.symbol);
        if (inst == null) continue;
        this.store.mergeQuote(inst.streamerSymbol, {
          bid: d.bid ?? null, ask: d.ask ?? null, bidSize: d.bidSize ?? null,
          askSize: d.askSize ?? null, mark: d.mark ?? d.mid ?? null, last: d.last ?? null,
          volume: d.volume ?? null, ts,
        });
      }
    }

    // underlying spot (index symbols use the `index` param; equities/ETFs use `equity`)
    const isIndex = underlying === 'SPX' || underlying === 'NDX' || underlying === 'RUT' || underlying === 'VIX';
    const spotData = await this.rest.getMarketData(
      isIndex ? { index: [underlying] } : { equity: [underlying] },
    );
    const spot = spotData.find((d) => d.symbol === underlying);
    const spotPrice = spot?.last ?? spot?.mark ?? spot?.mid ?? null;
    if (spotPrice != null) this.store.setSpot(underlying, spotPrice);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/feed.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/feed.ts packages/tradfi/src/tastytrade/feed.test.ts
git commit -m "feat(tradfi): feed orchestration (REST snapshot path)"
```

---

### Task 13: Routes + Fastify app + entrypoint

**Files:**
- Create: `packages/tradfi/src/routes/venues.ts`, `underlyings.ts`, `expiries.ts`, `chains.ts`
- Create: `packages/tradfi/src/app.ts`
- Modify: `packages/tradfi/src/index.ts`
- Test: `packages/tradfi/src/app.test.ts`

- [ ] **Step 1: Write the failing test** (Fastify `inject`, feed/store seeded directly)

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { TradfiStore } from './runtime/store.js';
import type { TradfiInstrument } from './tastytrade/instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPLC', streamerSymbol: '.AAPL200C', canonical: 'AAPL/USD:USD-260417-200-C',
  multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
};

function seededDeps() {
  const store = new TradfiStore();
  store.setInstruments([inst]);
  store.setSpot('AAPL', 198);
  store.mergeQuote('.AAPL200C', { bid: 5, ask: 5.2, mark: 5.1, iv: 0.4, ts: 1 });
  const feed = { isLoaded: () => true, refreshChainQuotes: async () => {} };
  return { store, feed: feed as never };
}

describe('tradfi app', () => {
  it('GET /underlyings', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/underlyings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().underlyings).toEqual(['AAPL']);
    await app.close();
  });

  it('GET /expiries', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/expiries?underlying=AAPL' });
    expect(res.json().expiries).toEqual(['2026-04-17']);
    await app.close();
  });

  it('GET /chains returns an enriched chain', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2026-04-17' });
    expect(res.statusCode).toBe(200);
    expect(res.json().underlying).toBe('AAPL');
    expect(Array.isArray(res.json().strikes)).toBe(true);
    await app.close();
  });

  it('GET /chains 400 without params', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/chains' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/app.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the routes.** `packages/tradfi/src/routes/venues.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export async function venuesRoute(app: FastifyInstance) {
  app.get('/venues', async () => [
    { venue: 'tastytrade', capabilities: { optionChain: true, greeks: true, websocket: true } },
  ]);
}
```

`packages/tradfi/src/routes/underlyings.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';

export function underlyingsRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get('/underlyings', async () => ({ underlyings: deps.store.listUnderlyings() }));
  };
}
```

`packages/tradfi/src/routes/expiries.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';

export function expiriesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>('/expiries', async (req, reply) => {
      const underlying = req.query.underlying;
      if (!underlying) return reply.status(400).send({ error: 'underlying required' });
      return { underlying, expiries: deps.store.listExpiries(underlying) };
    });
  };
}
```

`packages/tradfi/src/routes/chains.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';

export function chainsRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; expiry?: string } }>(
      '/chains',
      async (req, reply) => {
        const { underlying, expiry } = req.query;
        if (!underlying || !expiry) {
          return reply.status(400).send({ error: 'underlying and expiry required' });
        }
        if (!deps.feed.isLoaded()) {
          return reply.status(503).send({ error: 'not ready' });
        }
        await deps.feed.refreshChainQuotes(underlying, expiry);
        return buildChain(deps.store, underlying, expiry, 'rest');
      },
    );
  };
}
```

- [ ] **Step 4: Implement `app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { TradfiStore } from './runtime/store.js';
import { venuesRoute } from './routes/venues.js';
import { underlyingsRoute } from './routes/underlyings.js';
import { expiriesRoute } from './routes/expiries.js';
import { chainsRoute } from './routes/chains.js';

export interface FeedLike {
  isLoaded(): boolean;
  refreshChainQuotes(underlying: string, expiry: string): Promise<void>;
}

export interface TradfiDeps {
  store: TradfiStore;
  feed: FeedLike;
}

export function buildApp(deps: TradfiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });
  void app.register(venuesRoute);
  void app.register(underlyingsRoute(deps));
  void app.register(expiriesRoute(deps));
  void app.register(chainsRoute(deps));
  return app;
}
```

- [ ] **Step 5: Implement `index.ts`** (the real entrypoint)

```ts
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { OAuth2TokenManager } from './tastytrade/auth.js';
import { TastytradeRest } from './tastytrade/rest.js';
import { TradfiFeed } from './tastytrade/feed.js';
import { TradfiStore } from './runtime/store.js';
import { buildApp } from './app.js';

async function main() {
  const cfg = loadConfig();
  const auth = new OAuth2TokenManager(cfg);
  const rest = new TastytradeRest({ baseUrl: cfg.baseUrl, userAgent: cfg.userAgent }, auth);
  const store = new TradfiStore();
  const feed = new TradfiFeed(rest, store, cfg.underlyings);

  const app = buildApp({ store, feed });
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  logger.info({ port: cfg.port }, 'tradfi service listening');

  feed.loadMarkets().then(
    () => logger.info('markets loaded'),
    (err: unknown) => logger.error({ err: String(err) }, 'loadMarkets failed'),
  );
}

main().catch((err: unknown) => {
  logger.error({ err: String(err) }, 'fatal');
  process.exit(1);
});
```

- [ ] **Step 6: Run the app test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/app.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full package green**

Run: `pnpm --filter @oggregator/tradfi typecheck && pnpm --filter @oggregator/tradfi test:run`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/tradfi/src/routes packages/tradfi/src/app.ts packages/tradfi/src/app.test.ts packages/tradfi/src/index.ts
git commit -m "feat(tradfi): routes, Fastify app, entrypoint (REST chain)"
```

---

### Task 14: M1 live Go/No-Go smoke test

**Files:** none (manual verification with real credentials).

- [ ] **Step 1: Put the OAuth creds in the repo-root `.env`** (gitignored — never commit):

```
TASTYTRADE_CLIENT_ID=...
TASTYTRADE_CLIENT_SECRET=...
TASTYTRADE_REFRESH_TOKEN=...
```

- [ ] **Step 2: Start the service**

Run: `pnpm --filter @oggregator/tradfi dev`
Expected: logs "tradfi service listening" then "markets loaded" (within ~10s). If OAuth fails with 401/`invalid_grant`, the `/oauth/token` body encoding may need JSON instead of form-urlencoded — switch `auth.ts` and capture the working request as a fixture.

- [ ] **Step 3: Hit the endpoints**

Run: `curl -s 'http://localhost:3200/underlyings'`
Expected: `{"underlyings":["AAPL","NDX","NVDA","QQQ","SPX","SPY","TSLA"]}` (order sorted).

Run: `curl -s 'http://localhost:3200/expiries?underlying=AAPL' | head -c 400`
Expected: a non-empty `expiries` array of `YYYY-MM-DD` strings.

Run: `curl -s 'http://localhost:3200/chains?underlying=AAPL&expiry=<near-expiry>' | head -c 600`
Expected: JSON with `underlying`, `expiry`, and a non-empty `strikes` array carrying real `bid`/`ask`/`mark`. (Greeks/IV will be null — that's M2.)

- [ ] **Step 4: Capture real payloads as fixtures** (secret-masked) into `references/options-docs/tastytrade/rest/`: one `api-quote-tokens.json`, one `option-chains-nested.json`, one `market-data-by-type.json`. These replace the doc-derived fixtures in M3.

- [ ] **Step 5: Commit the fixtures**

```bash
git add -f references/options-docs/tastytrade/rest
git commit -m "test(tradfi): capture live REST fixtures (secret-masked)"
```

**M1 GATE:** If `/chains` returns real quotes, the credential + endpoint risk is cleared — proceed to M2. If not, stop and resolve auth/endpoints before building DXLink.

---
---

# MILESTONE M2 — DXLink streaming (live quotes + greeks/IV)

Produces: a live DXLink connection populating the store; `/chains` returns full greeks/IV. Reads from the continuously-updated store instead of a per-request REST pull.

### Task 15: DXLink codec (frame builders + COMPACT parser)

**Files:**
- Create: `packages/tradfi/src/tastytrade/codec.ts`
- Test: `packages/tradfi/src/tastytrade/codec.test.ts`

- [ ] **Step 1: Write the failing test** (the FEED_DATA fixture is the verbatim example from `docs/tastydocs/` Streaming Market Data)

```ts
import { describe, expect, it } from 'vitest';
import { ACCEPT_EVENT_FIELDS, buildFeedSetup, buildSubscribe, parseFeedData } from './codec.js';

describe('dxlink codec', () => {
  it('builds a FEED_SETUP with COMPACT format', () => {
    const msg = buildFeedSetup(3);
    expect(msg.type).toBe('FEED_SETUP');
    expect(msg.acceptDataFormat).toBe('COMPACT');
    expect(msg.acceptEventFields.Quote[0]).toBe('eventType');
  });

  it('builds add/remove subscriptions', () => {
    const add = buildSubscribe(3, [{ type: 'Quote', symbol: '.AAPL200C' }], 'add');
    expect(add.add?.[0]).toEqual({ type: 'Quote', symbol: '.AAPL200C' });
    const remove = buildSubscribe(3, [{ type: 'Quote', symbol: '.AAPL200C' }], 'remove');
    expect(remove.remove?.[0]?.symbol).toBe('.AAPL200C');
  });

  it('parses a COMPACT Trade FEED_DATA frame (chunk-by-field-count, NaN->null)', () => {
    const frame = {
      type: 'FEED_DATA', channel: 3,
      data: ['Trade', ['Trade', 'SPY', 559.36, 1.3743299e7, 100.0,
                        'Trade', 'BTC/USD:CXTALP', 58356.71, 'NaN', 'NaN']],
    };
    const events = parseFeedData(frame);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventType: 'Trade', eventSymbol: 'SPY', price: 559.36, dayVolume: 1.3743299e7, size: 100 });
    expect(events[1]).toMatchObject({ eventType: 'Trade', eventSymbol: 'BTC/USD:CXTALP', price: 58356.71, dayVolume: null, size: null });
  });

  it('parses a Greeks frame with the documented field order', () => {
    const frame = {
      type: 'FEED_DATA', channel: 3,
      data: ['Greeks', ['Greeks', '.AAPL200C', 0.4, 0.55, 0.02, -0.03, 0.01, 0.12]],
    };
    const [g] = parseFeedData(frame);
    expect(g).toMatchObject({ eventType: 'Greeks', eventSymbol: '.AAPL200C', volatility: 0.4, delta: 0.55, gamma: 0.02, theta: -0.03, rho: 0.01, vega: 0.12 });
  });

  it('ignores non-FEED_DATA frames', () => {
    expect(parseFeedData({ type: 'FEED_CONFIG', channel: 3 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/codec.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `codec.ts`**

```ts
export type DxEventType = 'Quote' | 'Greeks' | 'Trade' | 'Summary';

export const ACCEPT_EVENT_FIELDS: Record<DxEventType, string[]> = {
  Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize'],
  Greeks: ['eventType', 'eventSymbol', 'volatility', 'delta', 'gamma', 'theta', 'rho', 'vega'],
  Trade: ['eventType', 'eventSymbol', 'price', 'dayVolume', 'size'],
  Summary: ['eventType', 'eventSymbol', 'openInterest', 'prevDayClosePrice'],
};

export interface DxSub {
  type: DxEventType;
  symbol: string;
}

export function buildSetup() {
  return { type: 'SETUP', channel: 0, version: '0.1-DXF-JS/0.3.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 };
}

export function buildAuth(token: string) {
  return { type: 'AUTH', channel: 0, token };
}

export function buildChannelRequest(channel: number) {
  return { type: 'CHANNEL_REQUEST', channel, service: 'FEED', parameters: { contract: 'AUTO' } };
}

export function buildFeedSetup(channel: number) {
  return {
    type: 'FEED_SETUP',
    channel,
    acceptAggregationPeriod: 0.1,
    acceptDataFormat: 'COMPACT' as const,
    acceptEventFields: ACCEPT_EVENT_FIELDS,
  };
}

export function buildSubscribe(channel: number, subs: DxSub[], action: 'add' | 'remove') {
  return { type: 'FEED_SUBSCRIPTION', channel, [action]: subs } as {
    type: 'FEED_SUBSCRIPTION'; channel: number; add?: DxSub[]; remove?: DxSub[];
  };
}

export function buildKeepalive() {
  return { type: 'KEEPALIVE', channel: 0 };
}

export interface DxEvent {
  eventType: DxEventType;
  eventSymbol: string;
  [field: string]: string | number | null;
}

function coerce(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v === 'NaN' || v === 'Infinity' || v === '-Infinity') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseFeedData(frame: unknown): DxEvent[] {
  if (typeof frame !== 'object' || frame == null) return [];
  const f = frame as { type?: unknown; data?: unknown };
  if (f.type !== 'FEED_DATA' || !Array.isArray(f.data) || f.data.length < 2) return [];

  const eventName = f.data[0] as DxEventType;
  const flat = f.data[1];
  if (!Array.isArray(flat)) return [];
  const fields = ACCEPT_EVENT_FIELDS[eventName];
  if (fields == null) return [];

  const events: DxEvent[] = [];
  for (let i = 0; i + fields.length <= flat.length; i += fields.length) {
    const chunk = flat.slice(i, i + fields.length);
    const symbol = chunk[1];
    if (typeof symbol !== 'string') continue;
    const ev: DxEvent = { eventType: eventName, eventSymbol: symbol };
    for (let j = 2; j < fields.length; j++) {
      ev[fields[j]!] = coerce(chunk[j]);
    }
    events.push(ev);
  }
  return events;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/codec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/codec.ts packages/tradfi/src/tastytrade/codec.test.ts
git commit -m "feat(tradfi): DXLink frame builders + COMPACT parser"
```

---

### Task 16: Subscription planner

**Files:**
- Create: `packages/tradfi/src/tastytrade/planner.ts`
- Test: `packages/tradfi/src/tastytrade/planner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { chainSubscriptions, underlyingSubscriptions } from './planner.js';

describe('planner', () => {
  it('expands streamer symbols into 4 event subs each', () => {
    const subs = chainSubscriptions(['.AAPL200C', '.AAPL200P']);
    expect(subs).toHaveLength(8);
    expect(subs.filter((s) => s.symbol === '.AAPL200C').map((s) => s.type).sort())
      .toEqual(['Greeks', 'Quote', 'Summary', 'Trade']);
  });

  it('subscribes underlyings to Quote+Trade', () => {
    const subs = underlyingSubscriptions(['AAPL']);
    expect(subs.map((s) => s.type).sort()).toEqual(['Quote', 'Trade']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/planner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `planner.ts`**

```ts
import type { DxSub, DxEventType } from './codec.js';

const CONTRACT_EVENTS: DxEventType[] = ['Quote', 'Greeks', 'Trade', 'Summary'];
const UNDERLYING_EVENTS: DxEventType[] = ['Quote', 'Trade'];

export function chainSubscriptions(streamerSymbols: string[]): DxSub[] {
  const subs: DxSub[] = [];
  for (const symbol of streamerSymbols) {
    for (const type of CONTRACT_EVENTS) subs.push({ type, symbol });
  }
  return subs;
}

export function underlyingSubscriptions(underlyings: string[]): DxSub[] {
  const subs: DxSub[] = [];
  for (const symbol of underlyings) {
    for (const type of UNDERLYING_EVENTS) subs.push({ type, symbol });
  }
  return subs;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/planner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/planner.ts packages/tradfi/src/tastytrade/planner.test.ts
git commit -m "feat(tradfi): DXLink subscription planner"
```

---

### Task 17: Event → store merge

**Files:**
- Create: `packages/tradfi/src/tastytrade/state.ts`
- Test: `packages/tradfi/src/tastytrade/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { applyEvent } from './state.js';
import { TradfiStore } from '../runtime/store.js';
import type { TradfiInstrument } from './instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPLC', streamerSymbol: '.AAPL200C', canonical: 'AAPL/USD:USD-260417-200-C',
  multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
};

describe('applyEvent', () => {
  it('merges a Quote into a contract and computes mark', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    applyEvent(s, { eventType: 'Quote', eventSymbol: '.AAPL200C', bidPrice: 5, askPrice: 5.4, bidSize: 1, askSize: 2 }, 10);
    const q = s.getQuote('.AAPL200C')!;
    expect(q.bid).toBe(5);
    expect(q.ask).toBe(5.4);
    expect(q.mark).toBeCloseTo(5.2);
  });

  it('merges Greeks (volatility -> iv)', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    applyEvent(s, { eventType: 'Greeks', eventSymbol: '.AAPL200C', volatility: 0.4, delta: 0.55, gamma: 0.02, theta: -0.03, rho: 0.01, vega: 0.12 }, 11);
    const q = s.getQuote('.AAPL200C')!;
    expect(q.iv).toBe(0.4);
    expect(q.delta).toBe(0.55);
  });

  it('sets spot when the event is for an underlying symbol', () => {
    const s = new TradfiStore();
    s.setInstruments([inst]);
    applyEvent(s, { eventType: 'Trade', eventSymbol: 'AAPL', price: 198.5, dayVolume: 1000 }, 12);
    expect(s.getSpot('AAPL')).toBe(198.5);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `state.ts`**

```ts
import type { DxEvent } from './codec.js';
import type { TradfiStore, TradfiLiveQuote } from '../runtime/store.js';

export function applyEvent(store: TradfiStore, ev: DxEvent, ts: number): void {
  const inst = store.getInstrument(ev.eventSymbol);

  // Underlying symbol (no option instrument) -> spot price.
  if (inst == null) {
    const price = (ev.eventType === 'Trade' ? ev.price : null) ?? (ev.eventType === 'Quote' ? mid(ev.bidPrice, ev.askPrice) : null);
    if (typeof price === 'number') store.setSpot(ev.eventSymbol, price);
    return;
  }

  const patch: Partial<TradfiLiveQuote> & { ts: number } = { ts };

  switch (ev.eventType) {
    case 'Quote': {
      patch.bid = numOrNull(ev.bidPrice);
      patch.ask = numOrNull(ev.askPrice);
      patch.bidSize = numOrNull(ev.bidSize);
      patch.askSize = numOrNull(ev.askSize);
      const m = mid(ev.bidPrice, ev.askPrice);
      if (m != null) patch.mark = m;
      break;
    }
    case 'Greeks': {
      patch.iv = numOrNull(ev.volatility);
      patch.delta = numOrNull(ev.delta);
      patch.gamma = numOrNull(ev.gamma);
      patch.theta = numOrNull(ev.theta);
      patch.vega = numOrNull(ev.vega);
      patch.rho = numOrNull(ev.rho);
      break;
    }
    case 'Trade': {
      patch.last = numOrNull(ev.price);
      patch.volume = numOrNull(ev.dayVolume);
      break;
    }
    case 'Summary': {
      patch.openInterest = numOrNull(ev.openInterest);
      break;
    }
  }

  store.mergeQuote(ev.eventSymbol, patch);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function mid(bid: unknown, ask: unknown): number | null {
  const b = numOrNull(bid);
  const a = numOrNull(ask);
  return b != null && a != null ? (b + a) / 2 : null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/state.ts packages/tradfi/src/tastytrade/state.test.ts
git commit -m "feat(tradfi): merge DXLink events into the store"
```

---

### Task 18: DXLink client (wraps `TopicWsClient`)

**Files:**
- Create: `packages/tradfi/src/tastytrade/dxlink-client.ts`
- Test: `packages/tradfi/src/tastytrade/dxlink-client.test.ts`

The handshake is message-driven. `TopicWsClient.onOpen` sends SETUP; the state machine in `onMessage` advances SETUP→AUTH→CHANNEL→FEED_SETUP; on `FEED_CONFIG` the client is "ready" and replays desired subscriptions. Keepalive uses `pingMessage`.

- [ ] **Step 1: Write the failing test** (drive the state machine directly via an injected message sink — no real socket)

```ts
import { describe, expect, it, vi } from 'vitest';
import { DxLinkProtocol } from './dxlink-client.js';

describe('DxLinkProtocol state machine', () => {
  it('walks the handshake and emits subscribe after FEED_CONFIG', () => {
    const sent: unknown[] = [];
    const onData = vi.fn();
    const proto = new DxLinkProtocol({
      channel: 3,
      token: 'QT',
      send: (m) => sent.push(m),
      onData,
      desiredSubs: () => [{ type: 'Quote', symbol: '.AAPL200C' }],
    });

    proto.onOpen();
    expect((sent[0] as { type: string }).type).toBe('SETUP');

    proto.onMessage({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
    expect((sent[1] as { type: string }).type).toBe('AUTH');

    proto.onMessage({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
    expect((sent[2] as { type: string }).type).toBe('CHANNEL_REQUEST');

    proto.onMessage({ type: 'CHANNEL_OPENED', channel: 3 });
    expect((sent[3] as { type: string }).type).toBe('FEED_SETUP');

    proto.onMessage({ type: 'FEED_CONFIG', channel: 3 });
    expect((sent[4] as { type: string }).type).toBe('FEED_SUBSCRIPTION');
    expect(proto.isReady()).toBe(true);
  });

  it('routes FEED_DATA to onData', () => {
    const onData = vi.fn();
    const proto = new DxLinkProtocol({ channel: 3, token: 'QT', send: () => {}, onData, desiredSubs: () => [] });
    proto.onMessage({ type: 'FEED_DATA', channel: 3, data: ['Trade', ['Trade', 'AAPL', 1, 2, 3]] });
    expect(onData).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/dxlink-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `dxlink-client.ts`** (protocol state machine + a thin `TopicWsClient` wrapper)

```ts
import { TopicWsClient } from '@oggregator/core';
import type { WebSocket } from 'ws';
import {
  buildAuth, buildChannelRequest, buildFeedSetup, buildKeepalive, buildSetup, buildSubscribe,
  parseFeedData, type DxEvent, type DxSub,
} from './codec.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('dxlink');

export interface DxLinkProtocolOptions {
  channel: number;
  token: string;
  send: (msg: unknown) => void;
  onData: (events: DxEvent[]) => void;
  desiredSubs: () => DxSub[];
}

export class DxLinkProtocol {
  private ready = false;
  constructor(private readonly o: DxLinkProtocolOptions) {}

  isReady(): boolean {
    return this.ready;
  }

  onOpen(): void {
    this.ready = false;
    this.o.send(buildSetup());
  }

  onMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg == null) return;
    const m = msg as { type?: string; state?: string };
    switch (m.type) {
      case 'AUTH_STATE':
        if (m.state === 'UNAUTHORIZED') this.o.send(buildAuth(this.o.token));
        else if (m.state === 'AUTHORIZED') this.o.send(buildChannelRequest(this.o.channel));
        return;
      case 'CHANNEL_OPENED':
        this.o.send(buildFeedSetup(this.o.channel));
        return;
      case 'FEED_CONFIG': {
        this.ready = true;
        const subs = this.o.desiredSubs();
        if (subs.length > 0) this.o.send(buildSubscribe(this.o.channel, subs, 'add'));
        return;
      }
      case 'FEED_DATA': {
        const events = parseFeedData(msg);
        if (events.length > 0) this.o.onData(events);
        return;
      }
      default:
        return;
    }
  }

  subscribe(subs: DxSub[]): void {
    if (this.ready && subs.length > 0) this.o.send(buildSubscribe(this.o.channel, subs, 'add'));
  }

  unsubscribe(subs: DxSub[]): void {
    if (this.ready && subs.length > 0) this.o.send(buildSubscribe(this.o.channel, subs, 'remove'));
  }
}

export interface DxLinkClientOptions {
  url: string;
  token: string;
  onData: (events: DxEvent[]) => void;
  desiredSubs: () => DxSub[];
}

const CHANNEL = 3;

export class DxLinkClient {
  private ws: TopicWsClient | null = null;
  private proto: DxLinkProtocol | null = null;

  constructor(private readonly o: DxLinkClientOptions) {}

  async connect(): Promise<void> {
    const proto = new DxLinkProtocol({
      channel: CHANNEL,
      token: this.o.token,
      send: (m) => this.ws?.send(m as Record<string, unknown>),
      onData: this.o.onData,
      desiredSubs: this.o.desiredSubs,
    });
    this.proto = proto;

    this.ws = new TopicWsClient(this.o.url, 'tradfi-dxlink', {
      pingIntervalMs: 30_000,
      pingMessage: buildKeepalive(),
      onOpen: () => proto.onOpen(),
      onMessage: (raw: WebSocket.RawData) => {
        try {
          proto.onMessage(JSON.parse(raw.toString()));
        } catch (err: unknown) {
          log.debug({ err: String(err) }, 'bad dxlink frame');
        }
      },
      onStatusChange: (state) => log.info({ state }, 'dxlink status'),
    });
    await this.ws.connect();
  }

  subscribe(subs: DxSub[]): void {
    this.proto?.subscribe(subs);
  }

  unsubscribe(subs: DxSub[]): void {
    this.proto?.unsubscribe(subs);
  }

  async disconnect(): Promise<void> {
    await this.ws?.disconnect();
    this.ws = null;
    this.proto = null;
  }
}
```

> Note: `TopicWsClient`'s `getReplayMessages` fires before the channel is open, so it is intentionally unused here — re-subscription is driven from `FEED_CONFIG` via `desiredSubs()`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/dxlink-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/dxlink-client.ts packages/tradfi/src/tastytrade/dxlink-client.test.ts
git commit -m "feat(tradfi): DXLink client + handshake state machine"
```

---

### Task 19: Wire DXLink into the feed; `/chains` reads the live store

**Files:**
- Modify: `packages/tradfi/src/tastytrade/feed.ts`
- Modify: `packages/tradfi/src/routes/chains.ts`
- Test: `packages/tradfi/src/tastytrade/feed.test.ts` (extend)

- [ ] **Step 1: Add a feed test for streaming bootstrap** (append to `feed.test.ts`)

```ts
it('connects DXLink and subscribes all loaded chains + underlyings', async () => {
  const store = new TradfiStore();
  const rest = stubRest();
  rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
  const subscribed: unknown[] = [];
  const fakeDx = {
    connect: vi.fn(async () => {}),
    subscribe: vi.fn((subs: unknown) => subscribed.push(subs)),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(async () => {}),
  };
  const feed = new TradfiFeed(rest as never, store, ['AAPL'], () => fakeDx as never);
  await feed.loadMarkets();
  await feed.startStreaming();
  expect(rest.getQuoteToken).toHaveBeenCalled();
  expect(fakeDx.connect).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/feed.test.ts`
Expected: FAIL (`startStreaming` not a function).

- [ ] **Step 3: Extend `feed.ts`** — add a DXLink factory dependency, `startStreaming`, an `onData` handler, and `dispose`. Add these imports and members:

```ts
import { applyEvent } from './state.js';
import { chainSubscriptions, underlyingSubscriptions } from './planner.js';
import type { DxEvent, DxSub } from './codec.js';
import type { DxLinkClient } from './dxlink-client.js';
import { DxLinkClient as RealDxLinkClient } from './dxlink-client.js';
```

Change the constructor to accept an optional DXLink factory (default real):

```ts
constructor(
  private readonly rest: TastytradeRest,
  private readonly store: TradfiStore,
  private readonly underlyings: string[],
  private readonly dxFactory: (opts: {
    url: string; token: string;
    onData: (e: DxEvent[]) => void; desiredSubs: () => DxSub[];
  }) => DxLinkClient = (opts) => new RealDxLinkClient(opts),
) {}

private dx: DxLinkClient | null = null;
private desired: DxSub[] = [];
```

Add the streaming methods:

```ts
async startStreaming(): Promise<void> {
  const qt = await this.rest.getQuoteToken();
  const symbols = this.store.allInstruments().map((i) => i.streamerSymbol);
  this.desired = [...chainSubscriptions(symbols), ...underlyingSubscriptions(this.underlyings)];

  this.dx = this.dxFactory({
    url: qt.dxlinkUrl,
    token: qt.token,
    onData: (events) => {
      const ts = Date.now();
      for (const ev of events) applyEvent(this.store, ev, ts);
    },
    desiredSubs: () => this.desired,
  });
  await this.dx.connect();
  log.info({ subs: this.desired.length }, 'dxlink streaming started');
}

async dispose(): Promise<void> {
  await this.dx?.disconnect();
  this.dx = null;
}
```

- [ ] **Step 4: Make `/chains` read the live store** — in `chains.ts`, drop the per-request REST refresh once streaming is the source of truth. Replace the handler body with:

```ts
const { underlying, expiry } = req.query;
if (!underlying || !expiry) {
  return reply.status(400).send({ error: 'underlying and expiry required' });
}
if (!deps.feed.isLoaded()) {
  return reply.status(503).send({ error: 'not ready' });
}
return buildChain(deps.store, underlying, expiry, 'ws');
```

Remove `refreshChainQuotes` from the `FeedLike` interface in `app.ts` (it is no longer called by routes); keep the method on `TradfiFeed` for diagnostics/fallback. Update `app.test.ts`'s `feed` stub to drop `refreshChainQuotes`.

- [ ] **Step 5: Call `startStreaming` from the entrypoint** — in `index.ts`, after `loadMarkets` succeeds:

```ts
feed.loadMarkets()
  .then(() => feed.startStreaming())
  .then(() => logger.info('markets loaded + streaming'))
  .catch((err: unknown) => logger.error({ err: String(err) }, 'bootstrap failed'));
```

- [ ] **Step 6: Run the package tests**

Run: `pnpm --filter @oggregator/tradfi test:run`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add packages/tradfi/src
git commit -m "feat(tradfi): stream DXLink into the store; /chains reads live"
```

---

### Task 20: M2 live smoke

**Files:** none (manual).

- [ ] **Step 1: Run the service** (market open gives the richest data): `pnpm --filter @oggregator/tradfi dev`
Expected: logs "markets loaded + streaming"; "dxlink status connected".

- [ ] **Step 2: Verify greeks/IV are populated**

Run: `curl -s 'http://localhost:3200/chains?underlying=AAPL&expiry=<near-expiry>' | head -c 800`
Expected: `strikes[].call/put` carry non-null `markIv`, `delta`, `gamma`; ATM-area IV is sane (e.g. 0.1–1.0). If quotes are present but greeks null, confirm the `Greeks` event subscription and the COMPACT field order against a captured frame.

- [ ] **Step 3: Capture a real FEED_DATA frame** (Quote + Greeks) into `references/options-docs/tastytrade/dxlink/` (mask the symbol if desired), and a real `api-quote-tokens` response. Reconcile `codec.test.ts` against the captured frame if the field layout differs.

- [ ] **Step 4: Commit fixtures**

```bash
git add -f references/options-docs/tastytrade/dxlink
git commit -m "test(tradfi): capture live DXLink fixtures"
```

---
---

# MILESTONE M3 — Polish (market hours, token refresh, WS push)

### Task 21: Market-hours health

**Files:**
- Create: `packages/tradfi/src/tastytrade/health.ts`
- Test: `packages/tradfi/src/tastytrade/health.test.ts`

- [ ] **Step 1: Write the failing test** (fixed epoch inputs; ET via `Intl`)

```ts
import { describe, expect, it } from 'vitest';
import { isUsEquityMarketOpen } from './health.js';

describe('isUsEquityMarketOpen', () => {
  it('open on a weekday mid-session', () => {
    // 2026-04-16 is a Thursday; 14:00 UTC = 10:00 ET (EDT)
    expect(isUsEquityMarketOpen(Date.parse('2026-04-16T14:00:00Z'))).toBe(true);
  });
  it('closed on weekend', () => {
    // 2026-04-18 is a Saturday
    expect(isUsEquityMarketOpen(Date.parse('2026-04-18T14:00:00Z'))).toBe(false);
  });
  it('closed before the open', () => {
    // 12:00 UTC = 08:00 ET, before 09:30
    expect(isUsEquityMarketOpen(Date.parse('2026-04-16T12:00:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/health.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `health.ts`** (holidays omitted in v1 — documented follow-up)

```ts
const ET = 'America/New_York';

export function isUsEquityMarketOpen(nowMs: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(nowMs));

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60; // 09:30–16:00 ET, holidays not handled (v1)
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/tastytrade/health.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tradfi/src/tastytrade/health.ts packages/tradfi/src/tastytrade/health.test.ts
git commit -m "feat(tradfi): US equity market-hours check"
```

---

### Task 22: Quote-token refresh + DXLink reconnect on token expiry

**Files:**
- Modify: `packages/tradfi/src/tastytrade/feed.ts`

`TopicWsClient` already reconnects on socket close. Add proactive quote-token refresh: the token is 24h; re-fetch it ~30 min before expiry and reconnect DXLink with the fresh token.

- [ ] **Step 1: Add a refresh timer in `startStreaming`** (after `this.dx.connect()`):

```ts
const QUOTE_TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // re-auth ~1h before the 24h expiry
this.tokenTimer = setInterval(() => {
  void this.reconnectStreaming();
}, QUOTE_TOKEN_TTL_MS);
```

Add the member `private tokenTimer: ReturnType<typeof setInterval> | null = null;` and:

```ts
private async reconnectStreaming(): Promise<void> {
  try {
    await this.dx?.disconnect();
    await this.startStreaming();
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'dxlink token-refresh reconnect failed');
  }
}
```

Clear the timer in `dispose`:

```ts
if (this.tokenTimer) { clearInterval(this.tokenTimer); this.tokenTimer = null; }
```

Guard `startStreaming` against double timers (clear any existing `tokenTimer` at the top).

- [ ] **Step 2: Typecheck + test**

Run: `pnpm --filter @oggregator/tradfi typecheck && pnpm --filter @oggregator/tradfi test:run`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/tradfi/src/tastytrade/feed.ts
git commit -m "feat(tradfi): proactive quote-token refresh + dxlink reconnect"
```

---

### Task 23: WS push route `/ws/chain`

**Files:**
- Create: `packages/tradfi/src/routes/ws-chain.ts`
- Modify: `packages/tradfi/src/app.ts` (register `@fastify/websocket` + route)
- Test: `packages/tradfi/src/routes/ws-chain.test.ts`

- [ ] **Step 1: Write the failing test** (coalescer is pure and unit-testable)

```ts
import { describe, expect, it, vi } from 'vitest';
import { ChainPusher } from './ws-chain.js';
import { TradfiStore } from '../runtime/store.js';

describe('ChainPusher', () => {
  it('pushes an enriched snapshot on tick', () => {
    const store = new TradfiStore();
    const sent: string[] = [];
    const pusher = new ChainPusher(store, (s) => sent.push(s), 'AAPL', '2026-04-17');
    pusher.tick();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).underlying).toBe('AAPL');
  });

  it('stops after dispose', () => {
    const store = new TradfiStore();
    const sent: string[] = [];
    const pusher = new ChainPusher(store, (s) => sent.push(s), 'AAPL', '2026-04-17');
    pusher.dispose();
    pusher.tick();
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @oggregator/tradfi exec vitest run src/routes/ws-chain.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ws-chain.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import type { TradfiStore } from '../runtime/store.js';
import { buildChain } from '../runtime/chain.js';

const PUSH_INTERVAL_MS = 200;

export class ChainPusher {
  private disposed = false;
  constructor(
    private readonly store: TradfiStore,
    private readonly send: (data: string) => void,
    private readonly underlying: string,
    private readonly expiry: string,
  ) {}

  tick(): void {
    if (this.disposed) return;
    this.send(JSON.stringify(buildChain(this.store, this.underlying, this.expiry, 'ws')));
  }

  dispose(): void {
    this.disposed = true;
  }
}

export function wsChainRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; expiry?: string } }>(
      '/ws/chain',
      { websocket: true },
      (socket, req) => {
        const { underlying, expiry } = req.query;
        if (!underlying || !expiry) {
          socket.send(JSON.stringify({ type: 'error', message: 'underlying and expiry required' }));
          socket.close();
          return;
        }
        const pusher = new ChainPusher(deps.store, (d) => socket.send(d), underlying, expiry);
        const timer = setInterval(() => pusher.tick(), PUSH_INTERVAL_MS);
        pusher.tick();
        socket.on('close', () => {
          clearInterval(timer);
          pusher.dispose();
        });
      },
    );
  };
}
```

- [ ] **Step 4: Register websocket + route in `app.ts`** — add:

```ts
import websocket from '@fastify/websocket';
import { wsChainRoute } from './routes/ws-chain.js';
```

and inside `buildApp`, before the other routes:

```ts
void app.register(websocket);
void app.register(wsChainRoute(deps));
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @oggregator/tradfi test:run`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add packages/tradfi/src/routes/ws-chain.ts packages/tradfi/src/routes/ws-chain.test.ts packages/tradfi/src/app.ts
git commit -m "feat(tradfi): /ws/chain live push route"
```

---

### Task 24: Finalize — fixtures-as-truth, full green, docs

**Files:**
- Modify: `packages/tradfi/src/tastytrade/types.test.ts`, `codec.test.ts` (point at captured fixtures from Tasks 14 & 20)
- Create: `packages/tradfi/README.md`

- [ ] **Step 1: Replace doc-derived fixtures with captured ones.** Import the JSON captured in `references/options-docs/tastytrade/{rest,dxlink}/` into the schema/codec tests (via `resolveJsonModule`) and assert they parse. If a captured payload doesn't match a schema, fix the schema to the captured shape (the live API is the source of truth).

- [ ] **Step 2: Write `packages/tradfi/README.md`** documenting: purpose (separate TradFi service), env vars, `pnpm --filter @oggregator/tradfi dev`, the routes, and the OAuth/DXLink token chain. Keep it ~30 lines.

- [ ] **Step 3: Full repo green**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0 across all packages (including `@oggregator/tradfi`).

- [ ] **Step 4: Commit**

```bash
git add -A packages/tradfi
git add -f references/options-docs/tastytrade
git commit -m "test(tradfi): fixtures-as-truth + README; full suite green"
```

---
---

## Out of scope (later phases — not in this plan)
- Web: TRADFI button + black theme + CHAIN page in `packages/web` (own spec/plan).
- ES/NQ futures options (`/futures-option-chains` + CME entitlement).
- Deploy routing on the Scaleway box (new port/unit, e.g. `tradfi-api.oggregator.xyz`) — manual ops.
- Real per-contract fee modeling (v1 returns `estimatedFees: null`).
- Market-holiday calendar (v1 market-hours handles weekdays/hours only).

## Self-Review notes (verify during execution)
- **Spot for index underlyings:** SPX/NDX spot via `/market-data/by-type?index[]=SPX` (REST) and via DXLink subscribing the bare `SPX` symbol. If the index streamer symbol differs, capture it from the nested chain's underlying or `/instruments` and adjust `underlyingSubscriptions`.
- **OAuth body encoding:** if `/oauth/token` rejects form-urlencoded, switch `auth.ts` to JSON (Task 14 catches this).
- **Nested chain shape:** Task 6 schema assumes `expirations[]` arrays; if the captured payload differs, fix the schema (Task 24).
- **`exactOptionalPropertyTypes`:** when building patches/objects, omit optional keys rather than setting `undefined` (already followed above).
