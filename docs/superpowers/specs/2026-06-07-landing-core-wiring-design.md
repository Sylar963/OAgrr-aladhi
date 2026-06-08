# Wiring `apps/landing` ↔ the core app — Design Spec

- **Date:** 2026-06-07
- **Status:** Approved (brainstorming → spec). Next step: writing-plans.
- **Owner:** landing/core integration
- **Approach:** ① Decoupled REST + one shared contract (see §3).

---

## 1. Context & problem

`apps/landing` is a **Next.js 16 marketing site** that is a fully standalone island — it has zero connection to `packages/*`:

1. **No path into the product.** The only CTA (`components/LandingHeader.tsx` → `lib/copy.ts`) is "Request Access" → in-page `#access` lead form. Nothing links to the live SPA; there is no sign-in.
2. **All data is hardcoded.** `lib/demo-data.ts` holds static ticker/terminal/surface/market-context literals, while `packages/server` already serves the real versions (`/api/stats`, `/api/surface`, `/api/venues`, `/api/iv-history`, `/api/flow`, `/api/chains`).
3. **Leads vanish.** `lib/lead-store.ts` does `appendFile('.data/landing-leads.jsonl')` — ephemeral on Vercel serverless, never reaching the core DB or any waitlist.
4. **No `@oggregator/*` coupling.** Landing `package.json` has no workspace dependency, yet **both** `vercel.json` files prebuild `@oggregator/protocol` — an aspirational step that is currently dead.

**Continuity:** this is the sanctioned continuation of the approved [`2026-05-12-public-landing-design.md`](./2026-05-12-public-landing-design.md), which built the landing as a static funnel and explicitly deferred this work to later phases: **Phase 5 "live upgrades"** (bind live ticker / IV / OI / surface = Workstream B), the 3D surface **Phase 3 "real data binding"** (= B2), **"handoff into the trading aggregator after lead capture"** (= Workstream A), and **Phase 4 "conversion plumbing"** (graduate the minimal lead sink = Workstream C). That spec mandated *"every market-facing component should accept typed props so phase 2 can wire real data without redesigning the component tree"* — which is exactly what makes the server-fetch-and-pass-props approach in §6 clean — and required the landing stay *"operationally separate from `packages/web`"*, which is why Approach ① (not the shared-package ②) is correct.

The core app it must wire into:
- `packages/web` — Vite 6 + React 19 SPA (deployed to Vercel; root `vercel.json` outputs `packages/web/dist`). Clerk auth is code-complete/committed; go-live is ops-only.
- `packages/server` — Fastify REST + WS API (Scaleway, `api.oggregator.xyz`). Public REST routes already expose all the data the landing fakes.
- `packages/db` — Postgres store + sequential SQL migrations (latest `0016`).
- `packages/protocol` — shared Zod contracts; per the server's own docs, the source of truth for cross-boundary payloads.

## 2. Goals & non-goals

**Goals (the three integrations chosen by the owner):**
- **A. Launch into the app** — a real entry point from the landing into the live SPA at `https://app.oggregator.xyz`.
- **B. Live market data** — drive the landing's ticker / venue strip / market-context (and then surface + chain rows) from the real `/api/*` endpoints, with the static data kept as a fallback.
- **C. Durable lead capture** — persist "Request Access" leads into core Postgres via a new server endpoint, with a local-file fallback so a lead is never lost.

**Non-goals (explicitly de-scoped):**
- Deployment / domain reconciliation of the dual `vercel.json` setup.
- Client-side polling or realtime WebSocket on the landing page.
- Clerk go-live (separate ops track, already covered by the funded/Clerk work).

## 3. Decisions

- **App URL:** `https://app.oggregator.xyz` (dedicated app subdomain; cross-origin from the landing). Configurable via `NEXT_PUBLIC_APP_URL`.
- **Data freshness:** periodic **server snapshot via Next.js ISR** (`revalidate: 300`). All fetches are server-side → no CORS, no client load, **no new sockets**.
- **Lead storage:** **core Postgres via a new `POST /api/leads`** Fastify endpoint; the landing's Next route forwards server-to-server.
- **Coupling:** Approach ① — the landing stays a standalone deploy; it shares **only** the lead contract via `@oggregator/protocol`. Live-data response shapes are re-declared with small local Zod parsers at the landing's HTTP boundary — the same intentional duplication `packages/web` already uses (`shared-types`). Approach ② (shared api-client/types package) and ③ (client fetch + email leads) were rejected as over-engineered / counter to the owner's choices.

## 4. Architecture & data flow

The landing remains its own Next.js deploy. Everything crosses to the core over **HTTPS, server-side only**.

```
                         ┌──────────────────── apps/landing (Next.js, Vercel) ───────────────────┐
                         │  app/page.tsx (Server Component)                                       │
  Visitor ──▶ landing ──▶│    ├─ getMarketSnapshot()  ──ISR fetch (revalidate 300s)──▶ api.ogg    │
                         │    │     /api/stats /api/venues /api/iv-history /api/surface (read-only)│
                         │    │     ▲ on error/timeout → demo-data.ts fallback                     │
                         │    ├─ <LaunchCTA href={NEXT_PUBLIC_APP_URL}>  ──────────▶ app.oggregator.xyz
                         │    └─ POST /api/leads (Next route) ──server-to-server──▶ /api/leads      │
                         │          ▲ on failure → local JSONL fallback (never lose a lead)        │
                         └────────────────────────────────────────────────────────────────────────┘
                                                                  │
   packages/protocol  ──LeadCaptureRequestSchema (shared)──┐      ▼
   packages/server    POST /api/leads (public route) ─▶ leadsStore ─▶ Postgres (migration 0017)
   packages/db        leads-store.ts (Postgres | Noop)
```

The web SPA and the WS/transport layer are **not touched** by any workstream.

## 5. Workstream A — Launch into the app

Additive, presentational. The app self-gates with Clerk once ops steps land, so the landing only needs a deep link.

**Changes:**
- **`apps/landing/lib/links.ts`** (new):
  `export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.oggregator.xyz';`
- **`apps/landing/components/LandingHeader.tsx`** (modify): add a primary **"Launch terminal"** anchor → `appUrl` (`rel="noopener"`); keep "Request Access" as the secondary `#access` link.
- **`apps/landing/components/HeroTerminalSection.tsx`** (modify): wire the existing `secondaryCta` ("See the terminal") to `appUrl`; primary stays "Request Access".
- **`apps/landing/lib/copy.ts`** (modify): add `nav.launch` and `hero.launchCta` strings. No structural change to the `landingCopy` object shape beyond new keys.

**Acceptance:** header and hero render a launch link whose `href` equals `appUrl`; "Request Access" still scrolls to `#access`.

## 6. Workstream B — Live market data (ISR snapshot)

`app/page.tsx` is already a Server Component → fetch once on the server, pass props down. **`demo-data.ts` is kept and becomes the typed fallback**; the page renders identically when the API is unreachable, and the build never depends on API uptime.

**New modules:**
- **`apps/landing/lib/api.ts`** — server-only fetchers. Each call:
  `fetch(`${apiBase}${path}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) })`
  where `apiBase = process.env.LANDING_API_BASE_URL ?? 'https://api.oggregator.xyz'`. Each response validated by a small local Zod schema at the boundary (no `@oggregator/protocol` dependency for these read shapes).
- **`apps/landing/lib/market-snapshot.ts`** — `getMarketSnapshot()` calls the fetchers, maps results into the existing `demo-data.ts` shapes, and on **any** failure returns the static demo objects. Returns one typed object consumed by `app/page.tsx`.

**Phasing (both under Approach ①):**

### B1 — scalars (high value, low risk)
| Landing surface | Source endpoint | Mapping |
|---|---|---|
| Ticker "BTC 30D IV" | `/api/stats?underlying=BTC` | `dvol.current` (×, fmt %); change ← `dvol.ivChange1d` |
| Ticker spot / 24h | `/api/stats?underlying=BTC` | `spot.price`, `spot.change24hPct` |
| Ticker "ETH 25D RR" | `/api/iv-history?underlying=ETH` | latest 25Δ RR |
| `terminalMetrics` "NN connected" + `VenueStrip` status | `/api/venues` | count + per-venue `capabilities`/online |
| `marketContextRows` (BTC ATM IV, ETH RR, …) | `/api/stats`, `/api/iv-history` | per-underlying scalars; fallback for assets not hot |

### B2 — heavier transforms
| Landing surface | Source endpoint | Mapping |
|---|---|---|
| Vol surface (`VolSurfaceShowcase` / `LandingSurfacePlot`) | `/api/surface?underlying=BTC` | adapt grid → existing plot input shape |
| `terminalRows` (symbol/IV/skew/venue/edge) | `/api/expiries` → `/api/chains?underlying=BTC&expiry=<nearest>` | enriched best-edge rows |

**Honesty rule:** marketing metrics with **no** backing endpoint (e.g. "Latency Budget", "Best Venue Edge", "Cross-Venue Depth") stay as **curated static copy** — never fabricate a live-looking number that has no data source.

**Acceptance:** with the API mocked, the page renders live values; with the API erroring/timing out, it renders the exact `demo-data.ts` fallback; no client-side fetch and no WebSocket is introduced.

## 7. Workstream C — Durable lead capture

### 7.1 Shared contract — `packages/protocol`
- **`packages/protocol/src/leads.ts`** (new): `LeadCaptureRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320), source: z.string().trim().min(1).max(64) })` + `type LeadCaptureRequest`. Re-export both from `packages/protocol/src/index.ts` (alphabetical block, matching existing style).
- **`packages/protocol/src/leads.test.ts`** (new): accept valid, reject bad email / empty source / overlong.
- This makes the `@oggregator/protocol` prebuild in both `vercel.json` meaningful.

### 7.2 Migration — `packages/db`
- **`packages/db/migrations/0017_create_landing_leads.sql`** (new), matching existing DDL conventions (`TEXT PRIMARY KEY`, `TIMESTAMPTZ DEFAULT now()`, `IF NOT EXISTS`):
  ```sql
  CREATE TABLE IF NOT EXISTS landing_leads (
    id          TEXT PRIMARY KEY,            -- lead_<uuid>
    email       TEXT NOT NULL,
    source      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- expression-unique index supports ON CONFLICT (lower(email)) upsert dedupe
  CREATE UNIQUE INDEX IF NOT EXISTS landing_leads_email_idx ON landing_leads (lower(email));
  CREATE INDEX IF NOT EXISTS landing_leads_created_at_idx ON landing_leads (created_at);
  ```

### 7.3 Store — `packages/db`
- **`packages/db/src/leads-store.ts`** (new), mirroring `users-store.ts`:
  - `LeadRow { id; email; source; createdAt: Date }`, `CaptureLeadInput { email; source }`.
  - `interface LeadsStore { readonly enabled; captureLead(input): Promise<LeadRow | null>; dispose(): Promise<void> }`.
  - `NoopLeadsStore` (`enabled=false`, returns `null`).
  - `PostgresLeadsStore` (`enabled=true`, `fromConnectionString()` → `Pool` with the same timeouts; `id = \`lead_${crypto.randomUUID()}\``; `INSERT … ON CONFLICT (lower(email)) DO UPDATE SET source = EXCLUDED.source RETURNING …`; snake_case row interface + `mapRow`).
- **`packages/db/src/leads-store.test.ts`** (new): mirror `users-store.test.ts` (Noop returns null; mapRow shape).
- Export the store + types from `packages/db/src/index.ts`.

### 7.4 Endpoint — `packages/server`
- **`packages/server/src/services.ts`** (modify): `export const leadsStore: LeadsStore = DATABASE_URL ? PostgresLeadsStore.fromConnectionString(DATABASE_URL) : new NoopLeadsStore();` (existing idiom).
- **`packages/server/src/routes/leads.ts`** (new): public `POST /api/leads` (no auth). Validate body with `LeadCaptureRequestSchema`; on success `leadsStore.captureLead(...)` → `201 { ok: true }`; invalid → `400 { ok: false, error }`; when `!leadsStore.enabled` → `503 { error: 'persistence_unavailable', message: 'DATABASE_URL not set' }` (same idiom as paper routes).
- **`packages/server/src/routes/index.ts`** (modify): `app.register(leadsRoute, { prefix: '/api' });`.
- **`packages/server/src/routes/leads.test.ts`** (new): 201 valid, 400 invalid, 503 no-DB.

### 7.5 Landing forwarder — `apps/landing`
- **`apps/landing/lib/lead-schema.ts`** (modify): re-export `LeadCaptureRequestSchema` (+ alias `leadSchema`/`LeadInput`) from `@oggregator/protocol` so the landing and server validate identically.
- **`apps/landing/lib/lead-store.ts`** (modify): `persistLead()` POSTs to `${LANDING_API_BASE_URL}/api/leads` server-to-server; **on any non-2xx or network error, fall back to the existing JSONL append** (keep `resolveLeadFilePath()` / `LANDING_LEADS_FILE`). The Next route (`app/api/leads/route.ts`) keeps returning `201` to the client when either path succeeds.
- **`apps/landing/package.json`** (modify): add `"@oggregator/protocol": "workspace:"`.
- **`apps/landing/app/api/leads/route.test.ts`** (modify): assert forward-on-success and file-fallback-on-failure.

**Acceptance:** valid lead → row in `landing_leads` (prod) or JSONL (no DB); server endpoint returns 201/400/503 correctly; landing never throws to the user on a transient API failure.

## 8. Config / env

Add `apps/landing/.env.example` (new) and document in the root `.env.example` (new "Landing" block):

```
# Landing — launch link into the live SPA (client-exposed)
NEXT_PUBLIC_APP_URL=https://app.oggregator.xyz
# Landing — core API base for ISR market data + server-to-server lead forwarding (server-only)
LANDING_API_BASE_URL=https://api.oggregator.xyz
# Landing — fallback lead sink when the API is unreachable / no DB (unchanged)
LANDING_LEADS_FILE=
```

`apps/landing/package.json` gains the `@oggregator/protocol` workspace dependency (the `vercel.json` prebuild already builds it).

## 9. Error handling & fallbacks

| Failure | Behavior |
|---|---|
| API down during ISR revalidate | `getMarketSnapshot()` returns `demo-data.ts`; last good page stays served; build unaffected |
| Slow API | `AbortSignal.timeout(2500)` → fallback |
| Lead API non-2xx / unreachable | Local JSONL append fallback; user still sees success |
| Server has no `DATABASE_URL` | `POST /api/leads` → 503; landing falls back to file (local dev / pre-migrate) |

## 10. Testing strategy

- **protocol**: `leads.test.ts` (schema accept/reject).
- **db**: `leads-store.test.ts` mirroring `users-store.test.ts`.
- **server**: `routes/leads.test.ts` (201 / 400 / 503-no-DB).
- **landing**: `lib/api.test.ts` (mock fetch → parse+map; error → demo fallback), `lib/market-snapshot.test.ts`, updated `app/api/leads/route.test.ts`, header launch-href assertion. Existing landing component tests stay green (landing's vitest has jsdom + `@testing-library/jest-dom`).
- **Gates (in order):** `pnpm --filter @oggregator/protocol build` (web/landing resolve protocol's built dist) → `pnpm typecheck` → `pnpm test`.

## 11. Constraints honored

- **No WS / no new sockets** — REST + ISR only (`feedback_ws_layer_read_only_consumer`).
- **Protect existing functionality** — `demo-data.ts` preserved as fallback; CTA additive; server route additive + Noop-safe; web SPA & WS untouched; no unrelated cleanups (`feedback_protect_existing_functionality`).
- **Ground in existing patterns** — leads store mirrors `users`/`funded` stores; route mirrors `stats`/paper routes; protocol-as-contract per server docs; ISR is standard Next App Router (`feedback_ground_recommendations_in_existing_patterns`).
- **No worktrees** — contained feature work on the main checkout (`feedback_no_worktrees_for_contained_work`).

## 12. Ops follow-ups (not code — flagged like funded 0015/0016)

1. Run `pnpm db:migrate` (applies `0017`) on Scaleway before `POST /api/leads` works in prod.
2. Set `LANDING_API_BASE_URL` + `NEXT_PUBLIC_APP_URL` in the landing's Vercel project.
3. Redeploy the Scaleway server for the new `/api/leads` route.

Note: per project memory, env/file edits auto-commit-and-push to `main`, so code lands on prod `main` immediately — but the **server redeploy and migration are still manual**.

## 13. File manifest

**New:**
- `apps/landing/lib/links.ts`
- `apps/landing/lib/api.ts`
- `apps/landing/lib/market-snapshot.ts`
- `apps/landing/lib/api.test.ts`, `apps/landing/lib/market-snapshot.test.ts`
- `apps/landing/.env.example`
- `packages/protocol/src/leads.ts`, `packages/protocol/src/leads.test.ts`
- `packages/db/migrations/0017_create_landing_leads.sql`
- `packages/db/src/leads-store.ts`, `packages/db/src/leads-store.test.ts`
- `packages/server/src/routes/leads.ts`, `packages/server/src/routes/leads.test.ts`

**Modified:**
- `apps/landing/components/LandingHeader.tsx`, `components/HeroTerminalSection.tsx`
- `apps/landing/lib/copy.ts`, `lib/lead-schema.ts`, `lib/lead-store.ts`
- `apps/landing/app/page.tsx` (fetch snapshot, pass props), relevant section components to accept props (`TopTicker`, `VenueStrip`, market-context, then surface/chain in B2)
- `apps/landing/app/api/leads/route.test.ts`
- `apps/landing/package.json` (+`@oggregator/protocol`)
- `packages/protocol/src/index.ts`
- `packages/db/src/index.ts`
- `packages/server/src/services.ts`, `packages/server/src/routes/index.ts`
- root `.env.example`

## 14. Open questions

None blocking. Plan-level detail to resolve during implementation: exact field mapping for B2 (surface grid → `LandingSurfacePlot` input; nearest-expiry selection for `terminalRows`). These do not change the architecture.
