# Onboarding — Welcome Modal + Guided Tour — Design

**Date:** 2026-05-26
**Status:** Approved (design); implementation plan included
**Branch:** `feat/onboarding-tour` (off `main`; workstream ① system-status already merged via PR #13)
**Scope:** Workstream ② of "formalize the app" — intros & tutorials. System Status & Announcements (workstream ①) shipped separately and is **not** revisited here.

## 1. Goal

Give first-time users a fast, on-theme orientation to oggregator, and a persistent way to re-open help later:

- **Intro** — a first-run welcome modal explaining what oggregator is.
- **Tutorial** — an optional ~60s guided spotlight tour over the *real* persistent chrome (views, asset picker, venue status, account).
- **Re-entry** — a visible "?" button so help is discoverable (today it's keyboard-only via `?`).

Continues the existing terminal aesthetic (IBM Plex Mono, `#0a0a0a` base, `--accent-primary` teal, semantic tokens) with **minimal, clean motion** (fade/slide, ~200ms) and a `prefers-reduced-motion` fallback.

## 2. Decisions locked during brainstorming

| # | Decision | Choice |
|---|---|---|
| Experience | What shape the onboarding takes | **B — Welcome modal + guided spotlight tour** (intro + tutorial) |
| Tour engine | How the spotlight is built | **Hand-rolled, zero deps** (no `react-joyride`/`shepherd`) |
| Tour steps | What the tour covers | **Keep as-is — chrome-only**, 5 steps (no tab-switching) |
| Re-entry | How help is re-opened after first run | **"?" button in TopBar → small HelpMenu** (Take the tour · Keyboard shortcuts) |
| Mobile | Behavior < 768px | **Modal everywhere, tour desktop-only** |
| Motion / a11y | Animation + accessibility character | **Minimal fade/slide ~200ms**, `prefers-reduced-motion`, `role="dialog"` + focus management + Esc |

## 3. Load-bearing constraint — additive UI only; do not touch WS or server

This feature is **pure client-side UI chrome**. It is even more isolated than workstream ①:

- It adds **no** server, protocol, or REST/WS code. It does **not** read `feedStatus`, open sockets, or change subscription/transport/health code.
- The "Venue status" tour step merely *points at* the existing `VenueStatusRow` visually (via a `data-tour` attribute on its wrapper) — it reads nothing from feed state.
- All edits to existing files are **additive** (new attributes, one new prop, one new mounted component). No existing behavior — including the keyboard `?` → `ShortcutHelp` path — is modified or removed.

Any task that appears to require a WS-layer, server, or protocol change is out of scope and must stop and surface the conflict.

## 4. Experience flow

```text
First visit (no localStorage flag)
  └─► WelcomeModal (auto)
        ├─ "Take the tour"  ─► startTour()            (desktop only; hidden < 768px)
        └─ "Skip" / "Got it" ─► markOnboardingSeen()  (mobile shows "Got it" only)

Guided tour (desktop ≥ 768px)
  step 1 Views ─► step 2 Asset picker ─► step 3 Venue status ─► step 4 Account ─► step 5 Wrap-up
  per step: dimmed backdrop + highlight ring on target + tooltip (title, body, step dots, Back / Next / Skip)
  Esc or Skip ends the tour at any point; Next on the last step ends it.

Re-entry (any time, desktop)
  TopBar "?" button ─► HelpMenu popover
        ├─ "Take the tour"      ─► startTour()
        └─ "Keyboard shortcuts" ─► opens existing ShortcutHelp overlay (unchanged)
```

First run is tracked by a single `localStorage` flag. The welcome modal is shown once; the tour is always re-openable from the "?" menu.

## 5. Architecture

New directory `packages/web/src/components/onboarding/` (peer to `notifications/`), each component with its own `.module.css`:

| File | Role |
|---|---|
| `WelcomeModal.tsx` | First-run intro modal. `role="dialog" aria-modal`, focus trap, Esc to close. "Take the tour" (desktop) / "Skip"; mobile renders "Got it" only. Reuses the `SessionNotice` backdrop/panel pattern + `fadeIn`/`rise` keyframes. |
| `TourSpotlight.tsx` | The guided tour overlay. Reads `tourActive`/`tourStep` from the store; resolves the current step's target via `document.querySelector('[data-tour="<id>"]')` + `getBoundingClientRect()`; renders dimmed backdrop, highlight ring, and a clamped tooltip. Desktop-only. |
| `HelpMenu.tsx` | The "?" popover menu: "Take the tour" → `startTour()`; "Keyboard shortcuts" → `onOpenShortcuts()`. Local open state; closes on outside-click / Esc / selection. |
| `Onboarding.tsx` | Composition root mounted once in `AppShell`. Renders `<WelcomeModal/>` (first-run gated) + `<TourSpotlight/>`. |
| `tour-steps.ts` | Static config: ordered `TourStep[]` (target `data-tour` id, title, body). Single source for step count / dots. |
| `index.ts` | Barrel: exports `Onboarding`, `HelpMenu`. |

Plus `packages/web/src/lib/onboarding.ts` — first-run helpers (`hasSeenOnboarding()` / `markOnboardingSeen()`) over `localStorage`, mirroring the existing `readStorage` / dismissed-ids pattern from system-status.

**Targeting model:** steps reference stable `data-tour` attributes already present in the DOM. The spotlight measures the live element each step (and on resize/scroll), so it tracks the real chrome without hard-coded coordinates.

## 6. Tour steps (chrome-only, 5 steps)

Mirrors the approved mockup. Row 0 below is the WelcomeModal and is **not** part of `tour-steps.ts`. The tour proper is the **5 entries** rows 1–5 (0-based store indices 0–4): rows 1–4 spotlight real targets; row 5 is a centered wrap-up tooltip with no target. Step dots / "Step N of M" count these 5.

| # | Target (`data-tour`) | Title | Body |
|---|---|---|---|
| 0 | — (WelcomeModal) | Welcome to oggregator | "Cross-venue crypto options on one screen. Compare quotes, vol, and Greeks across Deribit, OKX, Bybit and more." → [Take the tour] / [Skip] |
| 1 | `views` | Views | "Switch views — option chain, vol surface, GEX, flow, paper trading, portfolio." |
| 2 | `asset-picker` | Asset picker (⌘K) | "Pick your underlying. Hit ⌘K or / anytime to switch." |
| 3 | `venue-status` | Venue status | "Live feed health per venue. If it degrades, a status banner tells you what's happening." |
| 4 | `account` | Account | "Connect paper trading and track a live portfolio." |
| 5 | — (centered) | That's the tour | "Reopen it anytime from the ? menu. Press ? for shortcuts." |

`data-tour` placement (all additive attributes):
- `views` → TopBar `.pillGroup` (the `role="tablist"` div).
- `asset-picker` → TopBar `.cmdk` ⌘K button.
- `venue-status` → TopBar `.status` wrapper div (so `VenueStatusRow.tsx` itself is **not** touched).
- `account` → `AccountChip` root.

## 7. Client state — `app-store` (UI state, alongside `feedStatus` / `sessionNotice` / `announcement`)

Add an `onboarding` slice — tour runtime state only (the welcome-modal first-run flag lives in `localStorage`, not the store):

- `tourActive: boolean`
- `tourStep: number` (0-based index into `tour-steps.ts`)
- `startTour()` → `tourActive = true`, `tourStep = 0`
- `endTour()` → `tourActive = false`
- `nextStep()` → advance, clamped; advancing past the last step calls `endTour()`
- `prevStep()` → decrement, clamped at 0

The HelpMenu's open state and the WelcomeModal's visibility are **local component state**, not store state (transient, single-owner). The store holds only the tour because it is driven from multiple entry points (WelcomeModal *and* HelpMenu) and consumed by `TourSpotlight`.

## 8. Re-entry wiring (minimal, preserves the existing `?` path)

`ShortcutHelp` stays owned by `AppShell` (`helpOpen` local state, opened by the keyboard `?` handler) — **unchanged**. To let the HelpMenu open it without refactoring that path:

- `AppShell` passes an additive `onOpenShortcuts={() => setHelpOpen(true)}` callback to `TopBar`.
- `TopBar` renders the "?" button next to ⌘K and the `HelpMenu` popover, forwarding `onOpenShortcuts`.
- "Keyboard shortcuts" → `onOpenShortcuts()`; "Take the tour" → store `startTour()`.

The keyboard `?` shortcut, `ShortcutHelp`, and its content are not modified.

## 9. Mobile behavior (< 768px, via `useIsMobile`)

- **WelcomeModal:** shown, but renders a single **"Got it"** button (no "Take the tour").
- **Tour:** never starts on mobile (`startTour()` is a no-op / not offered; `TourSpotlight` renders nothing when `isMobile`).
- **"?" button + HelpMenu:** desktop chrome; not surfaced on mobile (mobile uses `MobileNav`/`MobileToolbar`, and the tour/keyboard-shortcuts entries are desktop-oriented).

## 10. Motion & accessibility [default]

- **Motion:** WelcomeModal fade + slight rise; tooltip fade/slide ~200ms via `--transition-base`; highlight ring transitions position between steps. Under `@media (prefers-reduced-motion: reduce)`, drop transforms — opacity-only / instant.
- **A11y:** WelcomeModal is `role="dialog" aria-modal="true"` with focus moved into it on open, a focus trap, and focus restored on close. Esc closes the modal, the HelpMenu, and ends the tour. Tooltip controls are real `<button>`s; step dots are decorative with an accessible "Step N of M" label.

## 11. Error handling [default]

- **Missing target element** (`querySelector` returns null): skip to the next step; if none resolve, end the tour gracefully (never render a spotlight with no anchor).
- **Tooltip overflow:** clamp the tooltip to the viewport so it never renders off-screen near edge targets.
- **Layout shift / resize / scroll while active:** re-measure the current target's rect so the ring/tooltip stay aligned.
- **First-run flag unreadable** (private mode / disabled storage): treat as "not seen" but never throw; failing to persist just means the modal may reappear — acceptable, no crash.

## 12. Testing (Vitest + Testing Library; `cleanup()` in `afterEach` — `globals: false`)

- `lib/onboarding.ts`: first-run true when no flag; `markOnboardingSeen()` persists; reads tolerate storage errors.
- `WelcomeModal`: renders on first run, hidden once seen; "Take the tour" → `startTour` + marks seen; "Skip"/"Got it" → marks seen + closes; mobile variant shows only "Got it"; focus moves in; Esc closes.
- `TourSpotlight`: advances/goes back through steps; resolves targets via `data-tour`; missing target skips → ends; Esc and Skip end; last-step Next ends; wrap-up (no-target) step renders centered; `prefers-reduced-motion` disables transforms; renders nothing when `isMobile`.
- `HelpMenu`: "?" opens; "Take the tour" → `startTour`; "Keyboard shortcuts" → `onOpenShortcuts`; Esc / outside-click close.
- `app-store` onboarding slice: `startTour`/`endTour`/`nextStep`/`prevStep` with clamping + auto-end past last step.
- Regression: `data-tour` attributes present on the four TopBar/AccountChip targets.

## 13. File-change summary

**New**
- `packages/web/src/components/onboarding/{WelcomeModal,TourSpotlight,HelpMenu,Onboarding}.tsx` (+ `.module.css`)
- `packages/web/src/components/onboarding/tour-steps.ts`
- `packages/web/src/components/onboarding/index.ts`
- `packages/web/src/lib/onboarding.ts`
- Tests alongside each.

**Edited (additive / minimal)**
- `packages/web/src/stores/app-store.ts` — add `onboarding` slice (tour state + actions).
- `packages/web/src/components/layout/AppShell.tsx` — mount `<Onboarding/>`; pass `onOpenShortcuts` to `TopBar`. (`helpOpen` / `ShortcutHelp` / keyboard `?` left as-is.)
- `packages/web/src/components/layout/TopBar.tsx` — add `data-tour` on pill group / ⌘K button / status div; render "?" button + `HelpMenu`; accept additive `onOpenShortcuts` prop.
- `packages/web/src/components/layout/AccountChip.tsx` — add `data-tour="account"`.

**Explicitly NOT touched:** `VenueStatusRow.tsx`, `ShortcutHelp.tsx`, the keyboard `?` handler, any WS / server / protocol code. No `tsconfig.json` / `vite.config.ts` change needed (`@components/onboarding` resolves under the existing `@components` alias).

## 14. Out of scope (YAGNI)

- Persistent "Learn" checklist panel (brainstorm approach C).
- Tab-switching / view-changing tour steps (chrome-only by decision).
- Coachmarks / per-feature inline hints.
- Server-driven or remotely-configured tour content.
- Mobile guided tour.
- Re-onboarding prompts / "what's new" changelogs.
