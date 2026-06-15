# System Status & Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a professional, on-theme way to tell users about operator status (under-construction, maintenance) and live-feed health (reconnecting/degraded/restored), via a banner + toast + takeover surface.

**Architecture:** Operator edits a `status.json` file on the box; the existing `/api/health` poll (`useServerVersion`) carries it to the client and into the `app-store`. WS-issue events are derived **read-only** from the `feedStatus` store slice — no transport code is touched. A pure `selectActiveNotice` function decides which surface (takeover/banner) renders; toasts are a separate store-driven stack.

**Tech Stack:** Zod 4 (protocol contract), Fastify (server `/health`), React 19 + Zustand 5 + CSS Modules (web), Vitest 4 + Testing Library (tests).

**Branch:** `feat/system-status-announcements` (already checked out).

---

## CRITICAL CONSTRAINT — do not touch the WS layer

The WebSocket transport was just stabilized and is fragile. This feature is a **read-only consumer** of WS state. **You must not modify** any of: `useChainWs.ts`, `ws-chain.ts`, `chain-stream-session.ts`, `venue-subscriptions.ts`, `feed-health.ts`, `venue-health.ts`, planner/state/health in `@oggregator/core`, or any venue adapter. The only "feed" input allowed is **reading** `useAppStore(s => s.feedStatus)`. The final task verifies no WS file changed.

## File structure

**Protocol (`packages/protocol/`)**
- Create `src/system-status.ts` — `SystemAnnouncementSchema` + types (single source of truth for the contract).
- Modify `src/index.ts` — export the new schema/types.
- Create `src/system-status.test.ts`.

**Server (`packages/server/`)**
- Create `src/system-status.ts` — `getSystemAnnouncement()`: reads+validates `STATUS_FILE`, 5s cache, never throws.
- Create `src/system-status.test.ts`.
- Modify `src/routes/health.ts` — add `announcement` field (one line).
- Modify `src/routes/health.test.ts` — mock provider + assert field.

**Web (`packages/web/`)**
- Create `src/lib/system-status.ts` — pure helpers: `parseAnnouncement`, dismissal storage, `selectActiveNotice`, icons.
- Create `src/lib/system-status.test.ts`.
- Modify `src/stores/app-store.ts` — add `announcement` / `feedDegraded` / `toasts` slices + actions.
- Modify `src/stores/app-store.test.ts` — cover new actions.
- Modify `src/hooks/useServerVersion.ts` — also surface `announcement` (REST poll; not WS).
- Create `src/hooks/useServerVersion.test.tsx`.
- Create `src/hooks/useFeedToasts.ts` — read-only `feedStatus` → toasts + degraded flag.
- Create `src/hooks/useFeedToasts.test.tsx`.
- Create `src/components/notifications/{ToastStack,StatusBanner,StatusTakeover,SystemNotifications}.tsx` (+ `.module.css`) and `index.ts`.
- Create their `.test.tsx` files.
- Modify `src/components/layout/AppShell.tsx` — mount `<SystemNotifications/>` once under `<TopBar/>`.
- Modify `.env.example` (repo root) — document `STATUS_FILE`.

---

## Task 1: Protocol — `SystemAnnouncement` contract

**Files:**
- Create: `packages/protocol/src/system-status.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/system-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/system-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SystemAnnouncementSchema } from './system-status.js';

describe('SystemAnnouncementSchema', () => {
  it('parses a minimal valid announcement and defaults blocking to false', () => {
    const r = SystemAnnouncementSchema.safeParse({ id: 'm1', severity: 'info', title: 'Hi' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.blocking).toBe(false);
  });

  it('keeps an explicit blocking flag and optional fields', () => {
    const r = SystemAnnouncementSchema.safeParse({
      id: 'm2', severity: 'outage', blocking: true, title: 'Down', message: 'brb',
      startsAt: 1_700_000_000_000, endsAt: 1_700_003_600_000,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ blocking: true, message: 'brb' });
  });

  it('rejects an unknown severity', () => {
    expect(SystemAnnouncementSchema.safeParse({ id: 'm1', severity: 'boom', title: 'x' }).success).toBe(false);
  });

  it('rejects a missing title', () => {
    expect(SystemAnnouncementSchema.safeParse({ id: 'm1', severity: 'info' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/protocol test:run system-status`
Expected: FAIL — cannot resolve `./system-status.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/protocol/src/system-status.ts`:

```ts
import { z } from 'zod';

export const SystemAnnouncementSeveritySchema = z.enum(['info', 'notice', 'degraded', 'outage']);
export type SystemAnnouncementSeverity = z.infer<typeof SystemAnnouncementSeveritySchema>;

/** Operator-authored status flag served by GET /api/health. */
export const SystemAnnouncementSchema = z.object({
  id: z.string().min(1),
  severity: SystemAnnouncementSeveritySchema,
  blocking: z.boolean().default(false),
  title: z.string().min(1),
  message: z.string().optional(),
  startsAt: z.number().int().positive().optional(),
  endsAt: z.number().int().positive().optional(),
  dismissible: z.boolean().optional(),
});

export type SystemAnnouncement = z.infer<typeof SystemAnnouncementSchema>;
```

- [ ] **Step 4: Export from the barrel**

In `packages/protocol/src/index.ts`, add (near the other `export { ... } from './ws.js';` blocks):

```ts
export {
  SystemAnnouncementSchema,
  SystemAnnouncementSeveritySchema,
  type SystemAnnouncement,
  type SystemAnnouncementSeverity,
} from './system-status.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @oggregator/protocol test:run system-status`
Expected: PASS (4 tests).

- [ ] **Step 6: Build protocol so downstream packages see the new export**

Run: `pnpm --filter @oggregator/protocol build`
Expected: tsc completes with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/system-status.ts packages/protocol/src/system-status.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add SystemAnnouncement schema"
```

---

## Task 2: Server — status file provider

**Files:**
- Create: `packages/server/src/system-status.ts`
- Test: `packages/server/src/system-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/system-status.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSystemAnnouncement, __resetSystemStatusCache } from './system-status.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ogg-status-'));
  file = join(dir, 'status.json');
  process.env['STATUS_FILE'] = file;
  __resetSystemStatusCache();
});

afterEach(() => {
  delete process.env['STATUS_FILE'];
  rmSync(dir, { recursive: true, force: true });
});

describe('getSystemAnnouncement', () => {
  it('returns null when STATUS_FILE is unset', () => {
    delete process.env['STATUS_FILE'];
    __resetSystemStatusCache();
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('returns null when the file is missing', () => {
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('parses a valid announcement', () => {
    writeFileSync(file, JSON.stringify({ id: 'm1', severity: 'info', title: 'Maintenance soon' }));
    expect(getSystemAnnouncement()).toMatchObject({ id: 'm1', severity: 'info', blocking: false });
  });

  it('returns null for invalid JSON', () => {
    writeFileSync(file, '{ not json');
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('returns null for schema-invalid payloads', () => {
    writeFileSync(file, JSON.stringify({ id: 'm1', severity: 'boom', title: 'x' }));
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('caches within the TTL window then refreshes', () => {
    writeFileSync(file, JSON.stringify({ id: 'a', severity: 'info', title: 'A' }));
    const t = Date.now();
    expect(getSystemAnnouncement(t)?.id).toBe('a');
    writeFileSync(file, JSON.stringify({ id: 'b', severity: 'info', title: 'B' }));
    expect(getSystemAnnouncement(t + 1_000)?.id).toBe('a'); // still cached
    expect(getSystemAnnouncement(t + 6_000)?.id).toBe('b'); // TTL expired
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/server test:run system-status`
Expected: FAIL — cannot resolve `./system-status.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/src/system-status.ts`:

```ts
import { readFileSync } from 'node:fs';
import { SystemAnnouncementSchema, type SystemAnnouncement } from '@oggregator/protocol';

const CACHE_TTL_MS = 5_000;

let cache: { value: SystemAnnouncement | null; at: number } | null = null;

/**
 * Operator-controlled status flag. Reads + validates the JSON file at
 * $STATUS_FILE, cached for 5s so /health stays cheap. Never throws — a
 * missing/invalid file means "no announcement".
 */
export function getSystemAnnouncement(now: number = Date.now()): SystemAnnouncement | null {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value = readStatusFile();
  cache = { value, at: now };
  return value;
}

function readStatusFile(): SystemAnnouncement | null {
  const path = process.env['STATUS_FILE'];
  if (!path) return null;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null; // missing / unreadable → no announcement
  }

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.warn('[system-status] STATUS_FILE is not valid JSON; ignoring');
    return null;
  }

  const result = SystemAnnouncementSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[system-status] STATUS_FILE failed schema validation; ignoring');
    return null;
  }
  return result.data;
}

/** Test-only: clear the in-memory cache. */
export function __resetSystemStatusCache(): void {
  cache = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/server test:run system-status`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/system-status.ts packages/server/src/system-status.test.ts
git commit -m "feat(server): add status.json provider for /health"
```

---

## Task 3: Server — surface the announcement on `/health`

**Files:**
- Modify: `packages/server/src/routes/health.ts`
- Test: `packages/server/src/routes/health.test.ts`

- [ ] **Step 1: Add the failing test**

In `packages/server/src/routes/health.test.ts`, add this mock at the top alongside the existing `vi.mock(...)` calls (after the `vi.mock('../services.js', ...)` block):

```ts
vi.mock('../system-status.js', () => ({
  getSystemAnnouncement: vi.fn(() => null),
}));
```

Add this import alongside the existing imports (after `import * as services from '../services.js';`):

```ts
import * as systemStatus from '../system-status.js';
```

Add these tests inside the `describe('GET /health', ...)` block:

```ts
it('returns a null announcement when none is set', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json().announcement).toBeNull();
});

it('includes the system announcement when present', async () => {
  vi.mocked(systemStatus.getSystemAnnouncement).mockReturnValueOnce({
    id: 'm1', severity: 'notice', blocking: false, title: 'Under construction',
  });
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json().announcement).toMatchObject({ id: 'm1', severity: 'notice' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/server test:run routes/health`
Expected: FAIL — `announcement` is `undefined`, not `null`.

- [ ] **Step 3: Write minimal implementation**

In `packages/server/src/routes/health.ts`, add the import after the existing imports:

```ts
import { getSystemAnnouncement } from '../system-status.js';
```

Then in the `/health` handler's returned object, add the `announcement` line between `version` and `ts`:

```ts
      bootTime: SERVER_BOOT_TIME,
      version: SERVER_VERSION,
      announcement: getSystemAnnouncement(),
      ts: Date.now(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/server test:run routes/health`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/health.ts packages/server/src/routes/health.test.ts
git commit -m "feat(server): expose system announcement on /api/health"
```

---

## Task 4: Web — pure client helpers (parse, dismissal, selection)

**Files:**
- Create: `packages/web/src/lib/system-status.ts`
- Test: `packages/web/src/lib/system-status.test.ts`

This is the decision brain — it stays pure so it is fully unit-tested without rendering.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/system-status.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseAnnouncement,
  loadDismissedIds,
  addDismissedId,
  selectActiveNotice,
} from './system-status';
import type { SystemAnnouncement } from '@oggregator/protocol';

const base: SystemAnnouncement = { id: 'a1', severity: 'info', blocking: false, title: 'Hi' };
const NOW = 1_700_000_000_000;

describe('parseAnnouncement', () => {
  it('returns null for null/garbage', () => {
    expect(parseAnnouncement(null)).toBeNull();
    expect(parseAnnouncement({ nope: true })).toBeNull();
  });
  it('parses a valid payload', () => {
    expect(parseAnnouncement({ id: 'a1', severity: 'info', title: 'Hi' })).toMatchObject({ id: 'a1' });
  });
});

describe('dismissal storage', () => {
  beforeEach(() => localStorage.clear());
  it('persists and reloads dismissed ids', () => {
    expect(loadDismissedIds()).toEqual([]);
    addDismissedId('a1');
    expect(loadDismissedIds()).toContain('a1');
  });
});

describe('selectActiveNotice', () => {
  it('returns null when nothing is active', () => {
    expect(selectActiveNotice(null, false, [], NOW)).toEqual({ surface: null, notice: null });
  });

  it('renders a non-blocking announcement as a banner', () => {
    const sel = selectActiveNotice(base, false, [], NOW);
    expect(sel.surface).toBe('banner');
    expect(sel.notice).toMatchObject({ id: 'a1', dismissible: true });
  });

  it('renders a blocking announcement as a takeover', () => {
    const sel = selectActiveNotice({ ...base, blocking: true }, false, [], NOW);
    expect(sel.surface).toBe('takeover');
  });

  it('hides a dismissed info banner but keeps degraded/outage', () => {
    expect(selectActiveNotice(base, false, ['a1'], NOW).surface).toBeNull();
    const degraded: SystemAnnouncement = { ...base, severity: 'degraded' };
    expect(selectActiveNotice(degraded, false, ['a1'], NOW).surface).toBe('banner');
  });

  it('treats an announcement past endsAt as expired', () => {
    const ended: SystemAnnouncement = { ...base, endsAt: NOW - 1 };
    expect(selectActiveNotice(ended, false, [], NOW).surface).toBeNull();
  });

  it('shows the synthesized feed-degraded banner', () => {
    const sel = selectActiveNotice(null, true, [], NOW);
    expect(sel.surface).toBe('banner');
    expect(sel.notice).toMatchObject({ id: null, severity: 'degraded' });
  });

  it('takeover beats a degraded feed banner', () => {
    const sel = selectActiveNotice({ ...base, blocking: true, severity: 'outage' }, true, [], NOW);
    expect(sel.surface).toBe('takeover');
  });

  it('higher severity wins among banners', () => {
    const sel = selectActiveNotice({ ...base, severity: 'info' }, true, [], NOW);
    expect(sel.notice?.severity).toBe('degraded'); // feed degraded outranks info
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run lib/system-status`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/system-status.ts`:

```ts
import {
  SystemAnnouncementSchema,
  type SystemAnnouncement,
  type SystemAnnouncementSeverity,
} from '@oggregator/protocol';

const DISMISSED_KEY = 'systemAnnouncementDismissed';

export const SEVERITY_ICON: Record<SystemAnnouncementSeverity, string> = {
  info: 'ℹ',
  notice: '⚠',
  degraded: '◍',
  outage: '⛔',
};

const SEVERITY_RANK: Record<SystemAnnouncementSeverity, number> = {
  info: 1,
  notice: 2,
  degraded: 3,
  outage: 4,
};

/** Severities that re-show even after the user dismissed an earlier id. */
const ALWAYS_SHOW: ReadonlySet<SystemAnnouncementSeverity> = new Set(['degraded', 'outage']);

export function parseAnnouncement(raw: unknown): SystemAnnouncement | null {
  if (raw == null) return null;
  const result = SystemAnnouncementSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function loadDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addDismissedId(id: string): string[] {
  const next = Array.from(new Set([...loadDismissedIds(), id]));
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / unavailable storage */
  }
  return next;
}

export interface ActiveNotice {
  /** announcement id, or null for the synthesized feed-degraded notice. */
  id: string | null;
  severity: SystemAnnouncementSeverity;
  title: string;
  message?: string;
  startsAt?: number;
  endsAt?: number;
  dismissible: boolean;
}

export interface NoticeSelection {
  surface: 'takeover' | 'banner' | null;
  notice: ActiveNotice | null;
}

const FEED_DEGRADED_NOTICE: ActiveNotice = {
  id: null,
  severity: 'degraded',
  title: 'Live feed disconnected',
  message: 'Reconnecting to market data…',
  dismissible: false,
};

/** Pure decision: which surface (if any) to render right now. */
export function selectActiveNotice(
  announcement: SystemAnnouncement | null,
  feedDegraded: boolean,
  dismissedIds: readonly string[],
  now: number,
): NoticeSelection {
  const candidates: Array<{ surface: 'takeover' | 'banner'; notice: ActiveNotice }> = [];

  if (announcement) {
    const expired = announcement.endsAt != null && announcement.endsAt <= now;
    const dismissed =
      dismissedIds.includes(announcement.id) && !ALWAYS_SHOW.has(announcement.severity);
    if (!expired && !dismissed) {
      const dismissible = announcement.dismissible ?? !ALWAYS_SHOW.has(announcement.severity);
      candidates.push({
        surface: announcement.blocking ? 'takeover' : 'banner',
        notice: {
          id: announcement.id,
          severity: announcement.severity,
          title: announcement.title,
          message: announcement.message,
          startsAt: announcement.startsAt,
          endsAt: announcement.endsAt,
          dismissible,
        },
      });
    }
  }

  if (feedDegraded) {
    candidates.push({ surface: 'banner', notice: FEED_DEGRADED_NOTICE });
  }

  if (candidates.length === 0) return { surface: null, notice: null };

  const takeover = candidates.find((c) => c.surface === 'takeover');
  if (takeover) return takeover;

  return candidates.reduce((a, b) =>
    SEVERITY_RANK[b.notice.severity] > SEVERITY_RANK[a.notice.severity] ? b : a,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run lib/system-status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/system-status.ts packages/web/src/lib/system-status.test.ts
git commit -m "feat(web): add system-status client helpers + notice selection"
```

---

## Task 5: Web — app-store slices (`announcement`, `feedDegraded`, `toasts`)

**Files:**
- Modify: `packages/web/src/stores/app-store.ts`
- Test: `packages/web/src/stores/app-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/web/src/stores/app-store.test.ts` (keep existing tests; add a new `describe`). Match the existing import style at the top of that file — it already imports `useAppStore`.

```ts
describe('system notification slices', () => {
  beforeEach(() => {
    useAppStore.setState({ announcement: null, feedDegraded: false, toasts: [] });
  });

  it('sets and clears the announcement', () => {
    useAppStore.getState().setAnnouncement({ id: 'm1', severity: 'info', blocking: false, title: 'Hi' });
    expect(useAppStore.getState().announcement).toMatchObject({ id: 'm1' });
    useAppStore.getState().setAnnouncement(null);
    expect(useAppStore.getState().announcement).toBeNull();
  });

  it('toggles feedDegraded', () => {
    useAppStore.getState().setFeedDegraded(true);
    expect(useAppStore.getState().feedDegraded).toBe(true);
  });

  it('pushes and dismisses toasts', () => {
    useAppStore.getState().pushToast({ tone: 'success', icon: '✓', text: 'Feed restored' });
    const toasts = useAppStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: 'success', text: 'Feed restored' });
    useAppStore.getState().dismissToast(toasts[0]!.id);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });
});
```

If `app-store.test.ts` does not already import `describe, it, expect, beforeEach`, ensure they are imported from `vitest` at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run stores/app-store`
Expected: FAIL — `setAnnouncement`/`pushToast` are not functions.

- [ ] **Step 3: Write minimal implementation**

In `packages/web/src/stores/app-store.ts`:

(a) Add to the `@oggregator/protocol` import list a value/type import for the announcement type:

```ts
  type SystemAnnouncement,
```

(b) Add the `Toast` types near the `FeedStatus`/`SessionNotice` interface declarations:

```ts
export type ToastTone = 'info' | 'success' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  icon: string;
  text: string;
  createdAt: number;
}

export interface ToastInput {
  tone: ToastTone;
  icon: string;
  text: string;
  id?: string;
}
```

(c) Add fields to the `AppState` interface (alongside `sessionNotice`):

```ts
  announcement: SystemAnnouncement | null;
  feedDegraded: boolean;
  toasts: Toast[];
```

and the actions (alongside `setSessionNotice`):

```ts
  setAnnouncement: (a: SystemAnnouncement | null) => void;
  setFeedDegraded: (degraded: boolean) => void;
  pushToast: (toast: ToastInput) => void;
  dismissToast: (id: string) => void;
```

(d) Add initial values inside `create(...)` (alongside `sessionNotice: null,`):

```ts
  announcement: null,
  feedDegraded: false,
  toasts: [],
```

(e) Add action implementations (alongside `setSessionNotice: ...`):

```ts
  setAnnouncement: (announcement) => set({ announcement }),
  setFeedDegraded: (feedDegraded) => set({ feedDegraded }),
  pushToast: (toast) =>
    set((prev) => ({
      toasts: [
        ...prev.toasts,
        {
          id: toast.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tone: toast.tone,
          icon: toast.icon,
          text: toast.text,
          createdAt: Date.now(),
        },
      ],
    })),
  dismissToast: (id) => set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run stores/app-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/app-store.ts packages/web/src/stores/app-store.test.ts
git commit -m "feat(web): add announcement/feedDegraded/toasts store slices"
```

---

## Task 6: Web — extend `useServerVersion` to surface the announcement

This touches a **REST** poller only (not WS). Preserve the existing `server-updated` behavior exactly.

**Files:**
- Modify: `packages/web/src/hooks/useServerVersion.ts`
- Test: `packages/web/src/hooks/useServerVersion.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/hooks/useServerVersion.test.tsx`:

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import { useServerVersion } from './useServerVersion';

beforeEach(() => {
  useAppStore.setState({ announcement: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useServerVersion', () => {
  it('writes the announcement from /health into the store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bootTime: 1,
          announcement: { id: 'm1', severity: 'info', title: 'Hi' },
        }),
      }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().announcement).toMatchObject({ id: 'm1', severity: 'info' });
    });
    unmount();
  });

  it('clears the announcement when /health has none', async () => {
    useAppStore.setState({ announcement: { id: 'old', severity: 'info', blocking: false, title: 'Old' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bootTime: 1 }) }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().announcement).toBeNull();
    });
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run hooks/useServerVersion`
Expected: FAIL — announcement stays unchanged (hook doesn't set it yet).

- [ ] **Step 3: Write minimal implementation**

In `packages/web/src/hooks/useServerVersion.ts`:

(a) Add the import after the existing imports:

```ts
import { parseAnnouncement } from '@lib/system-status';
```

(b) Add `announcement` to the `HealthResponse` interface:

```ts
interface HealthResponse {
  bootTime?: number;
  version?: string;
  announcement?: unknown;
}
```

(c) Read the setter inside the hook (alongside the existing `setSessionNotice` line):

```ts
  const setAnnouncement = useAppStore((s) => s.setAnnouncement);
```

(d) Inside the `poll` function, right after the existing `bootTime` handling block (still inside `if (cancelled) return;` scope, after the `if (typeof body.bootTime === 'number') { ... }` block), add:

```ts
        setAnnouncement(parseAnnouncement(body.announcement));
```

(e) Add `setAnnouncement` to the effect dependency array:

```ts
  }, [setSessionNotice, currentNoticeKind, setAnnouncement]);
```

Note: the existing `catch {}` stays untouched — on a failed poll we deliberately leave the last announcement in place rather than clearing it on a transient network error.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run hooks/useServerVersion`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useServerVersion.ts packages/web/src/hooks/useServerVersion.test.tsx
git commit -m "feat(web): surface system announcement from the /health poll"
```

---

## Task 7: Web — `ToastStack` component

**Files:**
- Create: `packages/web/src/components/notifications/ToastStack.tsx`
- Create: `packages/web/src/components/notifications/ToastStack.module.css`
- Test: `packages/web/src/components/notifications/ToastStack.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/notifications/ToastStack.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import ToastStack from './ToastStack';

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastStack />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a toast and auto-dismisses it after 4s', () => {
    act(() => {
      useAppStore.getState().pushToast({ id: 't1', tone: 'success', icon: '✓', text: 'Feed restored' });
    });
    render(<ToastStack />);
    expect(screen.getByText('Feed restored')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run components/notifications/ToastStack`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/notifications/ToastStack.tsx`:

```tsx
import { useEffect } from 'react';

import { useAppStore, type Toast } from '@stores/app-store';

import styles from './ToastStack.module.css';

const AUTO_DISMISS_MS = 4000;

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className={styles.toast} data-tone={toast.tone} role="status">
      <span className={styles.icon} aria-hidden>
        {toast.icon}
      </span>
      <span className={styles.text}>{toast.text}</span>
      <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        ✕
      </button>
    </div>
  );
}

export default function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
```

Create `packages/web/src/components/notifications/ToastStack.module.css`:

```css
.stack {
  position: fixed;
  right: var(--space-4);
  bottom: calc(var(--space-4) + var(--safe-bottom));
  z-index: 900;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 360px;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-left: 2px solid var(--text-tertiary);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  animation: toastIn var(--transition-base);
}

.toast[data-tone='success'] { border-left-color: var(--color-profit); }
.toast[data-tone='success'] .icon { color: var(--color-profit); }
.toast[data-tone='warning'] { border-left-color: var(--color-warning); }
.toast[data-tone='warning'] .icon { color: var(--color-warning); }
.toast[data-tone='info'] { border-left-color: var(--accent-primary); }
.toast[data-tone='info'] .icon { color: var(--accent-primary); }

.icon { flex: 0 0 auto; }
.text { flex: 1 1 auto; }

.close {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--text-2xs);
  padding: 0 var(--space-1);
}
.close:hover { color: var(--text-secondary); }

@keyframes toastIn {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .toast { animation: none; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run components/notifications/ToastStack`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/notifications/ToastStack.tsx packages/web/src/components/notifications/ToastStack.module.css packages/web/src/components/notifications/ToastStack.test.tsx
git commit -m "feat(web): add ToastStack for transient feed events"
```

---

## Task 8: Web — `StatusBanner` component

**Files:**
- Create: `packages/web/src/components/notifications/StatusBanner.tsx`
- Create: `packages/web/src/components/notifications/StatusBanner.module.css`
- Test: `packages/web/src/components/notifications/StatusBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/notifications/StatusBanner.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { ActiveNotice } from '@lib/system-status';
import StatusBanner from './StatusBanner';

const NOW = 1_700_000_000_000;

const info: ActiveNotice = { id: 'a1', severity: 'info', title: 'Scheduled maintenance', dismissible: true };

describe('StatusBanner', () => {
  it('renders the title and a dismiss button when dismissible', () => {
    const onDismiss = vi.fn();
    render(<StatusBanner notice={info} now={NOW} onDismiss={onDismiss} />);
    expect(screen.getByText('Scheduled maintenance')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('hides the dismiss button for non-dismissible notices', () => {
    const degraded: ActiveNotice = { id: null, severity: 'degraded', title: 'Live feed disconnected', dismissible: false };
    render(<StatusBanner notice={degraded} now={NOW} onDismiss={() => {}} />);
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('shows a countdown when startsAt is in the future', () => {
    const scheduled: ActiveNotice = { ...info, startsAt: NOW + 2 * 60 * 60 * 1000 };
    render(<StatusBanner notice={scheduled} now={NOW} onDismiss={() => {}} />);
    expect(screen.getByText(/2h/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run components/notifications/StatusBanner`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/notifications/StatusBanner.tsx`:

```tsx
import { SEVERITY_ICON, type ActiveNotice } from '@lib/system-status';

import styles from './StatusBanner.module.css';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = total % 60;
  return `${m}m ${s}s`;
}

interface StatusBannerProps {
  notice: ActiveNotice;
  now: number;
  onDismiss: () => void;
}

export default function StatusBanner({ notice, now, onDismiss }: StatusBannerProps) {
  const scheduled = notice.startsAt != null && notice.startsAt > now;
  const countdownMs = scheduled ? notice.startsAt! - now : null;

  return (
    <div className={styles.banner} data-severity={notice.severity} role="status">
      <span className={styles.icon} aria-hidden>
        {SEVERITY_ICON[notice.severity]}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{notice.title}</span>
        {notice.message && <span className={styles.message}>{notice.message}</span>}
        {countdownMs != null && <span className={styles.countdown}>in {formatCountdown(countdownMs)}</span>}
      </span>
      {notice.dismissible && (
        <button type="button" className={styles.close} aria-label="Dismiss" onClick={onDismiss}>
          ✕
        </button>
      )}
    </div>
  );
}
```

Create `packages/web/src/components/notifications/StatusBanner.module.css`:

```css
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  animation: bannerIn var(--transition-base);
}

.banner[data-severity='info']     { background: rgba(136, 182, 255, 0.10); border-bottom-color: rgba(136, 182, 255, 0.35); color: var(--color-info); }
.banner[data-severity='notice']   { background: rgba(254, 249, 160, 0.10); border-bottom-color: rgba(254, 249, 160, 0.35); color: var(--color-warning); }
.banner[data-severity='degraded'] { background: rgba(203, 56, 85, 0.12);  border-bottom-color: rgba(203, 56, 85, 0.40);  color: var(--color-loss); }
.banner[data-severity='outage']   { background: rgba(203, 56, 85, 0.18);  border-bottom-color: var(--color-loss);          color: var(--color-loss); }

.icon { flex: 0 0 auto; }

.body {
  flex: 1 1 auto;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.title { font-weight: 600; }
.message { color: var(--text-tertiary); }
.countdown {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.close {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: currentColor;
  opacity: 0.7;
  cursor: pointer;
  font-size: var(--text-2xs);
  padding: 0 var(--space-1);
}
.close:hover { opacity: 1; }

@keyframes bannerIn {
  from { opacity: 0; transform: translateY(-100%); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .banner { animation: none; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run components/notifications/StatusBanner`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/notifications/StatusBanner.tsx packages/web/src/components/notifications/StatusBanner.module.css packages/web/src/components/notifications/StatusBanner.test.tsx
git commit -m "feat(web): add StatusBanner for status/maintenance states"
```

---

## Task 9: Web — `StatusTakeover` component

Mirrors the `SessionNotice` backdrop/panel pattern.

**Files:**
- Create: `packages/web/src/components/notifications/StatusTakeover.tsx`
- Create: `packages/web/src/components/notifications/StatusTakeover.module.css`
- Test: `packages/web/src/components/notifications/StatusTakeover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/notifications/StatusTakeover.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ActiveNotice } from '@lib/system-status';
import StatusTakeover from './StatusTakeover';

const outage: ActiveNotice = {
  id: 'o1', severity: 'outage', title: 'System under maintenance', message: 'Back at 14:00 UTC', dismissible: false,
};

describe('StatusTakeover', () => {
  it('renders a modal dialog with the title and message', () => {
    render(<StatusTakeover notice={outage} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('System under maintenance')).toBeTruthy();
    expect(screen.getByText('Back at 14:00 UTC')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run components/notifications/StatusTakeover`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/notifications/StatusTakeover.tsx`:

```tsx
import { SEVERITY_ICON, type ActiveNotice } from '@lib/system-status';

import styles from './StatusTakeover.module.css';

const TITLE_ID = 'status-takeover-title';

export default function StatusTakeover({ notice }: { notice: ActiveNotice }) {
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div className={styles.panel} data-severity={notice.severity}>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden>
            {SEVERITY_ICON[notice.severity]}
          </span>
          <span className={styles.title} id={TITLE_ID}>
            {notice.title}
          </span>
        </div>
        {notice.message && <p className={styles.body}>{notice.message}</p>}
      </div>
    </div>
  );
}
```

Create `packages/web/src/components/notifications/StatusTakeover.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: fadeIn var(--transition-base);
}

.panel {
  width: 100%;
  max-width: 440px;
  padding: var(--space-6) var(--space-6) var(--space-5);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  font-family: var(--font-mono);
  color: var(--text-primary);
  animation: rise var(--transition-base);
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.icon {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 18px;
  line-height: 1;
  background: rgba(203, 56, 85, 0.14);
  color: var(--color-loss);
}
.panel[data-severity='degraded'] .icon,
.panel[data-severity='notice'] .icon { background: rgba(254, 249, 160, 0.12); color: var(--color-warning); }
.panel[data-severity='info'] .icon { background: var(--accent-primary-dim); color: var(--accent-primary); }

.title {
  font-size: var(--text-md);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.body {
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--text-secondary);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop, .panel { animation: none; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run components/notifications/StatusTakeover`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/notifications/StatusTakeover.tsx packages/web/src/components/notifications/StatusTakeover.module.css packages/web/src/components/notifications/StatusTakeover.test.tsx
git commit -m "feat(web): add StatusTakeover for blocking states"
```

---

## Task 10: Web — `useFeedToasts` hook (read-only `feedStatus` consumer)

**Files:**
- Create: `packages/web/src/hooks/useFeedToasts.ts`
- Test: `packages/web/src/hooks/useFeedToasts.test.tsx`

This hook **only reads** `feedStatus` from the store. It opens no socket and imports nothing from the WS layer.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/hooks/useFeedToasts.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import { useFeedToasts } from './useFeedToasts';

function setConn(state: string) {
  act(() => {
    useAppStore.setState((s) => ({ feedStatus: { ...s.feedStatus, connectionState: state as never } }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState((s) => ({
    feedStatus: { ...s.feedStatus, connectionState: 'live', failedVenueIds: [] },
    activeVenues: ['deribit'],
    toasts: [],
    feedDegraded: false,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFeedToasts', () => {
  it('pushes a reconnecting toast when the socket drops to reconnecting', () => {
    renderHook(() => useFeedToasts());
    setConn('reconnecting');
    expect(useAppStore.getState().toasts.some((t) => t.text.includes('Reconnecting'))).toBe(true);
  });

  it('sets feedDegraded after 8s of trouble and clears + toasts on recovery', () => {
    renderHook(() => useFeedToasts());
    setConn('reconnecting');
    act(() => { vi.advanceTimersByTime(8000); });
    expect(useAppStore.getState().feedDegraded).toBe(true);

    setConn('live');
    expect(useAppStore.getState().feedDegraded).toBe(false);
    expect(useAppStore.getState().toasts.some((t) => t.text.includes('restored'))).toBe(true);
  });

  it('does not mark degraded for a brief blip under 8s', () => {
    renderHook(() => useFeedToasts());
    setConn('reconnecting');
    act(() => { vi.advanceTimersByTime(3000); });
    setConn('live');
    act(() => { vi.advanceTimersByTime(8000); });
    expect(useAppStore.getState().feedDegraded).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run hooks/useFeedToasts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/hooks/useFeedToasts.ts`:

```ts
import { useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';

const DEGRADED_DELAY_MS = 8000;

/**
 * Read-only consumer of the feedStatus store slice. Emits transient toasts
 * for reconnect/recovery and flips `feedDegraded` after a sustained outage.
 * Never touches WS transport — it only observes state others write.
 */
export function useFeedToasts() {
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const failedVenueIds = useAppStore((s) => s.feedStatus.failedVenueIds);
  const pushToast = useAppStore((s) => s.pushToast);
  const setFeedDegraded = useAppStore((s) => s.setFeedDegraded);

  const prevTroubleRef = useRef(false);
  const surfacedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allVenuesFailed =
    activeVenues.length > 0 && activeVenues.every((v) => failedVenueIds.includes(v));
  const inTrouble = connectionState !== 'live' || allVenuesFailed;

  useEffect(() => {
    const wasInTrouble = prevTroubleRef.current;

    if (inTrouble && !wasInTrouble) {
      if (connectionState === 'reconnecting' || connectionState === 'connecting') {
        pushToast({ tone: 'warning', icon: '↻', text: 'Reconnecting to feed…' });
        surfacedRef.current = true;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setFeedDegraded(true);
        surfacedRef.current = true;
      }, DEGRADED_DELAY_MS);
    }

    if (!inTrouble && wasInTrouble) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setFeedDegraded(false);
      if (surfacedRef.current) {
        pushToast({ tone: 'success', icon: '✓', text: 'Feed restored' });
      }
      surfacedRef.current = false;
    }

    prevTroubleRef.current = inTrouble;
  }, [inTrouble, connectionState, pushToast, setFeedDegraded]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run hooks/useFeedToasts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useFeedToasts.ts packages/web/src/hooks/useFeedToasts.test.tsx
git commit -m "feat(web): derive feed toasts/degraded from feedStatus (read-only)"
```

---

## Task 11: Web — `SystemNotifications` composition + mount in `AppShell`

**Files:**
- Create: `packages/web/src/components/notifications/SystemNotifications.tsx`
- Create: `packages/web/src/components/notifications/index.ts`
- Test: `packages/web/src/components/notifications/SystemNotifications.test.tsx`
- Modify: `packages/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/notifications/SystemNotifications.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import { SystemNotifications } from './index';

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState((s) => ({
    announcement: null,
    feedDegraded: false,
    toasts: [],
    feedStatus: { ...s.feedStatus, connectionState: 'live', failedVenueIds: [] },
    activeVenues: ['deribit'],
  }));
});

describe('SystemNotifications', () => {
  it('renders a banner for a non-blocking announcement', () => {
    useAppStore.setState({ announcement: { id: 'a1', severity: 'notice', blocking: false, title: 'Under construction' } });
    render(<SystemNotifications />);
    expect(screen.getByText('Under construction')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a takeover for a blocking announcement', () => {
    useAppStore.setState({ announcement: { id: 'o1', severity: 'outage', blocking: true, title: 'Down for maintenance' } });
    render(<SystemNotifications />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('renders the degraded feed banner when feedDegraded is set', () => {
    useAppStore.setState({ feedDegraded: true });
    render(<SystemNotifications />);
    expect(screen.getByText('Live feed disconnected')).toBeTruthy();
  });

  it('dismisses a banner and remembers it', () => {
    useAppStore.setState({ announcement: { id: 'a1', severity: 'info', blocking: false, title: 'Scheduled maintenance' } });
    render(<SystemNotifications />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Scheduled maintenance')).toBeNull();
    expect(localStorage.getItem('systemAnnouncementDismissed')).toContain('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web test:run components/notifications/SystemNotifications`
Expected: FAIL — `./index` has no `SystemNotifications` export.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/notifications/SystemNotifications.tsx`:

```tsx
import { useEffect, useState } from 'react';

import { useFeedToasts } from '@hooks/useFeedToasts';
import { addDismissedId, loadDismissedIds, selectActiveNotice } from '@lib/system-status';
import { useAppStore } from '@stores/app-store';

import StatusBanner from './StatusBanner';
import StatusTakeover from './StatusTakeover';
import ToastStack from './ToastStack';

export default function SystemNotifications() {
  useFeedToasts();

  const announcement = useAppStore((s) => s.announcement);
  const feedDegraded = useAppStore((s) => s.feedDegraded);
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => loadDismissedIds());
  const [now, setNow] = useState(() => Date.now());

  const selection = selectActiveNotice(announcement, feedDegraded, dismissedIds, now);

  // Tick once per second only while a countdown or expiry is pending.
  const needsTick =
    (selection.notice?.startsAt != null && selection.notice.startsAt > now) ||
    announcement?.endsAt != null;

  useEffect(() => {
    if (!needsTick) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [needsTick]);

  const handleDismiss = () => {
    if (selection.notice?.id) setDismissedIds(addDismissedId(selection.notice.id));
  };

  return (
    <>
      {selection.surface === 'banner' && selection.notice && (
        <StatusBanner notice={selection.notice} now={now} onDismiss={handleDismiss} />
      )}
      {selection.surface === 'takeover' && selection.notice && (
        <StatusTakeover notice={selection.notice} />
      )}
      <ToastStack />
    </>
  );
}
```

Create `packages/web/src/components/notifications/index.ts`:

```ts
export { default as SystemNotifications } from './SystemNotifications';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web test:run components/notifications/SystemNotifications`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount it in AppShell**

In `packages/web/src/components/layout/AppShell.tsx`:

Add the import after the existing `@components/ui` import:

```ts
import { SystemNotifications } from '@components/notifications';
```

Then render it immediately after `<TopBar ... />` (so the banner sits directly under the top bar; the takeover and toasts are fixed overlays):

```tsx
        <TopBar tabs={tabs} onOpenPalette={() => setPaletteOpen(true)} />
        <SystemNotifications />
```

- [ ] **Step 6: Verify the app still typechecks and the suite passes**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/notifications/SystemNotifications.tsx packages/web/src/components/notifications/index.ts packages/web/src/components/notifications/SystemNotifications.test.tsx packages/web/src/components/layout/AppShell.tsx
git commit -m "feat(web): compose + mount SystemNotifications in AppShell"
```

---

## Task 12: Docs, operator config, and full verification

**Files:**
- Modify: `.env.example` (repo root)
- Modify: `packages/web/CLAUDE.md` (one note)

- [ ] **Step 1: Document the operator config**

Append to `.env.example` (repo root):

```bash
# Optional: path to a JSON file the server reads to surface a site-wide status
# announcement on GET /api/health. Edit the file to flip a flag (no restart).
# Shape: { "id", "severity": info|notice|degraded|outage, "blocking": bool,
#          "title", "message"?, "startsAt"?: epochMs, "endsAt"?: epochMs }
# Empty file / null / invalid → no announcement.
STATUS_FILE=
```

- [ ] **Step 2: Add a note to the web package docs**

In `packages/web/CLAUDE.md`, under "Non-obvious decisions", add:

```markdown
- **System notifications are read-only consumers of feed state**: `components/notifications/SystemNotifications` renders the status banner / takeover (from the `/health` `announcement`) and feed toasts. `useFeedToasts` and the banner read the `feedStatus` store slice only — they never touch WS transport/subscription code.
```

- [ ] **Step 3: Run the full affected test + typecheck + lint suites**

Run:
```bash
pnpm --filter @oggregator/protocol build
pnpm --filter @oggregator/protocol test:run
pnpm --filter @oggregator/server test:run
pnpm --filter @oggregator/web test:run
pnpm --filter @oggregator/web typecheck
pnpm --filter @oggregator/server typecheck
pnpm check
```
Expected: all green. Fix any biome formatting issues with `pnpm format`.

- [ ] **Step 4: Verify NO WebSocket-layer file was modified**

Run:
```bash
git diff --name-only main...HEAD | grep -E 'useChainWs|ws-chain|chain-stream-session|venue-subscriptions|feed-health|venue-health|planner|/state\.ts|/health\.ts$' || echo "OK: no WS-layer files changed"
```
Expected: prints `OK: no WS-layer files changed`. (Note: `routes/health.ts` is the REST health route and is expected to appear if you grep loosely — confirm only `packages/server/src/routes/health.ts` shows, and that the diff there is just the additive `announcement` line. No `core` WS/planner/state/health files may appear.)

- [ ] **Step 5: Manual smoke test (optional but recommended)**

```bash
# Terminal 1 — server with a status file
echo '{"id":"demo","severity":"notice","blocking":false,"title":"Under construction","message":"New surface shipping soon."}' > /tmp/ogg-status.json
STATUS_FILE=/tmp/ogg-status.json pnpm dev:server

# Terminal 2 — web
pnpm dev:web
```
Open http://localhost:5173 — expect the "Under construction" banner under the TopBar within ~30s. Set `"blocking":true` in the file and reload → full-screen takeover. Empty the file (`echo '' > /tmp/ogg-status.json`) → banner clears within ~30s.

- [ ] **Step 6: Commit**

```bash
git add .env.example packages/web/CLAUDE.md
git commit -m "docs: document STATUS_FILE + system-notifications read-only contract"
```

---

## Self-review notes (for the implementer)

- **Type consistency:** `ActiveNotice` (Task 4) is the single shape consumed by `StatusBanner` (Task 8), `StatusTakeover` (Task 9), and `SystemNotifications` (Task 11). `Toast`/`ToastInput` (Task 5) are consumed by `ToastStack` (Task 7) and `useFeedToasts` (Task 10). `SystemAnnouncement` (Task 1) flows protocol → server provider (Task 2) → `/health` (Task 3) → `parseAnnouncement` (Task 4) → store (Task 5) → selection (Task 4/11).
- **Spec coverage:** under-construction / maintenance → operator announcement (banner or takeover via `blocking`); WS issues → `useFeedToasts` (toast) + degraded banner; severity ladder → `selectActiveNotice` + `data-severity` CSS; minimal motion + reduced-motion → each `.module.css`; backend source → `status.json` provider.
- **WS safety:** only `feedStatus` is read; Task 12 Step 4 asserts no transport file changed.
