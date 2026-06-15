# System Status & Announcements — Design

**Date:** 2026-05-24
**Status:** Approved (design); pending implementation plan
**Scope:** Workstream ① of "formalize the app". Onboarding/intros/tutorials (workstream ②) is a **separate later spec**.

## 1. Goal

Give the app a professional, on-theme way to communicate operational status to users:

- **Under construction** — a feature or the whole site is WIP.
- **Maintenance** — scheduled (future, with countdown) or active (now).
- **WebSocket / feed issues** — the live data feed is degraded, disconnected, or recovered.

The look continues the existing terminal aesthetic (IBM Plex Mono, `#0a0a0a` base, teal accent, semantic color tokens) with **minimal, clean motion** (slide + fade, ~200ms).

## 2. Decisions locked during brainstorming

| # | Decision | Choice |
|---|---|---|
| Source | Where operator flags come from | **Backend status endpoint** (extend existing `/api/health`) |
| Surface | How status renders | **Hybrid**: persistent banner for *states*, corner toast for *events*, full-screen takeover for hard blocks |
| Severity | How forceful maintenance/construction is | **Operator decides per announcement** via `severity` + `blocking` flag |
| Motion | Animation character | **Minimal & clean** (no CRT/typewriter), with `prefers-reduced-motion` fallback |

## 3. Load-bearing constraint — DO NOT TOUCH THE WS LAYER

The WebSocket transport was recently stabilized (subscription-coordinator isolation, Binance stale-ack fix) and is **fragile**. This feature is strictly a **read-only consumer** of WS state:

- It reads the `feedStatus` slice in `app-store` that `useGlobalFeedStatus` / `useChainWs` already populate. It writes **nothing** back.
- It opens **no** new WS connections and changes **no** subscription, planner, coordinator, health, or transport code.
- **Must not modify:** `useChainWs.ts`, `ws-chain.ts`, `chain-stream-session.ts`, `venue-subscriptions.ts`, `feed-health.ts`, `venue-health.ts`, planner/state/health in `@oggregator/core`, or any venue adapter.
- The only existing client code touched is `useServerVersion.ts` (a **REST** `/health` poller — not WS), extended additively. Its current `server-updated` behavior is preserved unchanged.
- The only existing server code touched is `routes/health.ts` (additive field) — the new status read must be cached and non-throwing so it can never add latency or failure to the health route.

Any task that appears to require a WS-layer change is out of scope and must stop and surface the conflict.

## 4. Architecture & data flow

```
Operator edits status.json on the box
        │
        ▼
Fastify  GET /api/health  ──(adds optional "announcement" field)──┐
        │  (existing 30s poll, unchanged cadence)                 │
        ▼                                                         ▼
web: useServerVersion (extended) ──► app-store.announcement ──► <SystemNotifications/>
                                                                  ├─ StatusBanner    (non-blocking announcement / degraded feed)
web: feedStatus (already tracked) ──► useFeedToasts ───────────► ├─ StatusTakeover  (blocking announcement / outage)
                                                                  └─ ToastStack      (transient events)
```

- **Operator announcements** flow from `status.json` → `/api/health` → existing poll → store → banner/takeover.
- **WS issues** are derived entirely client-side from `feedStatus`. They are independent of the backend, so an API outage still surfaces (as a degraded feed banner) without any server cooperation.

## 5. Data contract — shared via `@oggregator/protocol`

Protocol package is the contract source of truth. Add a Zod schema + inferred type there; the server validates `status.json` against it, the web parses the `/health` response against it.

```ts
interface SystemAnnouncement {
  id: string;                                   // dismissal key; bump to re-show a changed message
  severity: 'info' | 'notice' | 'degraded' | 'outage';
  blocking: boolean;                            // false → banner; true → full-screen takeover
  title: string;
  message?: string;
  startsAt?: number;                            // epoch ms; before this → render as scheduled w/ countdown
  endsAt?: number;                              // epoch ms; auto-clear after this
  dismissible?: boolean;                        // default: true for info|notice, false for degraded|outage
}
```

`severity` drives tone/color; `blocking` drives surface (banner vs takeover). Both are independent so e.g. a `notice` can block, or a `degraded` can stay a banner.

## 6. Severity → surface → token mapping

| Severity | Default surface | Color token | Default dismissible |
|---|---|---|---|
| `info` | banner (or takeover if `blocking`) | `--color-info` `#88b6ff` | yes |
| `notice` | banner (or takeover if `blocking`) | `--color-warning` `#fef9a0` | yes |
| `degraded` | sticky banner (or takeover if `blocking`) | `--color-loss` `#cb3855` | no |
| `outage` | takeover | `--color-loss` `#cb3855` | no |

## 7. Components — new `packages/web/src/components/notifications/`

Grouped as app-shell chrome (peer to existing `SessionNotice` / `VenueStatusRow`), each with its own `.module.css`.

| Component | Role |
|---|---|
| `StatusBanner.tsx` | Full-width strip under TopBar in `AppShell`. Renders non-blocking announcement (countdown when `startsAt` is future) and the degraded-feed banner. Dismiss `✕` when dismissible. |
| `StatusTakeover.tsx` | Full-screen blocking overlay for `blocking` announcements / `outage`. Reuses the `SessionNotice` backdrop/panel pattern and `role="dialog" aria-modal`. |
| `ToastStack.tsx` + `ToastItem` | Bottom-right stack of transient event cards; auto-dismiss ~4s; manual `✕`. |
| `index.ts` → `<SystemNotifications/>` | Single composed mount (banner + takeover + toasts). Added **once** in `AppShell`. Also exports the two hooks. |

**Motion:** slide-down (banner), slide-in-from-right (toast), fade (takeover), all ~200ms via `--transition-base`. Under `@media (prefers-reduced-motion: reduce)`, drop transforms — opacity-only / instant.

**Mount point:** `AppShell.tsx` renders `<SystemNotifications/>` once. The banner slot sits directly under `TopBar`; takeover and toasts are fixed-position overlays.

## 8. Client state — `app-store` (UI state, alongside `feedStatus` / `sessionNotice`)

- `announcement: SystemAnnouncement | null` + `setAnnouncement(a)`
- `toasts: ToastItem[]` + `pushToast(t)` / `dismissToast(id)`
- **Dismissal memory:** dismissed announcement `id`s persisted in `localStorage` (via the existing `readStorage` helper pattern). A dismissed banner stays gone until its `id` changes **or** severity escalates to `degraded`/`outage` (those always re-show).

`ToastItem` shape: `{ id: string; tone: 'info' | 'success' | 'warning'; icon: string; text: string; createdAt: number }`.

## 9. WS-issue behavior (client-side, reads `feedStatus` only)

A new `useFeedToasts` hook subscribes to `feedStatus` and derives events. Exact state names come from `WsConnectionState` in `@oggregator/protocol`; observed values include `live`, `reconnecting`, `stale`, `closed`, `error`.

- **Per-venue** down/up → **dots only** (existing `VenueStatusRow`; no toast — avoids spam).
- **Socket reconnecting**, or **all active venues failed** → **toast** "Reconnecting to feed…" (`warning`).
- **Disconnected/stale > 8s** (debounce to ignore brief blips) → **degraded sticky banner** "Live feed disconnected — retrying" (rendered by `StatusBanner`, severity `degraded`).
- **Recovery** (`connectionState` returns to `live`) → **toast** "Feed restored" (`success`) + degraded banner clears.

Backend announcements and the degraded-feed banner can coexist; if both want the banner slot, the higher severity wins (outage > degraded > notice > info).

## 10. Backend — `packages/server/`

- **New** `src/system-status.ts`: reads `STATUS_FILE` (env path), validates against the protocol schema, caches result ~5s (or `fs.watch`-refreshed). Returns `SystemAnnouncement | null`. **Never throws** — invalid/missing file → `null` + a single `log.warn`.
- **Edit** `src/routes/health.ts`: add `announcement: getSystemAnnouncement()` to the response object. No other change; `/ready` untouched.

## 11. Operator workflow

Edit `status.json` on the box (path = `$STATUS_FILE`). Example:

```json
{
  "id": "maint-2026-05-25",
  "severity": "info",
  "blocking": false,
  "title": "Scheduled maintenance",
  "message": "Feeds may briefly drop while we redeploy.",
  "startsAt": 1748150400000,
  "endsAt": 1748154000000
}
```

Empty file / `null` / invalid → no announcement. Clients pick up the change within one poll (≤30s). No restart, no SPA redeploy.

## 12. Error handling

- **Health fetch fails (API down):** existing poller already swallows errors; no announcement is shown, but the client-side degraded-feed banner surfaces the outage independently. (We deliberately did **not** add a static fallback — source was chosen as plain backend endpoint.)
- **Invalid `status.json`:** server returns `null`, logs once; health route stays 200.
- **Clock skew / past `endsAt`:** countdown computed client-side from `startsAt`/`endsAt`, clamped to ≥0; an announcement past `endsAt` is treated as cleared client-side even before the next poll.

## 13. Testing (Vitest + Testing Library — matches existing `*.test.tsx`)

**Server**
- `system-status` provider: valid file, invalid JSON, missing file, schema-invalid payload, cache TTL behavior.
- `health` route: response includes `announcement` when file present, omits/nulls it otherwise; never throws on bad file.

**Web**
- `StatusBanner`: renders per severity + correct token; countdown formats from `startsAt`; dismiss hides it and persists by `id`; re-shows on `id` change and on escalation to `degraded`/`outage`.
- `StatusTakeover`: renders when `blocking`/`outage`; blocks interaction; `aria-modal`.
- `useFeedToasts`: `feedStatus` transitions → correct toasts; 8s degraded threshold with blip debounce; recovery clears banner + emits restored toast; per-venue changes emit no toast.
- `prefers-reduced-motion`: transform animations disabled.

## 14. File-change summary

**New**
- `packages/protocol/…` — `SystemAnnouncement` Zod schema + type (export from protocol index).
- `packages/server/src/system-status.ts`
- `packages/web/src/components/notifications/{StatusBanner,StatusTakeover,ToastStack}.tsx` (+ `.module.css`), `index.ts`
- `packages/web/src/hooks/useFeedToasts.ts`
- Tests alongside each.

**Edited (additive / minimal)**
- `packages/server/src/routes/health.ts` — add `announcement` field.
- `packages/web/src/hooks/useServerVersion.ts` — also read `announcement` from the health body (preserve existing `server-updated` behavior).
- `packages/web/src/stores/app-store.ts` — add `announcement` + `toasts` slices.
- `packages/web/src/components/layout/AppShell.tsx` — mount `<SystemNotifications/>`.

**Explicitly NOT touched:** any WS transport / subscription / health code (see §3).

## 15. Out of scope (YAGNI)

- Onboarding / intros / tutorials (workstream ②, separate spec).
- Admin UI for editing announcements (operator edits the file).
- Static "API-down" fallback message (covered by client-side feed banner).
- Per-feature/per-route construction flags (single global announcement for now).
