# Landing Page Upgrade (Direction B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `apps/landing` into a professional conversion page — hero animation byte-identical mechanically — per the approved spec at `docs/superpowers/specs/2026-06-12-landing-pro-upgrade-design.md`.

**Architecture:** Four sequential phases on branch `feat/landing-pro-upgrade`, each cut as its own PR: (1) hero defects + funnel + logos + lead hardening, (2) SEO/metadata/a11y, (3) narrative re-sequence + trust layer, (4) orphan deletion. Every copy change lands with its test update in the same commit. The hero theater's scroll math, camera poses, and surface transforms are never edited — only `HeroScene` fractions/contents and fallback layers.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, framer-motion 12, three.js/@react-three/fiber, zod 4, Vitest 4 + Testing Library (jsdom, jest-dom IS available in this app, vitest `globals: true`).

---

## Ground rules (read before any task)

- All paths below are relative to `apps/landing/` unless rooted at `docs/` or absolute.
- Commands run from the repo root `/home/aladhimainwin/OAgrr-aladhi`:
  - Tests: `pnpm --filter @oggregator/landing test:run`
  - Typecheck: `pnpm --filter @oggregator/landing typecheck`
  - Lint: `pnpm --filter @oggregator/landing lint`
- **Hero preservation contract** (do not touch in any task): the `240vh→240svh` section height is the ONLY allowed edit to the hero container; `sticky top-0` stage, `useScroll` offsets `['start start','end end']`, the `scrollProgress` MotionValue bridge, `surfaceScale/surfaceX/surfaceOpacity` transforms (`HeroTerminalSection.tsx:98-100`), and everything in `TheaterSurfaceMesh.tsx` stay byte-identical.
- **Sticky-pin rule:** `HeroTerminalSection`, `TerminalShowcase`, and `FaqSection` (internal `lg:sticky` column) must never gain a transformed ancestor (no `SectionReveal` wrapper).
- This environment intermittently auto-commits/pushes. Run `git status && git log --oneline -1` before and after each task; never claim committed/pushed without checking.
- After each task: run the full test suite (it is small/fast), then commit with the message given in the task.

---

# PHASE 1 — PR 1: Hero defects, funnel, logos, lead hardening

### Task 1: TopTicker — honest tape + pause control

**Files:**
- Modify: `components/TopTicker.tsx`
- Modify: `components/top-ticker.test.tsx`
- Modify: `components/hero-shell.test.tsx` (ticker assertions only)

- [ ] **Step 1: Rewrite the ticker tests to pin the new contract**

Replace the whole body of `components/top-ticker.test.tsx` with:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import { TopTicker } from './TopTicker';

describe('TopTicker', () => {
  it('renders live BTC/ETH spot when provided', () => {
    render(
      <TopTicker
        spots={{
          BTC: { priceLabel: '$80.0K', changeLabel: '+3.0%' },
          ETH: { priceLabel: '$2.0K', changeLabel: '-1.0%' },
        }}
      />,
    );

    expect(screen.getAllByText('BTC $80.0K +3.0%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ETH $2.0K -1.0%').length).toBeGreaterThan(0);
  });

  it('never renders hardcoded prices, sponsored slots, or internal jargon', () => {
    render(<TopTicker />);

    expect(screen.queryByText(/81\.3K/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sponsored/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private feed/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Deribit · OKX · Binance · Bybit/).length).toBeGreaterThan(0);
  });

  it('exposes a pause control for the marquee', () => {
    render(<TopTicker />);

    const button = screen.getByRole('button', { name: /pause ticker/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
```

In `components/hero-shell.test.tsx`, DELETE the two ticker assertions (lines 17-22, the `coincall low fees` and `thalex private feed` expectations) and add in their place:

```tsx
    expect(screen.getAllByText(/Deribit · OKX · Binance · Bybit/).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — `top-ticker.test.tsx` (no pause button, sponsored text present) and `hero-shell.test.tsx` (venue line not found).

- [ ] **Step 3: Rewrite TopTicker**

Replace the whole body of `components/TopTicker.tsx` with:

```tsx
'use client';

import { useState } from 'react';

type SpotQuote = { priceLabel: string; changeLabel: string };
export type TickerSpots = Partial<Record<'BTC' | 'ETH', SpotQuote>>;

type TapeItem = { label: string; value: string };

// Live spot rows only render when real snapshot data exists — never a fake price.
function buildTapeItems(spots: TickerSpots | undefined): TapeItem[] {
  const items: TapeItem[] = [
    {
      label: 'Venues',
      value: 'Deribit · OKX · Binance · Bybit · Thalex · Derive · Coincall · Gate.io',
    },
  ];

  if (spots?.BTC) {
    items.push({ label: 'Spot', value: `BTC ${spots.BTC.priceLabel} ${spots.BTC.changeLabel}` });
  }
  if (spots?.ETH) {
    items.push({ label: 'Spot', value: `ETH ${spots.ETH.priceLabel} ${spots.ETH.changeLabel}` });
  }

  items.push({
    label: 'Coverage',
    value: 'Options chains · vol surfaces · flow tape · routing',
  });

  return items;
}

function TapeRun({ items, hidden }: { items: TapeItem[]; hidden?: boolean }) {
  return (
    <div aria-hidden={hidden} className="flex min-w-max items-center gap-2">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="flex items-center gap-2 rounded-full border border-white/8 bg-[#0f1216] px-3 py-1.5"
        >
          <span className="text-zinc-500">{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TopTicker({ spots }: { spots?: TickerSpots }) {
  const items = buildTapeItems(spots);
  const [paused, setPaused] = useState(false);

  return (
    <div className="overflow-hidden border-b border-[color:var(--landing-border)] bg-[rgba(10,10,10,0.92)] backdrop-blur-xl">
      <div className="landing-container flex items-center gap-3 px-4 py-2 sm:px-6">
        <div className="landing-feed-tape min-w-0 flex-1 overflow-hidden">
          <div
            className="landing-feed-tape-track flex min-w-max items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-300"
            style={{ animationPlayState: paused ? 'paused' : 'running' }}
          >
            <TapeRun items={items} />
            <TapeRun items={items} hidden />
          </div>
        </div>
        <button
          type="button"
          aria-label="Pause ticker"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
          className="shrink-0 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition hover:text-zinc-200"
        >
          {paused ? '▶' : '⏸'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add apps/landing/components/TopTicker.tsx apps/landing/components/top-ticker.test.tsx apps/landing/components/hero-shell.test.tsx
git commit -m "feat(landing): honest ticker tape — drop fake prices/sponsored slot, add pause control"
```

---

### Task 2: Hero scene re-beat + funnel relabel

The pitch (h1 + subheadline + CTAs) becomes scene 1 (first viewport); the connoisseur caption + venue proof becomes scene 2. Nav "Launch terminal" → "Sign in"; hero secondary → `#showcase`; header "Terminal" link → `#showcase`. **The theater math is untouched.**

**Files:**
- Modify: `lib/copy.ts`
- Modify: `components/HeroTerminalSection.tsx` (scene JSX + fractions only)
- Modify: `components/LandingHeader.tsx` (one href)
- Modify: `components/hero-shell.test.tsx`

- [ ] **Step 1: Update hero-shell tests to pin the new funnel**

In `components/hero-shell.test.tsx`, replace the `see the terminal` and `launch terminal` assertions with:

```tsx
    expect(screen.getByRole('link', { name: /see the terminal/i })).toHaveAttribute(
      'href',
      '#showcase',
    );
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute(
      'href',
      'https://app.oggregator.xyz',
    );
    expect(screen.getByRole('link', { name: /^terminal$/i })).toHaveAttribute(
      'href',
      '#showcase',
    );
```

(The existing `getByRole('link', { name: /^terminal$/i })` presence assertion is replaced by the href form above.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — `hero-shell.test.tsx` (`Sign in` link absent, hrefs wrong).

- [ ] **Step 3: Update copy.ts**

In `lib/copy.ts`:
- `nav.launch`: `'Launch terminal'` → `'Sign in'`
- In the `hero` block: delete `proofPoints: ['Deribit', 'OKX', 'Binance', 'Bybit'],` (scene 2 will render all 8 venue names from `venues` instead) and add a `surfaceNote` line so the block reads:

```ts
  hero: {
    eyebrow: 'Cross-venue options terminal',
    headline: 'One terminal. Every venue.',
    subheadline:
      'Trade options across Deribit, OKX, Binance, Bybit, Thalex, Derive, Coincall, and Gate.io — from a single surface.',
    primaryCta: 'Request Access',
    secondaryCta: 'See the terminal',
    surfaceNote:
      'a real volatility surface — not a screenshot. tilt, skew, term and venue context, recalculated tick-by-tick.',
    proofLabel: 'Connected venues',
  },
```

- [ ] **Step 4: Swap the hero scenes**

In `components/HeroTerminalSection.tsx`:

Add to the imports:

```tsx
import { venues } from "@/lib/demo-data";
```

Replace the two `<HeroScene>` blocks (currently lines 213-258) with — note scene 1 now carries `pointerEvents` and the pitch; scene 2 starts at 0.45 (was 0.4) so there is no simultaneous-full-opacity window:

```tsx
        <HeroScene
          scrollYProgress={scrollYProgress}
          start={0}
          end={0.42}
          staticVisible={staticMode}
          pointerEvents
        >
          <div className="max-w-3xl">
            <span className="landing-chip">
              <span className="h-2 w-2 rounded-full bg-[var(--landing-accent)] shadow-[0_0_18px_rgba(237,244,246,0.55)]" />
              {landingCopy.hero.eyebrow}
            </span>
            <h1 className="landing-display-title mt-7 max-w-[14ch] text-[clamp(3.4rem,8.4vw,7.6rem)] [text-wrap:balance]">
              {landingCopy.hero.headline}
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--landing-muted-strong)] sm:text-xl">
              {landingCopy.hero.subheadline}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a href="#access" className="landing-button-primary">
                {landingCopy.hero.primaryCta}
              </a>
              <a href="#showcase" className="landing-button-secondary">
                {landingCopy.hero.secondaryCta}
              </a>
            </div>
          </div>
        </HeroScene>

        {!staticMode && (
          <HeroScene
            scrollYProgress={scrollYProgress}
            start={0.45}
            end={1}
            staticVisible={false}
          >
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-3 border border-white/15 bg-white/[0.03] px-4 py-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.36em] text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--landing-accent)] shadow-[0_0_12px_rgba(237,244,246,0.55)]" />
                surface.live · tick-by-tick
              </span>
              <p className="mt-12 max-w-xl font-[var(--font-mono)] text-[11px] uppercase leading-6 tracking-[0.32em] text-zinc-400">
                {landingCopy.hero.surfaceNote}
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.3em] text-zinc-400">
                <span className="text-zinc-500">{landingCopy.hero.proofLabel}</span>
                {venues.map((venue) => (
                  <span key={venue.slug}>{venue.name}</span>
                ))}
              </div>
            </div>
          </HeroScene>
        )}
```

Note: `appUrl` is no longer used in this file — remove the `import { appUrl } from "@/lib/links";` line.

- [ ] **Step 5: Repoint the header Terminal link**

In `components/LandingHeader.tsx` line 16, change `href="#how-it-works"` → `href="#showcase"` (the label `nav.workflow` = "Terminal" finally matches its destination; `#how-it-works` remains reachable via footer until Task 17 and via scroll).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS. (`page.test.tsx` h1 assertion still passes — the h1 just moved scenes.)

- [ ] **Step 7: Commit**

```bash
git add apps/landing/lib/copy.ts apps/landing/components/HeroTerminalSection.tsx apps/landing/components/LandingHeader.tsx apps/landing/components/hero-shell.test.tsx
git commit -m "feat(landing): hero pitch in first viewport + gated-app funnel (Sign in / #showcase)"
```

---

### Task 3: HeroScene inertness + reduced-motion fix + svh units

**Files:**
- Modify: `components/HeroTerminalSection.tsx` (`HeroScene` + container classes only)
- Create: `components/hero-reduced-motion.test.tsx`
- Modify: `components/hero-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `components/hero-reduced-motion.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import { HeroTerminalSection } from './HeroTerminalSection';

describe('HeroTerminalSection (reduced motion)', () => {
  it('renders a visible pitch — h1 and CTAs — instead of collapsing', () => {
    render(<HeroTerminalSection />);

    expect(
      screen.getByRole('heading', { level: 1, name: /one terminal\. every venue\./i }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /request access/i })).toBeVisible();
    // The late beat must not render at all in static mode (no superimposed text).
    expect(screen.queryByText(/not a screenshot/i)).not.toBeInTheDocument();
  });
});
```

Append to the `describe` block in `components/hero-shell.test.tsx`:

```tsx
  it('keeps the late hero beat invisible AND inert at load', () => {
    render(<HeroTerminalSection />);

    // Scene 1 (the pitch) is visible at progress 0…
    expect(screen.getAllByRole('link', { name: /request access/i })[0]).toBeVisible();
    // …scene 2 is hidden — visibility:hidden, not just opacity 0, so it can't be clicked or focused.
    expect(screen.getByText(/not a screenshot/i)).not.toBeVisible();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — reduced-motion test (h1 inside a zero-height wrapper may render but the late beat doesn't exist yet in static mode — if Task 2 made it conditional this may pass; the inertness test MUST fail: scene 2 has opacity 0 but `visibility` is not set, so `toBeVisible()` (which jest-dom derives from visibility/display) still sees it as visible).

- [ ] **Step 3: Implement**

In `components/HeroTerminalSection.tsx`:

(a) In `HeroScene`, after the `opacity` transform, add a visibility transform and apply it:

```tsx
  const visibility = useTransform(opacity, (value) =>
    value < 0.01 ? ("hidden" as const) : ("visible" as const),
  );
```

and change the style prop:

```tsx
      style={staticVisible ? { opacity: 1 } : { opacity, y, visibility }}
```

(b) Fix the static-mode container (line ~111-118). The section style becomes:

```tsx
      style={{ height: staticMode ? "auto" : "240svh" }}
```

and the inner wrapper className becomes:

```tsx
        className={
          staticMode
            ? "relative min-h-svh w-full overflow-hidden bg-[#080b0d]"
            : "sticky top-0 h-svh w-full overflow-hidden bg-[#080b0d]"
        }
```

(`h-screen`→`h-svh` and `240vh`→`240svh` fix mobile dynamic-toolbar jank; the scroll choreography is unchanged. `min-h-svh` gives the static wrapper real height so its absolutely-positioned children render.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/components/HeroTerminalSection.tsx apps/landing/components/hero-reduced-motion.test.tsx apps/landing/components/hero-shell.test.tsx
git commit -m "fix(landing): hero scenes inert when invisible; reduced-motion hero no longer zero-height; svh units"
```

---

### Task 4: Degraded-path poster (deliberate SurfaceFallback revival)

Replace the two-blob gradient in all degraded paths (dynamic-import loading, no-WebGL, reduced-motion canvas branch) with a full-bleed contour poster.

**Files:**
- Modify: `components/three/SurfaceFallback.tsx` (full rewrite — its only other consumer, `VolSurfaceCanvas`, is orphaned and deleted in Task 23)
- Modify: `components/HeroTerminalSection.tsx` (dynamic `loading` only)
- Modify: `components/three/VolSurfaceTheaterCanvas.tsx` (the `!canRenderCanvas` branch only)

- [ ] **Step 1: Rewrite SurfaceFallback as a full-bleed poster**

Replace the whole body of `components/three/SurfaceFallback.tsx` with:

```tsx
// Full-bleed static poster for every degraded hero path: dynamic-import loading,
// no-WebGL clients, and reduced motion. Colors mirror the shader's thermal ramp.
export function SurfaceFallback() {
  const verticalGuides = [80, 160, 240, 320, 400, 480, 560];
  const horizontalGuides = [90, 150, 210, 270, 330];
  const contourRows = [
    "70,298 142,264 216,242 288,218 364,196 444,166 522,140 584,126",
    "70,320 142,286 216,262 288,240 364,214 444,184 522,156 584,140",
    "70,344 142,308 216,286 288,262 364,238 444,208 522,182 584,166",
    "70,366 142,334 216,310 288,290 364,266 444,240 522,216 584,200",
  ];

  return (
    <div aria-hidden className="absolute inset-0 bg-[#080b0d]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_55%,_rgba(30,64,175,0.25),_transparent_45%),_radial-gradient(circle_at_72%_40%,_rgba(234,88,12,0.18),_transparent_45%)]" />

      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 640 420"
      >
        <defs>
          <linearGradient id="surface-fill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(251,146,60,0.28)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0.05)" />
          </linearGradient>
        </defs>

        {horizontalGuides.map((y) => (
          <line
            key={`h-${y}`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            x1="40"
            x2="600"
            y1={y}
            y2={y}
          />
        ))}

        {verticalGuides.map((x) => (
          <line
            key={`v-${x}`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            x1={x}
            x2={x}
            y1="60"
            y2="400"
          />
        ))}

        <path
          d="M70 366 L142 334 L216 310 L288 290 L364 266 L444 240 L522 216 L584 200 L584 400 L70 400 Z"
          fill="url(#surface-fill)"
        />

        {contourRows.map((row, index) => (
          <polyline
            key={row}
            fill="none"
            points={row}
            stroke="#fb923c"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={1 - index * 0.18}
            strokeWidth="2.2"
          />
        ))}

        <polyline
          fill="none"
          points="70,278 142,238 216,208 288,176 364,142 444,116 522,96 584,92"
          stroke="rgba(96,165,250,0.45)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into both degraded paths**

In `components/HeroTerminalSection.tsx`, add the import:

```tsx
import { SurfaceFallback } from "./three/SurfaceFallback";
```

and replace the dynamic `loading` option (currently the radial-gradient div, lines ~21-27) with:

```tsx
    loading: () => <SurfaceFallback />,
```

In `components/three/VolSurfaceTheaterCanvas.tsx`, add the import:

```tsx
import { SurfaceFallback } from "./SurfaceFallback";
```

and replace the `!canRenderCanvas` branch (lines 56-63) with:

```tsx
  if (!canRenderCanvas) {
    return <SurfaceFallback />;
  }
```

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck`
Expected: PASS. (`vol-surface-showcase.test.tsx` still passes — it asserts `VolSurfaceShowcase`'s own text, not the fallback's.)

- [ ] **Step 4: Commit**

```bash
git add apps/landing/components/three/SurfaceFallback.tsx apps/landing/components/three/VolSurfaceTheaterCanvas.tsx apps/landing/components/HeroTerminalSection.tsx
git commit -m "feat(landing): contour poster for all degraded hero paths (SurfaceFallback revival)"
```

---

### Task 5: Venue logos — explicit paths, production-safe

**Files:**
- Modify: `lib/demo-data.ts` (`Venue` interface + `venues` array)
- Modify: `components/VenueStrip.tsx`
- Create: `components/venue-strip.test.tsx`
- Rename: `public/venues/Thalex.svg` → `public/venues/thalex.svg`

- [ ] **Step 1: Write the failing test**

Create `components/venue-strip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

import { venues } from '@/lib/demo-data';
import { VenueStrip } from './VenueStrip';

describe('VenueStrip', () => {
  it('renders one logo per venue from explicit logo paths', () => {
    render(<VenueStrip />);

    expect(venues).toHaveLength(8);
    for (const venue of venues) {
      expect(screen.getByAltText(venue.name)).toHaveAttribute('src', venue.logo);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — `venue.logo` is undefined / src mismatch.

- [ ] **Step 3: Add explicit logo paths to the data**

In `lib/demo-data.ts`, change the `Venue` interface and `venues` array:

```ts
export interface Venue {
  slug: string;
  name: string;
  /** Explicit asset path — never derived from the slug, so casing/extension can't 404. */
  logo: string;
}
```

```ts
export const venues: Venue[] = [
  { slug: 'deribit', name: 'Deribit', logo: '/venues/deribit.svg' },
  { slug: 'okx', name: 'OKX', logo: '/venues/okx.svg' },
  { slug: 'binance', name: 'Binance', logo: '/venues/binance.svg' },
  { slug: 'bybit', name: 'Bybit', logo: '/venues/bybit.svg' },
  { slug: 'thalex', name: 'Thalex', logo: '/venues/thalex.svg' },
  { slug: 'derive', name: 'Derive', logo: '/venues/derive.svg' },
  { slug: 'coincall', name: 'Coincall', logo: '/venues/coincall.png' },
  { slug: 'gate', name: 'Gate.io', logo: '/venues/gateio.svg' },
] as const;
```

- [ ] **Step 4: Rename the asset and verify git tracked it**

```bash
git mv apps/landing/public/venues/Thalex.svg apps/landing/public/venues/thalex.svg
git status --short   # must show the rename (R), not an untracked copy
```

- [ ] **Step 5: Consume the explicit path in VenueStrip**

In `components/VenueStrip.tsx`, replace `VenueLogo` and its call site:

```tsx
import type { Venue } from "@/lib/demo-data";

function VenueLogo({ venue }: { venue: Venue }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <span className="font-[var(--font-heading)] text-base uppercase tracking-[0.18em] text-[var(--landing-muted-strong)] transition group-hover:text-[var(--landing-text-strong)]">
        {venue.name}
      </span>
    );
  }

  return (
    <img
      src={venue.logo}
      alt={venue.name}
      width={120}
      height={28}
      onError={() => setErrored(true)}
      className="h-7 w-auto opacity-70 grayscale brightness-200 transition group-hover:opacity-100 sm:h-8"
    />
  );
}
```

(Drop the now-dead `// eslint-disable-next-line @next/next/no-img-element` comment — this repo lints with biome.) Update the call site: `<VenueLogo venue={venue} />`.

- [ ] **Step 6: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck`
Expected: PASS.

```bash
git add -A apps/landing/public/venues apps/landing/lib/demo-data.ts apps/landing/components/VenueStrip.tsx apps/landing/components/venue-strip.test.tsx
git commit -m "fix(landing): venue logos use explicit asset paths — kills the 3/8 production 404s"
```

---

### Task 6: Lead pipeline hardening

`type=email`, honeypot, dedicated submit copy, richer success state, contact fallback; route gains honeypot fake-success + per-IP rate limit; file fallback moves to `/tmp`.

**Files:**
- Modify: `lib/links.ts`, `lib/lead-store.ts`, `lib/copy.ts` (cta block), `components/LeadCaptureSection.tsx`, `app/api/leads/route.ts`
- Modify: `app/api/leads/route.test.ts`, `components/lead-capture.test.tsx`

- [ ] **Step 1: Extend the route tests**

In `app/api/leads/route.test.ts`, first add a unique IP to every EXISTING request so the new rate limiter never trips across tests — in each existing `new Request(...)` call add to `headers`:

```ts
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.<N>' },
```

using `<N>` = 1, 2, 3, 4 for the four existing tests. Then append two tests inside the `describe`:

```ts
  it('fakes success and stores nothing when the honeypot is filled', async () => {
    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bot@example.com',
        source: 'landing-hero',
        website: 'http://spam.example',
      }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.5' },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(readFile(leadFilePath, 'utf8')).rejects.toThrow();
  });

  it('rate limits a single IP after 5 requests in the window', async () => {
    const makeRequest = () =>
      new Request('http://localhost/api/leads', {
        method: 'POST',
        body: JSON.stringify({ email: 'desk@example.com', source: 'landing-hero' }),
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.6' },
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await POST(makeRequest())).status).toBe(201);
    }
    expect((await POST(makeRequest())).status).toBe(429);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — honeypot is persisted (400 from schema, actually: unknown key is stripped by zod, so it currently persists → file exists → first new test fails) and no 429.

- [ ] **Step 3: Harden the route**

Replace the whole body of `app/api/leads/route.ts` with:

```ts
import { NextResponse } from 'next/server';

import { leadSchema } from '@/lib/lead-schema';
import { persistLead } from '@/lib/lead-store';

export const runtime = 'nodejs';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
// Per-instance, in-memory. Good enough as a first abuse gate; not shared across instances.
const hits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function isHoneypotHit(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const website = (payload as { website?: unknown }).website;
  return typeof website === 'string' && website.length > 0;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many requests.' }, { status: 429 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  // Bots fill the hidden "website" field — pretend success, store nothing.
  if (isHoneypotHit(payload)) {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const parsed = leadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid payload.' }, { status: 400 });
  }

  try {
    await persistLead(parsed.data);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Unable to record your request.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
```

- [ ] **Step 4: Move the file fallback off the read-only bundle path**

In `lib/lead-store.ts`, replace the path setup (lines 1-9) with:

```ts
import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LeadInput } from './lead-schema';

// /tmp is the only writable filesystem on Vercel. This keeps the fallback from
// turning the page's only conversion into a 500 — it is best-effort, NOT durable;
// the durable path is the core API via LANDING_API_BASE_URL.
const defaultDataFile = path.join(tmpdir(), 'oggregator-landing', 'landing-leads.jsonl');
```

(Delete the `fileURLToPath` import and the `here`/`defaultDataDir` lines; everything else is unchanged.)

- [ ] **Step 5: Run route tests**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS (route file). `lead-capture.test.tsx` still green.

- [ ] **Step 6: Upgrade the form**

In `lib/links.ts` append:

```ts
// Owner-supplied via Vercel env; components render contact affordances only when set.
export const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;
```

In `lib/copy.ts`, inside the `cta` block, add two strings (keep the rest):

```ts
    button: 'Request Access',
    success:
      'You are on the list. Expect onboarding details from the desk — typically within a few days.',
```

In `components/LeadCaptureSection.tsx`:

(a) add imports/state:

```tsx
import { contactEmail } from "@/lib/links";
```

```tsx
  const [website, setWebsite] = useState("");
```

(b) include the honeypot in the POST body:

```tsx
        body: JSON.stringify({ ...parsed.data, website }),
```

(c) change the input to a real email field — line 137: `type="text"` → `type="email"`.

(d) add the honeypot field directly above the submit button (visually hidden, skipped by keyboard users, ignored by screen readers):

```tsx
              <div aria-hidden="true" className="sr-only">
                <label htmlFor="landing-website">Website</label>
                <input
                  id="landing-website"
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>
```

(e) give the button its own copy — line 167: `{isSubmitting ? "Submitting" : landingCopy.cta.eyebrow}` → `{isSubmitting ? "Submitting" : landingCopy.cta.button}`.

(f) use the richer success copy — replace the literal success string (line 187) with `landingCopy.cta.success`.

(g) add a contact escape hatch after the status `<p>` (renders only when the env is set):

```tsx
              {contactEmail ? (
                <p className="mt-4 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-400">
                  prefer email?{" "}
                  <a
                    className="text-[var(--landing-text-strong)] underline decoration-white/30 underline-offset-4"
                    href={`mailto:${contactEmail}`}
                  >
                    {contactEmail}
                  </a>
                </p>
              ) : null}
```

(h) in `components/lead-capture.test.tsx`, the success assertion text changes — update:

```tsx
      expect(screen.getByText(/you are on the list/i)).toBeInTheDocument();
```

(unchanged regex still matches the new copy — verify it does; if you altered the copy, match the new string).

- [ ] **Step 7: Run all tests, typecheck, commit**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck`
Expected: PASS.

```bash
git add apps/landing/lib/links.ts apps/landing/lib/lead-store.ts apps/landing/lib/copy.ts apps/landing/components/LeadCaptureSection.tsx apps/landing/components/lead-capture.test.tsx apps/landing/app/api/leads/route.ts apps/landing/app/api/leads/route.test.ts
git commit -m "feat(landing): lead pipeline hardening — honeypot, rate limit, /tmp fallback, email input"
```

---

### Task 7: Smooth scroll + anchor offsets — then cut PR 1

**Files:**
- Modify: `app/globals.css`
- Modify: `components/TerminalShowcase.tsx`, `components/HowItWorksSection.tsx`, `components/FeatureBentoSection.tsx`, `components/FaqSection.tsx`, `components/LeadCaptureSection.tsx`, `components/VenueStrip.tsx` (one class each)

- [ ] **Step 1: Globals — opt-in smooth scroll**

In `app/globals.css`: add after the `body { ... }` block:

```css
@media (prefers-reduced-motion: no-preference) {
  html {
    scroll-behavior: smooth;
  }
}
```

and inside the existing `@media (prefers-reduced-motion: reduce)` block, DELETE the dead rules:

```css
  .ticker-track {
    animation: none;
  }
```

and

```css
  * {
    scroll-behavior: auto;
  }
```

(`.ticker-track` matches nothing; `scroll-behavior` is now opt-in so the reset is unnecessary. Keep the `.landing-feed-tape-track` and button-transition rules.)

- [ ] **Step 2: Anchor offsets**

Add `scroll-mt-24` to the `className` of each `<section>` that is an anchor target: `#showcase` (both branches in `TerminalShowcase.tsx`), `#how-it-works`, `#features`, `#faq`, `#access`, `#venues`.

- [ ] **Step 3: Run tests, commit, cut PR 1**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck && pnpm --filter @oggregator/landing lint`
Expected: all PASS.

```bash
git add apps/landing/app/globals.css apps/landing/components
git commit -m "feat(landing): smooth scroll (motion-safe) + sticky-header anchor offsets"
git push -u origin feat/landing-pro-upgrade
gh pr create --title "Landing PR 1/4: hero defects, funnel, logos, lead hardening" --body "$(cat <<'EOF'
Phase 1 of the Direction B landing upgrade (spec: docs/superpowers/specs/2026-06-12-landing-pro-upgrade-design.md).

- Hero pitch (h1+CTAs) now in the first viewport; scenes inert when invisible; reduced-motion hero no longer zero-height; svh units
- Funnel: "Launch terminal"→"Sign in", "See the terminal"→#showcase
- Contour poster for degraded hero paths (SurfaceFallback revival)
- Venue logos: explicit asset paths (fixes 3/8 production 404s — verify on the preview deploy, the bug is Linux-only)
- Honest ticker tape + pause control
- Lead pipeline: honeypot, per-IP rate limit, /tmp fallback, type=email
- NOTE: hero theater (scroll math, camera poses, shader) untouched — needs one manual scroll-through on the preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Manual gate before merging PR 1:** on the Vercel preview — (1) scroll the hero start-to-end on desktop + a mobile viewport: pitch visible immediately, crossfade clean, no dead beat between 0.42 and 0.45; (2) OS reduced-motion on → full-height static hero with h1+CTAs; (3) all 8 venue logos render; (4) submit the lead form.

---

# PHASE 2 — PR 2: SEO, metadata, a11y

### Task 8: Metadata block + icon + OG image

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/icon.svg`, `app/opengraph-image.tsx`
- Modify: `app/layout.test.tsx`

- [ ] **Step 1: Write the failing metadata test**

Append to `app/layout.test.tsx` (inside the existing `describe`, after updating the top import line to also pull the new exports — `import RootLayout, { metadata, viewport } from "./layout";`):

```tsx
  it("ships share/SEO metadata", () => {
    expect(String(metadata.metadataBase)).toContain("oggregator");
    expect(metadata.openGraph?.siteName).toBe("Oggregator");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.alternates?.canonical).toBe("/");
    expect(viewport.themeColor).toBe("#080b0d");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — no `viewport` export, no openGraph.

- [ ] **Step 3: Implement the metadata**

In `app/layout.tsx`, change the `Metadata` import to also import `Viewport`, and replace the `export const metadata` block with:

```tsx
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oggregator.xyz";
const title = "Oggregator — Options terminal for fragmented markets";
const description =
  "High-performance option aggregation terminal for serious traders. Aggregate live venue data, normalize context, and route with precision from one workspace.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Oggregator",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#080b0d",
};
```

- [ ] **Step 4: Create the icon**

Create `app/icon.svg` (the ◢ glyph on the page background — Next serves this as the favicon automatically):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#080b0d"/>
  <path d="M14 50 L50 50 L50 14 Z" fill="#edf4f6"/>
</svg>
```

- [ ] **Step 5: Create the OG image route**

Create `app/opengraph-image.tsx` (Next auto-wires it into `og:image`/`twitter:image`; the owner's baked shader still can replace this later by swapping the JSX for an `<img>` of a static asset):

```tsx
import { ImageResponse } from "next/og";

export const alt = "Oggregator — options terminal for fragmented markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px",
        backgroundColor: "#080b0d",
        backgroundImage:
          "radial-gradient(circle at 28% 62%, rgba(30,64,175,0.5), transparent 52%), radial-gradient(circle at 74% 36%, rgba(234,88,12,0.42), transparent 46%)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "18px",
          color: "#edf4f6",
          fontSize: "28px",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "26px solid transparent",
            borderBottom: "26px solid #edf4f6",
          }}
        />
        Oggregator
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div
          style={{
            color: "#edf4f6",
            fontSize: "72px",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          One terminal. Every venue.
        </div>
        <div style={{ color: "#aab4bc", fontSize: "30px" }}>
          Deribit · OKX · Binance · Bybit · Thalex · Derive · Coincall · Gate.io
        </div>
      </div>
    </div>,
    size,
  );
}
```

- [ ] **Step 6: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck`
Expected: PASS.

```bash
git add apps/landing/app/layout.tsx apps/landing/app/layout.test.tsx apps/landing/app/icon.svg apps/landing/app/opengraph-image.tsx
git commit -m "feat(landing): full share metadata, favicon, generated OG card"
```

---

### Task 9: robots / sitemap / manifest

**Files:**
- Create: `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`, `app/seo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/seo.test.ts`:

```ts
import manifest from './manifest';
import robots from './robots';
import sitemap from './sitemap';

describe('SEO route files', () => {
  it('allows crawling and points at the sitemap', () => {
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it('lists the landing root in the sitemap', () => {
    const entries = sitemap();
    expect(entries[0]?.url).toContain('oggregator');
  });

  it('ships a dark manifest', () => {
    const result = manifest();
    expect(result.name).toBe('Oggregator');
    expect(result.background_color).toBe('#080b0d');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Create the three route files**

`app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oggregator.xyz';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
```

`app/sitemap.ts`:

```ts
import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oggregator.xyz';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl, changeFrequency: 'weekly', priority: 1 }];
}
```

`app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Oggregator',
    short_name: 'Oggregator',
    description: 'Cross-venue options aggregation terminal.',
    start_url: '/',
    display: 'browser',
    background_color: '#080b0d',
    theme_color: '#080b0d',
  };
}
```

- [ ] **Step 4: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/app/robots.ts apps/landing/app/sitemap.ts apps/landing/app/manifest.ts apps/landing/app/seo.test.ts
git commit -m "feat(landing): robots, sitemap, manifest"
```

---

### Task 10: Structured data (FAQPage + Organization JSON-LD)

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe` in `app/page.test.tsx`:

```tsx
  it('embeds FAQPage and Organization JSON-LD', async () => {
    const { container } = render(await HomePage());

    const scripts = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
    ).map((node) => JSON.parse(node.textContent ?? '{}'));

    expect(scripts.some((s) => s['@type'] === 'FAQPage')).toBe(true);
    expect(scripts.some((s) => s['@type'] === 'Organization')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — no JSON-LD scripts.

- [ ] **Step 3: Implement**

In `app/page.tsx`, add the import and constants above `HomePage`:

```tsx
import { faqItems } from "@/lib/demo-data";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oggregator.xyz";

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Oggregator",
  url: siteUrl,
};
```

and render both scripts as the first children inside the returned JSX:

```tsx
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
```

- [ ] **Step 4: Run tests + lint, commit**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing lint`
Expected: PASS (the biome-ignore comments keep lint green; if biome flags a different rule name, use the name from its error output).

```bash
git add apps/landing/app/page.tsx apps/landing/app/page.test.tsx
git commit -m "feat(landing): FAQPage + Organization JSON-LD"
```

---

### Task 11: Landmarks, skip link, heading order

**Files:**
- Modify: `app/page.tsx`, `components/VenueStrip.tsx`, `components/TerminalShowcase.tsx`
- Modify: `app/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `app/page.test.tsx`:

```tsx
  it('exposes banner/main/contentinfo landmarks and a skip link', async () => {
    render(await HomePage());

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      '#main',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — header/footer are inside `<main>` so banner/contentinfo roles don't exist.

- [ ] **Step 3: Restructure the page shell**

In `app/page.tsx`, replace the returned JSX of `HomePage` (keep the JSON-LD scripts first; section order unchanged in this task):

```tsx
  return (
    <div className="landing-page min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-[var(--landing-border-strong)] focus:bg-[var(--landing-panel-strong)] focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <TopTicker spots={snapshot.spots} />
      <LandingHeader />
      <main id="main">
        <HeroTerminalSection />
        <TerminalShowcase />
        <SectionReveal>
          <HowItWorksSection />
        </SectionReveal>
        <SectionReveal>
          <FeatureBentoSection />
        </SectionReveal>
        <FaqSection />
        <LeadCaptureSection />
        <VenueStrip />
      </main>
      <Footer />
    </div>
  );
```

(`.landing-page` moves from `<main>` to the wrapping `<div>` so the grid texture and `overflow: clip` still cover ticker/header/footer; sticky positioning inside is unaffected because `overflow: clip` — not `hidden` — is what `.landing-page` uses.)

- [ ] **Step 4: Heading fixes**

In `components/VenueStrip.tsx`: change the title `<p>` (the one rendering `landingCopy.venues.title`) to `<h2>` with the same className.

In `components/TerminalShowcase.tsx`: in the ANIMATED branch (the second `return`), add a visually-hidden heading as the first child inside the sticky `<div>`:

```tsx
        <h2 className="sr-only">{landingCopy.showcase.title}</h2>
```

and in `StaticGrid`, the `landing-section-title` element is already an `h2` — verify and leave as is.

- [ ] **Step 5: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/app/page.tsx apps/landing/app/page.test.tsx apps/landing/components/VenueStrip.tsx apps/landing/components/TerminalShowcase.tsx
git commit -m "fix(landing): real landmarks, skip link, heading order"
```

---

### Task 12: Contrast sweep + global focus-visible

**Files:**
- Modify: `app/globals.css`, `components/FaqSection.tsx`, `components/LeadCaptureSection.tsx`, `components/HeroTerminalSection.tsx`, `components/TerminalShowcase.tsx`, `components/HowItWorksSection.tsx`, `components/FeatureBentoSection.tsx`

- [ ] **Step 1: Globals**

In `app/globals.css` add (after the button focus rules):

```css
:focus-visible {
  outline: 2px solid var(--landing-accent);
  outline-offset: 3px;
}
```

- [ ] **Step 2: Raise informative micro-label contrast**

Rule: text that CONVEYS information moves up one step (`text-zinc-600` → `text-zinc-400`, `text-zinc-500` → `text-zinc-400`); text inside `aria-hidden` decoration stays. Apply:

- `components/FaqSection.tsx`: the `06 entries` span (line 29), all four `<dt>` (lines 42/46/50/54), the index number span (line 84), the `answered by the desk doc` row (line 133) → `text-zinc-400`.
- `components/LeadCaptureSection.tsx`: the `channel · onboarding only` span (line 76), trust-list wrapper (line 80) and its index numbers (line 83), the three stat `<p className="text-zinc-600">` labels (lines 101/105/109), the form `<label>` (line 122), helper `<p>` (line 171), idle status class (line 183), bottom strip (line 196) → `text-zinc-400`. The char counter (line 156) is `aria-hidden` — leave it.
- `components/HeroTerminalSection.tsx`: axis key (line 165 block), top scaffold right span (line 186), bottom rule caption row (line 203) → `text-zinc-400`. The IV legend numbers (line 152) sit inside an `aria-hidden` block — leave.
- `components/TerminalShowcase.tsx`: top scaffold right span (line 218) and bottom caption row (line 251) → `text-zinc-400`.
- `components/HowItWorksSection.tsx` + `components/FeatureBentoSection.tsx`: the small `text-zinc-500` kicker labels above card titles → `text-zinc-400`.

- [ ] **Step 3: Run tests + visual spot-check, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS (no test pins these classes).

```bash
git add apps/landing/app/globals.css apps/landing/components
git commit -m "fix(landing): AA contrast for informative micro-labels + global focus-visible"
```

---

### Task 13: Mobile navigation

**Files:**
- Modify: `components/LandingHeader.tsx`
- Create: `components/landing-header.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/landing-header.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

import { LandingHeader } from './LandingHeader';

describe('LandingHeader', () => {
  it('offers a mobile menu with the section links', () => {
    render(<LandingHeader />);

    expect(screen.getByText(/^menu$/i)).toBeInTheDocument();
    // Desktop + mobile nav both exist in the DOM (CSS hides one per breakpoint).
    expect(screen.getAllByRole('link', { name: /^terminal$/i }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole('link', { name: /^faq$/i }).length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — no Menu element.

- [ ] **Step 3: Add the disclosure menu**

In `components/LandingHeader.tsx`, after the desktop nav `</div>` (line 25) insert a native `<details>` menu (no JS, header stays a server component):

```tsx
        <details className="relative md:hidden">
          <summary className="landing-nav-link flex cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <nav
            aria-label="Mobile"
            className="absolute right-0 top-full z-40 mt-3 flex w-52 flex-col gap-4 border border-[color:var(--landing-border)] bg-[var(--landing-panel-strong)] p-5 backdrop-blur-xl"
          >
            <a className="landing-nav-link" href="#showcase">
              {landingCopy.nav.workflow}
            </a>
            <a className="landing-nav-link" href="#features">
              {landingCopy.nav.features}
            </a>
            <a className="landing-nav-link" href="#faq">
              {landingCopy.nav.faq}
            </a>
            <a className="landing-nav-link" href={appUrl}>
              {landingCopy.nav.launch}
            </a>
          </nav>
        </details>
```

- [ ] **Step 4: Fix the now-ambiguous hero-shell assertion**

The header now contains TWO "Terminal" links (desktop + mobile), so Task 2's `getByRole('link', { name: /^terminal$/i })` in `components/hero-shell.test.tsx` throws on multiple matches. Replace it with:

```tsx
    for (const link of screen.getAllByRole('link', { name: /^terminal$/i })) {
      expect(link).toHaveAttribute('href', '#showcase');
    }
```

- [ ] **Step 5: Run tests, commit, cut PR 2**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck && pnpm --filter @oggregator/landing lint`
Expected: PASS.

```bash
git add apps/landing/components/LandingHeader.tsx apps/landing/components/landing-header.test.tsx apps/landing/components/hero-shell.test.tsx
git commit -m "feat(landing): mobile disclosure nav"
git push
gh pr create --title "Landing PR 2/4: SEO, metadata, a11y" --body "$(cat <<'EOF'
Phase 2 of the Direction B landing upgrade.

- Full metadata block (metadataBase/OG/Twitter/canonical) + favicon + generated OG card
- robots/sitemap/manifest + FAQPage/Organization JSON-LD
- Landmarks restructure + skip link + heading-order fixes
- AA contrast sweep on micro-labels, global :focus-visible
- Mobile disclosure nav
- Verify on preview: link unfurl on X/Telegram, favicon, keyboard tab order

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 14: State tokens (success/loss become real colors)

**Files:**
- Modify: `app/globals.css` (two lines)

- [ ] **Step 1: Implement**

In `app/globals.css` `:root`, change:

```css
  --landing-success: #86c7a4;
  --landing-loss: #d08c8c;
```

(Desaturated green/red — the monochrome chrome stays, but the lead form's error state finally reads as an error. `LeadCaptureSection` already consumes both tokens.)

- [ ] **Step 2: Run tests, commit (include in PR 2)**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/app/globals.css
git commit -m "feat(landing): real success/loss state tokens"
git push
```

---

# PHASE 3 — PR 3: Narrative re-sequence + trust layer

### Task 15: Page re-sequence — VenueStrip becomes the post-hero trust strip

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/page.test.tsx`

- [ ] **Step 1: Move VenueStrip** in the `<main>` of `app/page.tsx` to directly after `<HeroTerminalSection />` (it leaves its old slot after `LeadCaptureSection`). Final `<main>` order: Hero → VenueStrip → TerminalShowcase → HowItWorks(SectionReveal) → FeatureBento(SectionReveal) → FaqSection → LeadCaptureSection.

**Constraint check:** `HeroTerminalSection` and `TerminalShowcase` remain direct, unwrapped children of `<main>`.

- [ ] **Step 2: Pin the order with a test**

Append to `app/page.test.tsx`:

```tsx
  it('places the venue strip directly after the hero', async () => {
    render(await HomePage());

    const main = screen.getByRole('main');
    // Document order, depth-agnostic — SectionReveal nests sections inside motion divs.
    const ids = Array.from(main.querySelectorAll('section[id]')).map((s) => s.id);

    expect(ids.indexOf('venues')).toBe(ids.indexOf('hero') + 1);
  });
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/app/page.tsx apps/landing/app/page.test.tsx
git commit -m "feat(landing): venue strip moves to post-hero trust slot"
```

---

### Task 16: TrustSection (engineering proof only)

**Files:**
- Create: `components/TrustSection.tsx`, `components/trust-section.test.tsx`
- Modify: `lib/copy.ts` (new `trust` block), `app/page.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/trust-section.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

import { TrustSection } from './TrustSection';

describe('TrustSection', () => {
  it('renders verifiable engineering claims and a contact path', () => {
    render(<TrustSection />);

    expect(screen.getByRole('heading', { name: /built to be checked/i })).toBeInTheDocument();
    expect(screen.getByText(/degraded shows as degraded/i)).toBeInTheDocument();
    expect(screen.getByText(/venue-tagged/i)).toBeInTheDocument();
    // No fabricated metrics, no anonymous quotes.
    expect(screen.queryByText(/99\.9/)).not.toBeInTheDocument();
    // Contact path exists either as mailto (env set) or as the #access fallback.
    expect(screen.getByRole('link', { name: /request access below|@/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the copy block**

In `lib/copy.ts`, add after the `faq` block:

```ts
  trust: {
    eyebrow: 'Engineering proof',
    title: 'Built to be checked.',
    description:
      'No fabricated metrics. No anonymous quotes. The claims on this page are properties of the system — verify each one inside the terminal.',
    contactLabel: 'Talk to the desk',
  },
```

- [ ] **Step 4: Create the component**

Create `components/TrustSection.tsx`:

```tsx
import { landingCopy } from "@/lib/copy";
import { contactEmail } from "@/lib/links";

// Verifiable engineering claims only — the founder/identity block is a future,
// owner-written addition; never ship placeholder identity copy.
const proofPoints = [
  {
    title: "Degraded shows as degraded",
    detail:
      "Venue health is a first-class surface. A stale feed flags in the UI the moment it degrades — never silent stale state.",
  },
  {
    title: "One schema, venue-tagged",
    detail:
      "Every quote, fill, and greek is normalized once and carries its source venue end-to-end, so risk views reconcile by construction.",
  },
  {
    title: "Counts come from code",
    detail:
      "Venue and coverage numbers on this page are derived from the same data the terminal ships with — they cannot drift from reality.",
  },
] as const;

export function TrustSection() {
  const contactHref = contactEmail ? `mailto:${contactEmail}` : "#access";
  const contactText = contactEmail ?? "request access below";

  return (
    <section
      id="trust"
      className="landing-container scroll-mt-24 px-6 py-20 sm:px-10 sm:py-24"
    >
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.trust.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">
          {landingCopy.trust.title}
        </h2>
        <p className="landing-section-copy mt-6 max-w-2xl">
          {landingCopy.trust.description}
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {proofPoints.map((point) => (
          <article key={point.title} className="landing-panel rounded-[1.5rem] px-5 py-6">
            <h3 className="landing-display-value text-2xl">{point.title}</h3>
            <p className="mt-3 text-base leading-7 text-[var(--landing-muted-strong)]">
              {point.detail}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-white/8 pt-6 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.28em] text-zinc-400">
        <span>{landingCopy.trust.contactLabel}</span>
        <a
          className="text-[var(--landing-text-strong)] underline decoration-white/30 underline-offset-4 transition hover:decoration-white"
          href={contactHref}
        >
          {contactText}
        </a>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Slot it into the page**

In `app/page.tsx`: import `TrustSection` and render it between the `FeatureBentoSection` SectionReveal block and `FaqSection`, wrapped in its own `<SectionReveal>`.

- [ ] **Step 6: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/components/TrustSection.tsx apps/landing/components/trust-section.test.tsx apps/landing/lib/copy.ts apps/landing/app/page.tsx
git commit -m "feat(landing): TrustSection — engineering proof + contact path"
```

---

### Task 17: Footer rebuild

**Files:**
- Modify: `components/Footer.tsx`, `lib/copy.ts` (footer block), `lib/links.ts`
- Create: `components/footer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/footer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

import { Footer } from './Footer';

describe('Footer', () => {
  it('renders nav anchors and the copyright line', () => {
    render(<Footer />);

    expect(screen.getByRole('link', { name: /^terminal$/i })).toHaveAttribute(
      'href',
      '#showcase',
    );
    expect(screen.getByRole('link', { name: /^access$/i })).toHaveAttribute('href', '#access');
    expect(screen.getByText(/©\s*\d{4}\s*Oggregator/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — Terminal anchor points at `#how-it-works`, no © line.

- [ ] **Step 3: Implement**

In `lib/links.ts` append:

```ts
export const xUrl = process.env.NEXT_PUBLIC_X_URL ?? null;
```

In `lib/copy.ts`, update the footer links so "Terminal" matches its destination:

```ts
  footer: {
    strapline: 'Cross-venue options aggregation.',
    links: [
      { label: 'Terminal', href: '#showcase' },
      { label: 'Features', href: '#features' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Access', href: '#access' },
    ],
  },
```

Replace the whole body of `components/Footer.tsx` with:

```tsx
import { landingCopy } from "@/lib/copy";
import { contactEmail, xUrl } from "@/lib/links";

// Privacy/Terms links are added in the same commit as the owner-supplied legal
// text (see plan Task 22) — never link to empty routes.
export function Footer() {
  return (
    <footer className="landing-container border-t border-white/6 px-6 py-10 sm:px-10">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-[var(--font-heading)] text-sm font-medium uppercase tracking-[0.3em] text-zinc-300">
            Oggregator
          </p>
          <p className="mt-2 text-sm text-zinc-400">{landingCopy.footer.strapline}</p>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-4 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-400"
        >
          {landingCopy.footer.links.map((link) => (
            <a key={link.href} href={link.href} className="transition hover:text-zinc-200">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-col gap-2 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-400">
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} className="transition hover:text-zinc-200">
              {contactEmail}
            </a>
          ) : null}
          {xUrl ? (
            <a
              href={xUrl}
              rel="noreferrer"
              target="_blank"
              className="transition hover:text-zinc-200"
            >
              X / Twitter
            </a>
          ) : null}
        </div>
      </div>

      <p className="mt-8 border-t border-white/6 pt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
        © {new Date().getFullYear()} Oggregator. All rights reserved.
      </p>
    </footer>
  );
}
```

- [ ] **Step 4: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/components/Footer.tsx apps/landing/components/footer.test.tsx apps/landing/lib/copy.ts apps/landing/lib/links.ts
git commit -m "feat(landing): real footer — nav, contact/X (env-gated), copyright"
```

---

### Task 18: Numbers single-source

**Files:**
- Modify: `components/LeadCaptureSection.tsx`, `components/FaqSection.tsx`
- Modify: `components/proof-sections.test.tsx`

- [ ] **Step 1: Write the failing assertions**

In `components/proof-sections.test.tsx`, append a test:

```tsx
  it('derives every count from data and ships no unverifiable stats', () => {
    render(<FaqSection />);

    expect(screen.getByText(/06 entries/i)).toBeInTheDocument();
    expect(screen.getByText(/08 wired/i)).toBeInTheDocument();
    expect(screen.queryByText(/420\s?ms/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/99\.98/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: FAIL — `07 wired`, `420 ms`, `99.98%` all present.

- [ ] **Step 3: Implement**

In `components/FaqSection.tsx`:
- add `venues` to the demo-data import: `import { faqItems, venues } from "@/lib/demo-data";`
- line 30: `06 entries` → `` {`${String(faqItems.length).padStart(2, "0")} entries`} ``
- replace the four-entry `<dl>` (lines 40-57) with a two-entry one (latency/health stats dropped as unverifiable):

```tsx
          <dl className="mt-10 grid max-w-md grid-cols-2 gap-x-6 gap-y-4 border-t border-white/8 pt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.28em]">
            <div>
              <dt className="text-zinc-400">Venues</dt>
              <dd className="mt-2 text-[var(--landing-text-strong)]">
                {`${String(venues.length).padStart(2, "0")} wired`}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Refresh</dt>
              <dd className="mt-2 text-[var(--landing-text-strong)]">sub-second</dd>
            </div>
          </dl>
```

In `components/LeadCaptureSection.tsx`:
- add the import: `import { venues } from "@/lib/demo-data";`
- line 102: `07 venues` → `` {`${String(venues.length).padStart(2, "0")} venues`} ``

- [ ] **Step 4: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/components/FaqSection.tsx apps/landing/components/LeadCaptureSection.tsx apps/landing/components/proof-sections.test.tsx
git commit -m "fix(landing): all counts derive from data; unverifiable stats dropped"
```

---

### Task 19: Copy pass — de-duplicate, vary headlines

**Files:**
- Modify: `lib/copy.ts`

- [ ] **Step 1: Implement** these exact string changes (staccato "X. Y." stays hero-only where it isn't a literal list):

- `showcase.description`: `'Every screen, one source of truth.'` → `'Chain, portfolio, route, and tape — captured from the live terminal.'` (kills the duplicate of `cta.title`)
- `workflow.description`: `'One workspace. Every screen the desk runs.'` → `'Three depths of the same market: shape, price, and exposure.'`
- `features.description`: keep.
- `venues.eyebrow`/`venues.title`: keep (`venues.length` (=8) now provably matches "Eight markets").

- [ ] **Step 2: Run tests** (no test pins these strings — verify), commit:

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS.

```bash
git add apps/landing/lib/copy.ts
git commit -m "feat(landing): copy pass — dedupe one-source-of-truth, vary section descriptions"
```

---

### Task 20: SectionReveal — stagger + hydration-flash fix

**Files:**
- Modify: `components/SectionReveal.tsx`, `app/page.tsx`

- [ ] **Step 1: Rewrite SectionReveal**

Replace the whole body of `components/SectionReveal.tsx` with:

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
} as const;

const item = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
} as const;

// Rendered hidden from SSR and revealed in view — no mounted-gate, so the old
// post-hydration disappear/reappear flash is gone. All wrapped sections sit
// below the 240svh hero, so nothing visible ever starts hidden.
export function SectionReveal({ children }: Readonly<{ children: ReactNode }>) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      variants={container}
    >
      <motion.div variants={item}>{children}</motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Apply consistently**

In `app/page.tsx`, also wrap `LeadCaptureSection` and `VenueStrip` in `<SectionReveal>`. Do **NOT** wrap: `HeroTerminalSection`, `TerminalShowcase` (sticky pins), or `FaqSection` (its `lg:sticky` left column would break under a transformed ancestor). Leave a one-line comment in `page.tsx` stating that rule:

```tsx
        {/* Hero, showcase, and FAQ must stay unwrapped: a transformed ancestor kills their sticky positioning. */}
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm --filter @oggregator/landing test:run`
Expected: PASS. (Order test from Task 15 still passes — its selector handles sections nested one `div` deep.)

```bash
git add apps/landing/components/SectionReveal.tsx apps/landing/app/page.tsx
git commit -m "feat(landing): staggered SectionReveal, flash-free, applied consistently"
```

---

### Task 21: Section polish — showcase clamp, HowItWorks de-templating, Bento emphasis

**Files:**
- Modify: `components/TerminalShowcase.tsx`, `components/HowItWorksSection.tsx`, `components/FeatureBentoSection.tsx`

- [ ] **Step 1: Showcase — settle the entry/exit frames**

In `components/TerminalShowcase.tsx`, in BOTH `Frame` and `FrameCaption`, clamp progress so frame 1 enters at full opacity and the last frame holds at exit. In each component, after `const window = ...`, add:

```tsx
  const settle = (value: number) =>
    Math.min(Math.max(value, slice * 0.5), 1 - slice * 0.5);
```

and replace every `value` inside the three `useTransform` callbacks (`opacity`, `scale`, `y`) with `settle(value)` — e.g.:

```tsx
  const opacity = useTransform(progress, (value) => {
    const distance = Math.abs(settle(value) - center);
    if (distance > window) return 0;
    return 1 - distance / window;
  });
```

Also remove the eager preload: in `Frame`, change `<FramePlate frame={frame} priority={index === 0} />` to `<FramePlate frame={frame} />`, and in `FramePlate` drop the `priority` prop from the signature and from `<Image>` (StaticGrid's `priority={false}` call site loses the prop too).

- [ ] **Step 2: HowItWorks — kill the templated labels**

In `components/HowItWorksSection.tsx`, replace the first grid column (the `Depth state` block, lines 22-34) with:

```tsx
                <div>
                  <div className="inline-flex items-center gap-3 rounded-full border border-white/8 bg-black/16 px-3 py-2">
                    <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--landing-accent)]">
                      {step.label}
                    </span>
                  </div>
                </div>
```

(The duplicated title is gone — it renders once, in the `h3`.) And change the right-box label (line 44-46) from `Trigger` to `On screen`.

- [ ] **Step 3: Bento — emphasis cells become body type**

In `components/FeatureBentoSection.tsx` (lines 45-47), change the emphasis `<p>` className to:

```tsx
                  <p className="rounded-[1rem] border border-white/8 bg-black/14 px-3 py-3 text-sm leading-6 text-[var(--landing-muted-strong)]">
```

- [ ] **Step 4: Run tests, commit, cut PR 3**

Run: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck && pnpm --filter @oggregator/landing lint`
Expected: PASS.

```bash
git add apps/landing/components/TerminalShowcase.tsx apps/landing/components/HowItWorksSection.tsx apps/landing/components/FeatureBentoSection.tsx
git commit -m "feat(landing): showcase settle clamp, HowItWorks de-templating, bento emphasis as body type"
git push
gh pr create --title "Landing PR 3/4: narrative re-sequence + trust layer" --body "$(cat <<'EOF'
Phase 3 of the Direction B landing upgrade.

- VenueStrip promoted to post-hero trust strip
- New TrustSection: engineering-proof claims + env-gated contact path
- Footer rebuild (nav, contact/X env-gated, copyright); legal links land with owner text
- Every count derives from data (7-vs-8 contradiction class dead); 420ms/99.98% dropped
- Copy dedupe; staggered flash-free SectionReveal; showcase entry/exit clamp; HowItWorks de-templating
- Manual: scroll the full page on the preview; check section rhythm and the new order

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 22 (BLOCKED — owner content): Legal routes

**Do not start until the owner supplies privacy + terms text and a contact email.** Never ship invented legal text or links to empty routes.

**Files:**
- Create: `app/privacy/page.tsx`, `app/terms/page.tsx`
- Modify: `lib/copy.ts` (footer gains the two links), `components/footer.test.tsx`

- [ ] **Step 1: Obtain from owner:** privacy text, terms text, legal-entity line, confirmation of `NEXT_PUBLIC_CONTACT_EMAIL` value (set in Vercel).

- [ ] **Step 2: Create the routes** — identical scaffold, owner text pasted as `<p>` blocks:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy — Oggregator" };

export default function PrivacyPage() {
  return (
    <main className="landing-container min-h-screen px-6 py-24 sm:px-10">
      <h1 className="landing-section-title max-w-[14ch]">Privacy policy</h1>
      <div className="landing-section-copy mt-10 max-w-2xl space-y-6">
        {/* paste owner-supplied paragraphs here as <p> elements */}
      </div>
    </main>
  );
}
```

(`app/terms/page.tsx` mirrors it with `Terms — Oggregator` / `Terms of service`.)

- [ ] **Step 3: Link from the footer** — append to `landingCopy.footer.links`:

```ts
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
```

add both routes to `app/sitemap.ts`, extend `components/footer.test.tsx` with href assertions for `/privacy` and `/terms`, run the suite, commit as `feat(landing): privacy + terms pages (owner-supplied text)`.

---

# PHASE 4 — PR 4: Orphan deletion (isolated, revertible)

### Task 23: Delete the orphaned component set + dead dependencies

**KEEP:** `MarketContextSection.tsx` (+ `marketContextRows`) — deferred live revival; `TestimonialsGrid.tsx` (+ `testimonials`) — content-gated; `three/SurfaceFallback.tsx` — now live in the hero.

- [ ] **Step 1: Verify each target is unreachable**

```bash
cd /home/aladhimainwin/OAgrr-aladhi/apps/landing
for f in VolatilitySurfaceExperience LandingSurfacePlot VolSurfaceShowcase HeroStatement TerminalMockup DeskWorkflowSection BringYourOwnDataSection VolSurfaceCanvas SurfaceMesh heroCopy; do
  echo "== $f"; grep -rn "$f" app components lib --include='*.ts*' | grep -v '.test.'; done
```

Expected: each name appears only inside the deletion set itself (its own file, or another file being deleted in Step 2 — e.g. `VolSurfaceCanvas` inside `VolSurfaceShowcase.tsx`, `heroCopy` inside `HeroStatement.tsx` and its `lib/copy.ts` definition). It must NOT appear in `app/page.tsx` or any surviving component. If a survivor imports a target, STOP and re-scope.

- [ ] **Step 2: Delete files**

```bash
git rm apps/landing/components/VolatilitySurfaceExperience.tsx \
  apps/landing/components/LandingSurfacePlot.tsx \
  apps/landing/components/plotly.ts \
  apps/landing/plotly-gl3d-dist-min.d.ts \
  apps/landing/components/VolSurfaceShowcase.tsx \
  apps/landing/components/three/VolSurfaceCanvas.tsx \
  apps/landing/components/three/SurfaceMesh.tsx \
  apps/landing/components/vol-surface-showcase.test.tsx \
  apps/landing/components/HeroStatement.tsx \
  apps/landing/components/TerminalMockup.tsx \
  apps/landing/components/DeskWorkflowSection.tsx \
  apps/landing/components/BringYourOwnDataSection.tsx
```

- [ ] **Step 3: Prune dead exports and deps**

- `lib/copy.ts`: delete the entire `heroCopy` export (lines 63-69 in the original file).
- `lib/demo-data.ts`: delete `tickerItems`, `terminalMetrics`, `terminalRows`, `routeCandidates`, `commandSequence`, `deskSnippet`, `dataSnippet`, `surfaceStats` and their now-unused interfaces (`TickerItem`). Before each deletion run `grep -rn "<name>" app components lib --include='*.ts*'` and keep anything that still has a live consumer.
- `package.json`: remove `plotly.js-gl3d-dist-min`, `react-plotly.js` from dependencies and `@types/react-plotly.js` from devDependencies, then:

```bash
pnpm install
```

- Unused public assets: verify then delete `public/venues/powertrade.png`, `public/venues/okx.png`, `public/venues/derive.png` (the venues array uses the `.svg` versions; `grep -rn 'powertrade\|okx.png\|derive.png' apps/landing/app apps/landing/components apps/landing/lib` must come back empty first).

- [ ] **Step 4: Full verification**

```bash
pnpm --filter @oggregator/landing test:run && \
pnpm --filter @oggregator/landing typecheck && \
pnpm --filter @oggregator/landing lint && \
pnpm --filter @oggregator/landing build
```

Expected: all PASS. (If `build` complains about `@oggregator/protocol`, run `pnpm --filter @oggregator/protocol build` first — the Vercel build does.)

- [ ] **Step 5: Commit (single, isolated, revertible), cut PR 4**

```bash
git add -A
git commit -m "chore(landing): delete orphaned components + plotly dependency chain"
git push
gh pr create --title "Landing PR 4/4: orphan deletion" --body "$(cat <<'EOF'
Phase 4 of the Direction B landing upgrade — isolated deletion commit, independently revertible.

Removes the superseded component set (plotly surface chain, old hero/mockups/sections) and the plotly npm deps. KEEPS MarketContextSection (deferred live revival), TestimonialsGrid (content-gated), SurfaceFallback (live in hero).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 24: Final verification checklist

- [ ] Full suite green: `pnpm --filter @oggregator/landing test:run && pnpm --filter @oggregator/landing typecheck && pnpm --filter @oggregator/landing lint && pnpm --filter @oggregator/landing build`
- [ ] Preview deploy: hero scroll-through desktop + mobile (pitch first viewport, clean 0.42→0.45 handoff, no dead beat); reduced-motion full-height static hero; all 8 venue logos render (case-sensitivity only reproduces on Linux/Vercel)
- [ ] Keyboard pass: tab from the top — skip link appears first, no invisible focus stops in the hero, mobile menu reachable
- [ ] Share check: paste the preview URL into X/Telegram — OG card renders; favicon in the tab
- [ ] Lead funnel: submit the form on preview; confirm `LANDING_API_BASE_URL` is set in the Vercel project (the `/tmp` fallback is best-effort only)
- [ ] Owner asset track (non-blocking): 4 re-shot screenshots swap in at `public/chainview.png`, `public/portfolio1.png`, `public/showcase/route.png`, `public/showcase/feed.png` (same filenames, ~16:10, no TODO badges / "Theta Oggregator" wordmark); legal text → Task 22; `NEXT_PUBLIC_CONTACT_EMAIL` / `NEXT_PUBLIC_X_URL` env values

---

## Spec-coverage map (self-review)

| Spec section | Tasks |
|---|---|
| Hero scene re-beat + inertness + reduced-motion + svh | 2, 3 |
| Degraded-path poster | 4 |
| Funnel (Sign in / #showcase / scroll-mt / smooth scroll) | 2, 7 |
| Venue logos explicit paths | 5 |
| Lead pipeline hardening | 6 |
| TopTicker honesty + pause | 1 |
| SEO/metadata/icons/OG/robots/sitemap/manifest/JSON-LD | 8, 9, 10 |
| Landmarks/skip link/heading order/contrast/focus/mobile nav | 11, 12, 13 |
| State tokens | 14 |
| Re-sequence + TrustSection + Footer + numbers + copy | 15-19 |
| SectionReveal stagger + section polish | 20, 21 |
| Legal routes (owner-gated) | 22 |
| Orphan deletion | 23 |
| Verification + preview gates | 7 (PR1 gate), 24 |
