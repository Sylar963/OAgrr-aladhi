# Onboarding (Welcome Modal + Guided Tour) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run welcome modal and an optional desktop-only guided spotlight tour over the app's persistent chrome, plus a discoverable "?" help menu — all as additive, client-only UI.

**Architecture:** New `packages/web/src/components/onboarding/` directory (peer to `notifications/`). A first-run `WelcomeModal` (gated by a `localStorage` flag) offers "Take the tour", which flips a small `onboarding` slice in the Zustand store. A hand-rolled `TourSpotlight` reads that slice, resolves each step's target via a `[data-tour]` attribute + `getBoundingClientRect()`, and renders a dimmed ring + tooltip. A `HelpMenu` ("?" button) re-opens the tour or the existing keyboard-shortcuts overlay. Wiring into `AppShell`/`TopBar`/`AccountChip` is additive only — no server, protocol, or WebSocket code is touched.

**Tech Stack:** Vite 6 + React 19 + TypeScript, CSS Modules + design tokens, Zustand 5 (UI state), Vitest 4 + `@testing-library/react` (`globals: false` → explicit `cleanup()` in `afterEach`, `@vitest-environment jsdom` doc-comment per test file).

**Spec:** `docs/superpowers/specs/2026-05-26-onboarding-tour-design.md`

**Branch:** `feat/onboarding-tour` (already created off `main`).

**Convention:** Every commit message ends with the trailer:
```text
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File Structure

**New files**
- `packages/web/src/components/onboarding/tour-steps.ts` — `TourStep` type + `TOUR_STEPS` config (single source of truth for step content, order, count).
- `packages/web/src/lib/onboarding.ts` — `hasSeenOnboarding()` / `markOnboardingSeen()` over `localStorage`.
- `packages/web/src/components/onboarding/WelcomeModal.tsx` (+ `.module.css`) — first-run intro modal.
- `packages/web/src/components/onboarding/TourSpotlight.tsx` (+ `.module.css`) — guided tour overlay.
- `packages/web/src/components/onboarding/HelpMenu.tsx` (+ `.module.css`) — "?" popover menu.
- `packages/web/src/components/onboarding/Onboarding.tsx` — composition root (WelcomeModal + TourSpotlight).
- `packages/web/src/components/onboarding/index.ts` — barrel (`Onboarding`, `HelpMenu`).
- Tests: `tour-steps.test.ts`, `onboarding.test.ts` (in `lib/`), `WelcomeModal.test.tsx`, `TourSpotlight.test.tsx`, `HelpMenu.test.tsx`, and store-slice tests.

**Edited (additive only)**
- `packages/web/src/stores/app-store.ts` — add `onboarding` slice (`tourActive`, `tourStep` + actions).
- `packages/web/src/components/layout/TopBar.tsx` — `data-tour` attributes; render `<HelpMenu/>`; new `onOpenShortcuts` prop.
- `packages/web/src/components/layout/AppShell.tsx` — mount `<Onboarding/>`; pass `onOpenShortcuts`.
- `packages/web/src/components/layout/AccountChip.tsx` — `data-tour="account"` on root.

**Not touched:** `VenueStatusRow.tsx`, `ShortcutHelp.tsx`, the keyboard `?` handler, any WS/server/protocol code. No `tsconfig.json`/`vite.config.ts` change (`@components/onboarding` resolves under the existing `@components` alias).

**Common commands**
- Single test file: `pnpm --filter @oggregator/web exec vitest run <path>`
- Full web suite: `pnpm --filter @oggregator/web test:run`
- Typecheck: `pnpm --filter @oggregator/web typecheck`
- Format/lint our files: `pnpm --filter @oggregator/web exec biome check --write <paths>`

---

### Task 1: Tour step config (`tour-steps.ts`)

**Files:**
- Create: `packages/web/src/components/onboarding/tour-steps.ts`
- Test: `packages/web/src/components/onboarding/tour-steps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/components/onboarding/tour-steps.test.ts
import { describe, expect, it } from 'vitest';
import { TOUR_STEPS } from './tour-steps';

describe('TOUR_STEPS', () => {
  it('has 5 ordered steps', () => {
    expect(TOUR_STEPS).toHaveLength(5);
  });

  it('targets the four chrome elements in order, then a target-less wrap-up', () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual([
      'views',
      'asset-picker',
      'venue-status',
      'account',
      undefined,
    ]);
  });

  it('every step has a title and body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/tour-steps.test.ts`
Expected: FAIL — cannot resolve `./tour-steps`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/components/onboarding/tour-steps.ts

export interface TourStep {
  /** Stable `[data-tour]` attribute on the element to spotlight; omitted for the centered wrap-up. */
  target?: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'views',
    title: 'Views',
    body: 'Switch views — option chain, vol surface, GEX, flow, paper trading, portfolio.',
  },
  {
    target: 'asset-picker',
    title: 'Asset picker',
    body: 'Pick your underlying. Hit ⌘K or / anytime to switch.',
  },
  {
    target: 'venue-status',
    title: 'Venue status',
    body: "Live feed health per venue. If it degrades, a status banner tells you what's happening.",
  },
  {
    target: 'account',
    title: 'Account',
    body: 'Connect paper trading and track a live portfolio.',
  },
  {
    title: "That's the tour",
    body: 'Reopen it anytime from the ? menu. Press ? for shortcuts.',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/tour-steps.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/onboarding/tour-steps.ts packages/web/src/components/onboarding/tour-steps.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add onboarding tour step config

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: First-run helpers (`lib/onboarding.ts`)

**Files:**
- Create: `packages/web/src/lib/onboarding.ts`
- Test: `packages/web/src/lib/onboarding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/onboarding.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('onboarding first-run flag', () => {
  it('reports not-seen when no flag is stored', () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it('reports seen after markOnboardingSeen()', () => {
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });
});
```

> Note: this test needs the jsdom `localStorage`. Add the environment doc-comment at the very top of the file:
> ```ts
> /**
>  * @vitest-environment jsdom
>  */
> ```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/lib/onboarding.test.ts`
Expected: FAIL — cannot resolve `./onboarding`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/onboarding.ts

const ONBOARDING_SEEN_KEY = 'onboardingSeen';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    /* ignore quota / unavailable storage */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/lib/onboarding.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/onboarding.ts packages/web/src/lib/onboarding.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add onboarding first-run localStorage helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Store `onboarding` slice (`app-store.ts`)

**Files:**
- Modify: `packages/web/src/stores/app-store.ts`
- Test: `packages/web/src/stores/onboarding-slice.test.ts`

The slice holds only the tour runtime state. `nextStep`/`prevStep` are plain increments (clamped at 0); the "last step → end" decision lives in `TourSpotlight` (Task 5), keeping the store decoupled from `tour-steps.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/stores/onboarding-slice.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';

beforeEach(() => {
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});

describe('onboarding store slice', () => {
  it('startTour activates the tour at step 0', () => {
    useAppStore.setState({ tourActive: false, tourStep: 3 });
    useAppStore.getState().startTour();
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(useAppStore.getState().tourStep).toBe(0);
  });

  it('endTour deactivates the tour', () => {
    useAppStore.setState({ tourActive: true });
    useAppStore.getState().endTour();
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('nextStep advances the step index', () => {
    useAppStore.getState().nextStep();
    expect(useAppStore.getState().tourStep).toBe(1);
  });

  it('prevStep decrements but clamps at 0', () => {
    useAppStore.setState({ tourStep: 1 });
    useAppStore.getState().prevStep();
    expect(useAppStore.getState().tourStep).toBe(0);
    useAppStore.getState().prevStep();
    expect(useAppStore.getState().tourStep).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/stores/onboarding-slice.test.ts`
Expected: FAIL — `startTour is not a function` (and TS errors on `tourActive`/`tourStep`).

- [ ] **Step 3: Write minimal implementation**

In `packages/web/src/stores/app-store.ts`, add to the `AppState` interface (after the `toasts: Toast[];` field, before the action signatures):

```ts
  tourActive: boolean;
  tourStep: number;
```

Add to the action signatures block (after `dismissToast: (id: string) => void;`):

```ts
  startTour: () => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
```

Add to the initial-state object (after `toasts: [],`):

```ts
  tourActive: false,
  tourStep: 0,
```

Add the action implementations (after the `dismissToast: ...` implementation):

```ts
  startTour: () => set({ tourActive: true, tourStep: 0 }),
  endTour: () => set({ tourActive: false }),
  nextStep: () => set((s) => ({ tourStep: s.tourStep + 1 })),
  prevStep: () => set((s) => ({ tourStep: Math.max(0, s.tourStep - 1) })),
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm --filter @oggregator/web exec vitest run src/stores/onboarding-slice.test.ts`
Expected: PASS (4 tests).
Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/app-store.ts packages/web/src/stores/onboarding-slice.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add onboarding tour slice to app store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: WelcomeModal

**Files:**
- Create: `packages/web/src/components/onboarding/WelcomeModal.tsx`
- Create: `packages/web/src/components/onboarding/WelcomeModal.module.css`
- Test: `packages/web/src/components/onboarding/WelcomeModal.test.tsx`

Self-contained visibility: shows on mount when `!hasSeenOnboarding()`. Any action marks seen and hides; "Take the tour" also calls `startTour()`. On mobile (`useIsMobile()`), renders only "Got it" (no tour). Focus moves to the primary button on open; Esc closes — matching the existing `SessionNotice` modal pattern (`role="dialog" aria-modal`).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/onboarding/WelcomeModal.test.tsx
/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WelcomeModal from './WelcomeModal';

// jsdom has no window.matchMedia, so useIsMobile would throw if rendered for real.
// Mock it and flip this variable to exercise the mobile branch.
let mockIsMobile = false;
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => mockIsMobile }));

beforeEach(() => {
  mockIsMobile = false;
  localStorage.clear();
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});
afterEach(() => cleanup());

describe('WelcomeModal', () => {
  it('shows on first run', () => {
    render(<WelcomeModal />);
    expect(screen.getByText('Welcome to oggregator')).toBeTruthy();
  });

  it('does not show once onboarding has been seen', () => {
    localStorage.setItem('onboardingSeen', '1');
    render(<WelcomeModal />);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('"Take the tour" marks seen, closes, and starts the tour', () => {
    render(<WelcomeModal />);
    fireEvent.click(screen.getByText('Take the tour'));
    expect(localStorage.getItem('onboardingSeen')).toBe('1');
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('"Skip" marks seen and closes without starting the tour', () => {
    render(<WelcomeModal />);
    fireEvent.click(screen.getByText('Skip'));
    expect(localStorage.getItem('onboardingSeen')).toBe('1');
    expect(useAppStore.getState().tourActive).toBe(false);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('Esc closes the modal', () => {
    render(<WelcomeModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('on mobile shows only "Got it" (no tour)', () => {
    mockIsMobile = true;
    render(<WelcomeModal />);
    expect(screen.getByText('Got it')).toBeTruthy();
    expect(screen.queryByText('Take the tour')).toBeNull();
    expect(screen.queryByText('Skip')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/WelcomeModal.test.tsx`
Expected: FAIL — cannot resolve `./WelcomeModal`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/web/src/components/onboarding/WelcomeModal.tsx
import { useEffect, useRef, useState } from 'react';

import { useIsMobile } from '@hooks/useIsMobile';
import { hasSeenOnboarding, markOnboardingSeen } from '@lib/onboarding';
import { useAppStore } from '@stores/app-store';

import styles from './WelcomeModal.module.css';

export default function WelcomeModal() {
  const [visible, setVisible] = useState(() => !hasSeenOnboarding());
  const isMobile = useIsMobile();
  const startTour = useAppStore((s) => s.startTour);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        markOnboardingSeen();
        setVisible(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    markOnboardingSeen();
    setVisible(false);
  };

  const onTakeTour = () => {
    markOnboardingSeen();
    setVisible(false);
    startTour();
  };

  const titleId = 'welcome-modal-title';

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden>
            ◎
          </span>
          <span className={styles.title} id={titleId}>
            Welcome to oggregator
          </span>
        </div>
        <p className={styles.body}>
          Cross-venue crypto options on one screen. Compare quotes, vol, and Greeks across Deribit,
          OKX, Bybit and more.
        </p>
        <div className={styles.actions}>
          {isMobile ? (
            <button
              type="button"
              ref={primaryRef}
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={dismiss}
            >
              Got it
            </button>
          ) : (
            <>
              <button type="button" className={styles.btn} onClick={dismiss}>
                Skip
              </button>
              <button
                type="button"
                ref={primaryRef}
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onTakeTour}
              >
                Take the tour
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

```css
/* packages/web/src/components/onboarding/WelcomeModal.module.css */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: rgba(0, 0, 0, 0.72);
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
  background: var(--accent-primary-dim);
  color: var(--accent-primary);
}

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

.actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-5);
}

.btn {
  padding: 8px var(--space-4);
  min-height: var(--touch-min);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btnPrimary {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary);
}

.btnPrimary:hover {
  background: var(--accent-primary-dim);
  border-color: var(--accent-primary);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop,
  .panel {
    animation: none;
  }
}

@media (max-width: 768px) {
  .actions {
    flex-direction: column-reverse;
  }
  .btn {
    width: 100%;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/WelcomeModal.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/onboarding/WelcomeModal.tsx packages/web/src/components/onboarding/WelcomeModal.module.css packages/web/src/components/onboarding/WelcomeModal.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add first-run onboarding welcome modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: TourSpotlight

**Files:**
- Create: `packages/web/src/components/onboarding/TourSpotlight.tsx`
- Create: `packages/web/src/components/onboarding/TourSpotlight.module.css`
- Test: `packages/web/src/components/onboarding/TourSpotlight.test.tsx`

Reads `tourActive`/`tourStep` from the store. For a step with a `target`, resolves `[data-tour="<target>"]` and measures it (re-measuring on resize/scroll). A missing target skips forward (or ends on the last step). The target-less wrap-up renders a centered tooltip over a full backdrop. Renders nothing when `isMobile`. Esc and Skip end the tour; Next on the last step ends it.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/onboarding/TourSpotlight.test.tsx
/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TourSpotlight from './TourSpotlight';

// jsdom has no window.matchMedia, so useIsMobile would throw if rendered for real.
// Mock it and flip this variable to exercise the mobile branch.
let mockIsMobile = false;
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => mockIsMobile }));

// Render the four chrome targets alongside the spotlight so querySelector resolves them.
function Targets() {
  return (
    <>
      <div data-tour="views" />
      <div data-tour="asset-picker" />
      <div data-tour="venue-status" />
      <div data-tour="account" />
    </>
  );
}

beforeEach(() => {
  mockIsMobile = false;
  useAppStore.setState({ tourActive: true, tourStep: 0 });
});
afterEach(() => {
  cleanup();
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});

describe('TourSpotlight', () => {
  it('renders nothing when the tour is inactive', () => {
    useAppStore.setState({ tourActive: false });
    const { container } = render(<TourSpotlight />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the first step title and step count', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByLabelText('Step 1 of 5')).toBeTruthy();
  });

  it('advances to the next step on Next, and back on Back', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Asset picker')).toBeTruthy();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Views')).toBeTruthy();
  });

  it('ends the tour on Skip', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    fireEvent.click(screen.getByText('Skip'));
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('ends the tour on Escape', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('ends the tour when Done is clicked on the last (wrap-up) step', () => {
    useAppStore.setState({ tourActive: true, tourStep: 4 });
    render(<TourSpotlight />);
    expect(screen.getByText("That's the tour")).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('skips past missing targets and lands on the wrap-up', () => {
    // No Targets rendered → every targeted step is skipped, ending on the wrap-up.
    render(<TourSpotlight />);
    expect(screen.getByText("That's the tour")).toBeTruthy();
  });

  it('renders nothing on mobile', () => {
    mockIsMobile = true;
    const { container } = render(<TourSpotlight />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/TourSpotlight.test.tsx`
Expected: FAIL — cannot resolve `./TourSpotlight`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/web/src/components/onboarding/TourSpotlight.tsx
import { useEffect, useState } from 'react';

import { useIsMobile } from '@hooks/useIsMobile';
import { useAppStore } from '@stores/app-store';

import { TOUR_STEPS } from './tour-steps';
import styles from './TourSpotlight.module.css';

const TOOLTIP_WIDTH = 280;
const GAP = 12;

export default function TourSpotlight() {
  const tourActive = useAppStore((s) => s.tourActive);
  const tourStep = useAppStore((s) => s.tourStep);
  const nextStep = useAppStore((s) => s.nextStep);
  const prevStep = useAppStore((s) => s.prevStep);
  const endTour = useAppStore((s) => s.endTour);
  const isMobile = useIsMobile();
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = TOUR_STEPS[tourStep];
  const isLast = tourStep === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!tourActive || isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourActive, isMobile, endTour]);

  useEffect(() => {
    if (!tourActive || isMobile || step == null) return;
    if (step.target == null) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el == null) {
      // Target not present on this layout — skip past it (or end on the last step).
      if (isLast) endTour();
      else nextStep();
      return;
    }
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [tourActive, isMobile, step, tourStep, isLast, nextStep, endTour]);

  if (!tourActive || isMobile || step == null) return null;

  const centered = step.target == null || rect == null;
  const onNext = () => (isLast ? endTour() : nextStep());

  const tooltipStyle = centered
    ? undefined
    : {
        top: Math.min(rect.bottom + GAP, window.innerHeight - GAP),
        left: Math.max(GAP, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - GAP)),
      };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={step.title}>
      {centered ? (
        <div className={styles.backdrop} />
      ) : (
        <div
          className={styles.ring}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        className={centered ? `${styles.tooltip} ${styles.tooltipCentered}` : styles.tooltip}
        style={tooltipStyle}
      >
        <div className={styles.tipTitle}>{step.title}</div>
        <p className={styles.tipBody}>{step.body}</p>
        <div className={styles.tipFooter}>
          <span className={styles.dots} aria-label={`Step ${tourStep + 1} of ${TOUR_STEPS.length}`}>
            {TOUR_STEPS.map((s, i) => (
              <span key={s.title} className={i === tourStep ? styles.dotActive : styles.dot} aria-hidden />
            ))}
          </span>
          <span className={styles.tipActions}>
            <button type="button" className={styles.skipBtn} onClick={endTour}>
              Skip
            </button>
            {tourStep > 0 && (
              <button type="button" className={styles.navBtn} onClick={prevStep}>
                Back
              </button>
            )}
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navBtnPrimary}`}
              onClick={onNext}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
```

```css
/* packages/web/src/components/onboarding/TourSpotlight.module.css */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  pointer-events: none;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(10, 10, 10, 0.74);
  animation: fadeIn var(--transition-base);
}

.ring {
  position: absolute;
  border: 1.5px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 9999px rgba(10, 10, 10, 0.74);
  transition:
    top var(--transition-base),
    left var(--transition-base),
    width var(--transition-base),
    height var(--transition-base);
}

.tooltip {
  position: absolute;
  width: 280px;
  max-width: calc(100vw - 24px);
  padding: var(--space-4);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-left: 2px solid var(--accent-primary);
  border-radius: var(--radius-md);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  font-family: var(--font-mono);
  color: var(--text-secondary);
  pointer-events: auto;
  animation: rise var(--transition-base);
}

.tooltipCentered {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.tipTitle {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}

.tipBody {
  font-size: var(--text-xs);
  line-height: 1.6;
  margin: 0 0 var(--space-4);
}

.tipFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.dots {
  display: inline-flex;
  gap: 5px;
}

.dot,
.dotActive {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
}

.dotActive {
  background: var(--accent-primary);
}

.tipActions {
  display: inline-flex;
  gap: var(--space-2);
}

.skipBtn,
.navBtn {
  padding: 5px var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.skipBtn {
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid transparent;
}

.skipBtn:hover {
  color: var(--text-secondary);
}

.navBtn {
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
}

.navBtn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.navBtnPrimary {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop,
  .ring,
  .tooltip {
    animation: none;
    transition: none;
  }
}
```

> Tokens used (`--text-2xs`, `--radius-sm`, `--space-1`, `--accent-primary*`, `--border-*`, `--bg-*`, `--transition-*`) are all confirmed present in `packages/web/src/styles/tokens.css`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/TourSpotlight.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/onboarding/TourSpotlight.tsx packages/web/src/components/onboarding/TourSpotlight.module.css packages/web/src/components/onboarding/TourSpotlight.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add guided tour spotlight overlay

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: HelpMenu

**Files:**
- Create: `packages/web/src/components/onboarding/HelpMenu.tsx`
- Create: `packages/web/src/components/onboarding/HelpMenu.module.css`
- Test: `packages/web/src/components/onboarding/HelpMenu.test.tsx`

Self-contained "?" button + popover (mirrors `AccountChip`'s outside-click/Esc pattern). "Take the tour" → `startTour()`; "Keyboard shortcuts" → `onOpenShortcuts()` prop. Both close the menu.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/onboarding/HelpMenu.test.tsx
/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HelpMenu from './HelpMenu';

beforeEach(() => {
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});
afterEach(() => cleanup());

describe('HelpMenu', () => {
  it('opens the menu when the "?" button is clicked', () => {
    render(<HelpMenu onOpenShortcuts={() => {}} />);
    expect(screen.queryByText('Take the tour')).toBeNull();
    fireEvent.click(screen.getByLabelText('Help'));
    expect(screen.getByText('Take the tour')).toBeTruthy();
  });

  it('"Take the tour" starts the tour and closes the menu', () => {
    render(<HelpMenu onOpenShortcuts={() => {}} />);
    fireEvent.click(screen.getByLabelText('Help'));
    fireEvent.click(screen.getByText('Take the tour'));
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(screen.queryByText('Take the tour')).toBeNull();
  });

  it('"Keyboard shortcuts" calls onOpenShortcuts and closes the menu', () => {
    const onOpenShortcuts = vi.fn();
    render(<HelpMenu onOpenShortcuts={onOpenShortcuts} />);
    fireEvent.click(screen.getByLabelText('Help'));
    fireEvent.click(screen.getByText(/Keyboard shortcuts/));
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Keyboard shortcuts/)).toBeNull();
  });

  it('Esc closes the menu', () => {
    render(<HelpMenu onOpenShortcuts={() => {}} />);
    fireEvent.click(screen.getByLabelText('Help'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Take the tour')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/HelpMenu.test.tsx`
Expected: FAIL — cannot resolve `./HelpMenu`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/web/src/components/onboarding/HelpMenu.tsx
import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@stores/app-store';

import styles from './HelpMenu.module.css';

interface HelpMenuProps {
  onOpenShortcuts: () => void;
}

export default function HelpMenu({ onOpenShortcuts }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const startTour = useAppStore((s) => s.startTour);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const takeTour = () => {
    setOpen(false);
    startTour();
  };

  const openShortcuts = () => {
    setOpen(false);
    onOpenShortcuts();
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.qbtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Help"
      >
        ?
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" className={styles.item} role="menuitem" onClick={takeTour}>
            Take the tour
          </button>
          <button type="button" className={styles.item} role="menuitem" onClick={openShortcuts}>
            Keyboard shortcuts <kbd className={styles.kbd}>?</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
```

```css
/* packages/web/src/components/onboarding/HelpMenu.module.css */
.wrap {
  position: relative;
  display: inline-flex;
}

.qbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.qbtn:hover,
.qbtn[aria-expanded='true'] {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
}

.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 1050;
  min-width: 170px;
  padding: var(--space-1);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation: rise var(--transition-fast);
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-align: left;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.item:hover {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
}

.kbd {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  padding: 1px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/HelpMenu.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/onboarding/HelpMenu.tsx packages/web/src/components/onboarding/HelpMenu.module.css packages/web/src/components/onboarding/HelpMenu.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add help menu with tour + shortcuts entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Composition root + barrel

**Files:**
- Create: `packages/web/src/components/onboarding/Onboarding.tsx`
- Create: `packages/web/src/components/onboarding/index.ts`
- Test: `packages/web/src/components/onboarding/Onboarding.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/onboarding/Onboarding.test.tsx
/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from './index';

// jsdom has no window.matchMedia; Onboarding renders useIsMobile consumers.
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});
afterEach(() => cleanup());

describe('Onboarding', () => {
  it('shows the welcome modal on first run', () => {
    render(<Onboarding />);
    expect(screen.getByText('Welcome to oggregator')).toBeTruthy();
  });

  it('does not render the welcome modal once seen', () => {
    localStorage.setItem('onboardingSeen', '1');
    render(<Onboarding />);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/Onboarding.test.tsx`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/web/src/components/onboarding/Onboarding.tsx
import TourSpotlight from './TourSpotlight';
import WelcomeModal from './WelcomeModal';

export default function Onboarding() {
  return (
    <>
      <WelcomeModal />
      <TourSpotlight />
    </>
  );
}
```

```ts
// packages/web/src/components/onboarding/index.ts
export { default as Onboarding } from './Onboarding';
export { default as HelpMenu } from './HelpMenu';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oggregator/web exec vitest run src/components/onboarding/Onboarding.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/onboarding/Onboarding.tsx packages/web/src/components/onboarding/index.ts packages/web/src/components/onboarding/Onboarding.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): compose onboarding root + barrel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire into the app shell

**Files:**
- Modify: `packages/web/src/components/layout/AppShell.tsx`
- Modify: `packages/web/src/components/layout/TopBar.tsx`
- Modify: `packages/web/src/components/layout/AccountChip.tsx`

This task has no new unit test (rendering `TopBar`/`AppShell` in isolation pulls in TanStack Query and many children — out of proportion for four additive attributes and a prop). It is verified by typecheck, the full suite (Task 9), and the manual smoke check below. The `data-tour` ids are guarded by `tour-steps.test.ts` (Task 1) and exercised by `TourSpotlight.test.tsx` (Task 5).

- [ ] **Step 1: Add `data-tour` to `AccountChip` root**

In `packages/web/src/components/layout/AccountChip.tsx`, change the root `<div className={styles.wrap} ref={wrapRef}>` to:

```tsx
    <div className={styles.wrap} ref={wrapRef} data-tour="account">
```

- [ ] **Step 2: Update `TopBar` — props, imports, `data-tour`, and HelpMenu**

In `packages/web/src/components/layout/TopBar.tsx`:

Add the import (after the existing `./VenueStatusRow` import):

```tsx
import { HelpMenu } from '@components/onboarding';
```

Extend the props interface:

```tsx
interface TopBarProps {
  tabs: readonly Tab[];
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}

export default function TopBar({ tabs, onOpenPalette, onOpenShortcuts }: TopBarProps) {
```

Add `data-tour="views"` to the pill group:

```tsx
      <div className={styles.pillGroup} role="tablist" data-tour="views">
```

Add `data-tour="venue-status"` to the status wrapper, and render `HelpMenu` + `data-tour="asset-picker"` in the right cluster:

```tsx
      <div className={styles.right}>
        <ExpiryCountdown />
        <div className={styles.status} data-state={connectionState} data-tour="venue-status">
          <VenueStatusRow />
          <span className={styles.freshness}>
            <FreshnessLabel />
          </span>
        </div>
        <AccountChip />
        <HelpMenu onOpenShortcuts={onOpenShortcuts} />
        <button className={styles.cmdk} onClick={onOpenPalette} data-tour="asset-picker">
          ⌘K
        </button>
      </div>
```

- [ ] **Step 3: Update `AppShell` — mount Onboarding, pass `onOpenShortcuts`**

In `packages/web/src/components/layout/AppShell.tsx`:

Add the import (alongside the existing `@components/notifications` import):

```tsx
import { Onboarding } from '@components/onboarding';
```

Pass the shortcuts opener to `TopBar` (it already owns `setHelpOpen`):

```tsx
        <TopBar
          tabs={tabs}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenShortcuts={() => setHelpOpen(true)}
        />
        <SystemNotifications />
        <Onboarding />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual smoke check**

Run: `pnpm --filter @oggregator/web dev` (or the repo's usual dev command), open the app with a cleared `onboardingSeen` flag.
Expected: welcome modal appears → "Take the tour" spotlights Views → Asset picker → Venue status → Account → wrap-up; Esc/Skip end it; the "?" button opens the menu; "Keyboard shortcuts" opens the existing overlay. Then stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/layout/AppShell.tsx packages/web/src/components/layout/TopBar.tsx packages/web/src/components/layout/AccountChip.tsx
git commit -m "$(cat <<'EOF'
feat(web): wire onboarding into app shell, topbar, account chip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Full verification + formatting

**Files:** none (verification only)

- [ ] **Step 1: Format/lint the new + edited files**

Run:
```bash
pnpm --filter @oggregator/web exec biome check --write \
  src/components/onboarding src/lib/onboarding.ts src/lib/onboarding.test.ts \
  src/stores/app-store.ts src/stores/onboarding-slice.test.ts \
  src/components/layout/AppShell.tsx src/components/layout/TopBar.tsx src/components/layout/AccountChip.tsx
```
Expected: files formatted; **independently re-run** `pnpm --filter @oggregator/web exec biome check src/components/onboarding` and confirm "no errors" yourself (do not trust a prior "clean" claim). Resolve any `noDescendingSpecificity` CSS ordering warnings by moving base rules above tone/state-specific selectors.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oggregator/web typecheck`
Expected: no errors.

- [ ] **Step 3: Full web test suite**

Run: `pnpm --filter @oggregator/web test:run`
Expected: all tests pass, including the new onboarding tests. If any pre-existing test that renders the app/shell now trips over the first-run `WelcomeModal`, fix it by setting `localStorage.setItem('onboardingSeen', '1')` in that test's setup (the modal is intentionally first-run-gated) — do not weaken the modal.

- [ ] **Step 4: Commit any formatting fixups**

```bash
git add -A packages/web/src
git commit -m "$(cat <<'EOF'
style(web): apply biome formatting to onboarding files

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
(Skip this commit if `git status` shows nothing to commit.)

---

## Spec Coverage Check

- §4 experience flow → Tasks 4 (modal), 5 (tour), 6 (HelpMenu), 8 (wiring).
- §5 architecture / files → Tasks 1–8 create exactly the listed files.
- §6 tour steps + `data-tour` placement → Task 1 (config) + Task 8 (attributes).
- §7 store slice → Task 3.
- §8 re-entry wiring (`onOpenShortcuts`, untouched `?` path) → Task 8.
- §9 mobile (modal "Got it", no tour) → Task 4 (mobile branch) + Task 5 (`isMobile` → null).
- §10 motion/a11y → CSS `prefers-reduced-motion` + `role="dialog"`/focus/Esc in Tasks 4–6.
- §11 error handling (missing target, viewport clamp) → Task 5.
- §12 testing → tests in Tasks 1–7.
- §13 file-change summary → matches Tasks 1–8.
- §14 out of scope → nothing in the plan adds checklist/tab-switching/server-driven/mobile-tour.
