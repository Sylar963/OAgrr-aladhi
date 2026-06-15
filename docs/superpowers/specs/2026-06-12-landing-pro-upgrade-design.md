# Landing Page Upgrade — Conversion Narrative Restructure (Direction B)

Date: 2026-06-12
Status: Approved by owner (direction + scope decisions locked)
App: `apps/landing` (Next.js 16 App Router, React 19, Tailwind 4, framer-motion, three.js)

## Goal

Upgrade the Oggregator landing page to a professional, trust-bearing conversion page for
skeptical options-desk visitors — while preserving the hero animation (the scroll-driven
three.js volatility-surface theater) **byte-identical mechanically**.

## Locked scope decisions

1. **Funnel — app is login-gated.** Nav "Launch terminal" relabels to "Sign in"
   (`lib/copy.ts:8`). "Request Access" → `#access` stays the single primary conversion.
   Hero secondary "See the terminal" repoints from `app.oggregator.xyz` to `#showcase`.
2. **TrustSection ships engineering-proof-only.** No founder block until the owner writes
   that copy; the layout leaves a slot for it. No fabricated metrics or testimonials.
3. **Live MarketContextSection revival is deferred** to a follow-up PR (would need
   landing-side `fetchStats` against the core `/api/stats` plus deploy verification).
4. **Legal text is owner-supplied.** I build `app/privacy/page.tsx` + `app/terms/page.tsx`
   routes and footer links; the links ship in the same commit as the supplied text. Until
   then the footer ships with entity line, contact, X link, and section anchors only.
5. Direction C items are explicitly **out of scope**: thermal-palette identity, full
   Tailwind `@theme` token migration, bento rebuild, live-data-everywhere.

## Hard constraint: the hero preservation contract

Mechanically preserving the animation means none of the following change:

- 240vh section height (`HeroTerminalSection.tsx:111`), sticky `top-0 h-screen` stage
  (`:117`), `useScroll` offset `['start start','end end']` (`:87-90`) → 0→1 progress over
  140vh of pinned travel.
- The clamped `scrollProgress` MotionValue passed into `VolSurfaceTheaterCanvas`
  (client-only, `dynamic ssr:false`), read imperatively per frame.
- The three camera poses lerped in `TheaterSurfaceMesh` (`sceneCameras`), the vertex-shader
  surface, and the wrapper transforms: scale 1→0.92→0.84, x 0%→16%→26%, opacity
  1→0.7→0.55 (`HeroTerminalSection.tsx:98-100`).
- The bottom scrim handoff to the next section (`:175`).
- **Ancestor rules:** the hero (and `TerminalShowcase`) must remain direct, unwrapped
  children of the page flow. A transformed ancestor (e.g. `SectionReveal`) silently kills
  `position:sticky`. `.landing-page` keeps `overflow: clip` (never `hidden`).
- Exactly one `h1` on the page, and it lives in the hero.

What IS allowed to change: `HeroScene` start/end fractions, scene contents/copy, the
HUD/fallback/visibility layers — the scene system is parameterized for exactly this.

## Current-state defects being fixed (all in PR 1)

1. **Reduced-motion hero collapses to zero height** — static mode sets `height:auto` on a
   wrapper whose every child is absolutely positioned (`HeroTerminalSection.tsx:111,116`).
   Reduced-motion users get no h1, no CTA, nothing. Invisible to CI (tests assert text
   presence only).
2. **Invisible-but-clickable CTAs** — scene 2 keeps pointer events while at opacity 0
   (`:235`); links at `:249-256` are clickable and tab-focusable while invisible
   (WCAG 2.4.7 failure + click trap).
3. **No pitch in the first viewport** — h1/CTAs fade in ~40% into the scroll theater.
4. **3 of 8 venue logos 404 in production** — slug/filename case mismatches
   (`Thalex.svg` vs slug `thalex`; slug `gate` vs `gateio.svg`; only `coincall.png`
   exists while `VenueStrip.tsx:22` hardcodes `.svg`). Linux/Vercel-only failure.
5. **Lead fallback store writes to a bundle-relative `.data` dir** (`lib/lead-store.ts:7-9`)
   — throws on Vercel's read-only filesystem, turning the page's only conversion into a 500
   when the core API is unreachable.

## Design

### 1. Page architecture (`app/page.tsx`)

New order, with landmarks fixed — `TopTicker` + `LandingHeader` hoisted above `<main>`,
`Footer` below it, skip-to-content link first:

```
TopTicker (cleaned)
LandingHeader (+ mobile nav, "Sign in")
<main>
  HeroTerminalSection      — animation untouched; scenes re-authored
  VenueStrip               — MOVED UP from below LeadCapture; post-hero trust strip
  TerminalShowcase         — presentation fixes
  HowItWorksSection        — de-templated
  FeatureBentoSection      — emphasis cells demoted to body type
  TrustSection             — NEW (after FeatureBento, before FAQ)
  FaqSection               — counts from data; JSON-LD
  LeadCaptureSection       — hardened form
</main>
Footer                     — real footer
```

`SectionReveal` becomes a staggered per-card variant (`delayChildren`/`staggerChildren`),
applied consistently to HowItWorks, FeatureBento, Trust, LeadCapture, VenueStrip —
**never** to the hero, showcase, or FaqSection (sticky-pin rule: the hero/showcase stages
and FaqSection's `lg:sticky` left column all break under a transformed ancestor). Fix its
post-hydration disappear/reappear flash (`SectionReveal.tsx:12-31`).

### 2. Hero — scene re-beat + defect fixes

- **Scene 1 (0→0.42)**: h1 "One terminal. Every venue.", the 8-venue subheadline, both
  CTAs (primary "Request Access" → `#access`, secondary "See the terminal" → `#showcase`).
  Pitch and conversion visible in the first viewport at full opacity.
- **Scene 2 (0.45→1)**: the connoisseur beat — "a real volatility surface — not a
  screenshot" caption plus the currently-unrendered `hero.proofLabel`/`proofPoints`
  (`copy.ts:17-18`). The 0.42/0.45 gap removes today's simultaneous-full-opacity window.
- **HeroScene inertness**: derive `visibility` (and pointer-events) from the same opacity
  transform — `visibility:'hidden'` at opacity 0 — so off-stage scenes can never be
  clicked or focused.
- **Reduced-motion fix**: static wrapper gets `min-h-[100svh]` and renders only the pitch
  scene (scene 1 content), not both superimposed.
- **Viewport units**: `h-screen`/`240vh` → `h-[100svh]`/`240svh` to fix mobile
  dynamic-toolbar jank. Flagged for the manual scroll pass — it subtly changes pin length
  on mobile only; choreography is otherwise unchanged.
- **Degraded paths**: deliberately revive the orphaned `three/SurfaceFallback.tsx`
  (SVG contour poster) as the visual for the dynamic-import loading state
  (`HeroTerminalSection.tsx:21-27`) and the no-WebGL/reduced-motion branch
  (`VolSurfaceTheaterCanvas.tsx:56-63`), replacing the two-blob gradient.

### 3. Trust layer

- **`components/TrustSection.tsx` (new)** — verifiable claims only: the degraded-feeds
  guarantee (real line at `lib/demo-data.ts:185`), a data-methodology note (normalization,
  venue-tagged quotes), and a contact mailto. Reserved slot for a future founder block.
- **Footer rebuild** (`components/Footer.tsx` + `copy.ts` footer block): copyright/entity
  line, contact email, X/Twitter link, section anchors incl. `#showcase` (currently
  unreachable from any nav), Privacy/Terms links gated on owner text (decision 4).
- **Numbers single-source**: derive from data so the contradiction class dies —
  `venues.length` (from `lib/demo-data.ts:265-274`, = 8) replaces "07 venues"
  (`LeadCaptureSection.tsx:102`) and "07 wired" (`FaqSection.tsx:51`);
  `faqItems.length` replaces "06 entries" (`FaqSection.tsx:30`). Drop the unverifiable
  "420 ms" / "99.98%" stat block (`FaqSection.tsx:42-47`).
- **TopTicker honesty** (`components/TopTicker.tsx`): delete the "Sponsored — Coincall"
  slot (`:19`), the internal-jargon Thalex line (`:16`), and hardcoded fallback prices
  (`:9-12`) — render only real snapshot data; `aria-hidden` the duplicated marquee run
  (`:26`); add a pause affordance (WCAG 2.2.2).

### 4. Funnel + lead pipeline

- Relabels per decision 1; add `scroll-mt` under the sticky header on all anchored
  sections; opt-in smooth scrolling outside reduced-motion.
- **LeadCaptureSection**: input `type="email"` (`:137`), visually-hidden honeypot field,
  dedicated submit-button copy string (stops borrowing `cta.eyebrow`, `:167`), designed
  success state with response expectations (`:186-187`), secondary "or email the desk"
  mailto.
- **`app/api/leads/route.ts`**: honeypot rejection + minimal per-IP rate limit.
- **`lib/lead-store.ts`**: fallback writes to `/tmp` (best-effort, prevents the 500; not
  durable). **Ops check**: verify `LANDING_API_BASE_URL` is set in the Vercel env so the
  durable core-API path is the real path.

### 5. Hygiene baseline (subsumed Direction A)

- **SEO/share** (`app/layout.tsx` + new files): `metadataBase`, `openGraph`
  (siteName/url/type/images), `twitter` `summary_large_image`, `alternates.canonical`,
  `icons`; `export const viewport = { themeColor: '#080b0d' }`; `app/icon.svg` (◢ glyph
  on `#080b0d`); `app/opengraph-image` (baked still of the vol surface, 1200×630);
  `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`; FAQPage JSON-LD generated from
  `faqItems` + Organization schema.
- **A11y**: landmarks restructure + skip link (see §1); `VenueStrip` title `<p>`→`<h2>`
  (`VenueStrip.tsx:41-43`); visually-hidden `<h2>` in the showcase's animated path
  (heading order currently jumps h1→h3); contrast sweep — informative 10px labels move
  from `text-zinc-600` (~2.5:1) / `zinc-500` to AA-passing `zinc-400`/muted-strong tokens,
  reserving `zinc-600` for `aria-hidden` decoration; consistent `:focus-visible`
  treatment; mobile disclosure nav in `LandingHeader.tsx` (native `<details>/<summary>`,
  nav is currently `hidden md:flex` with no alternative).
- **State tokens** (`app/globals.css:17-18`): `--landing-success` → desaturated green,
  `--landing-loss` → desaturated red, so the lead form's error state reads as an error.
  (Full token-system migration stays out of scope.)
- **Section polish**: TerminalShowcase — clamp frame 1/N opacity to 1 at section
  entry/exit (`FRAME_WINDOW` math, `TerminalShowcase.tsx:61-69`), drop the `priority`
  preload on a below-fold image; HowItWorks — remove the repeated "Depth state" label
  (`:24`), the duplicated title pill (`:31` vs `:37`), rename the "Trigger" box (`:45`);
  FeatureBento — reset full-sentence emphasis cells from 10px caps-mono to body `text-sm`
  (`:45`).
- **Copy pass** (`lib/copy.ts`): keep the staccato "X. Y." headline form for the hero
  only; vary subsequent section headlines with escalating specificity; de-duplicate
  "One source of truth" (`:28` vs `:46`).
- **Venue logos**: stop deriving the path as `${slug}.svg` (`VenueStrip.tsx:22`) — put an
  explicit logo filename on each entry in the `venues` array (`lib/demo-data.ts:265-274`)
  so PNG/SVG and casing can never mismatch again; rename `Thalex.svg`→`thalex.svg`, map
  `gate`→`gateio.svg` and `coincall`→`coincall.png`; explicit width/height on the `<img>`;
  hand-tuned per-logo heights.

### 6. Orphan deletion (PR 4 — isolated, revertible)

Delete: `VolatilitySurfaceExperience.tsx`, `LandingSurfacePlot.tsx`, `components/plotly.ts`,
`plotly-gl3d-dist-min.d.ts`, and deps `plotly.js-gl3d-dist-min` + `react-plotly.js` +
`@types/react-plotly.js`; `VolSurfaceShowcase.tsx`, `three/VolSurfaceCanvas.tsx`,
`three/SurfaceMesh.tsx`, `vol-surface-showcase.test.tsx`; `HeroStatement.tsx` + the
`heroCopy` block (`lib/copy.ts:63-69`); `TerminalMockup.tsx`; `DeskWorkflowSection.tsx`;
`BringYourOwnDataSection.tsx`; prune dead `demo-data.ts` exports.

**Keep**: `MarketContextSection.tsx` (deferred live revival), `TestimonialsGrid.tsx`
(content-gated on real, permissioned quotes), `three/SurfaceFallback.tsx` (revived in §2).

## Sequencing

Branch: `feat/landing-pro-upgrade`. Four PRs:

1. **Defects + funnel** — hero scene re-beat, inertness + reduced-motion + svh fixes,
   degraded-path poster, logo renames, lead pipeline hardening, ticker cleanup, funnel
   relabels.
2. **SEO / metadata / a11y** — metadata block, icon/OG, robots/sitemap/manifest, JSON-LD,
   landmarks/skip link/heading fixes, contrast sweep, mobile nav, focus-visible, state
   tokens.
3. **Narrative** — page re-sequence (VenueStrip up), TrustSection, footer rebuild
   (+ legal routes when text arrives), numbers single-source, copy pass, SectionReveal
   stagger, section polish.
4. **Orphan deletion** — isolated commit, independently revertible.

## Testing & verification

- `hero-shell.test.tsx`, `top-ticker.test.tsx`, `proof-sections.test.tsx`,
  `page.test.tsx`, `layout.test.tsx` pin current copy/hrefs/aria-labels — every copy
  change lands with its test update **in the same commit**.
- New tests: HeroScene inertness (visibility at opacity 0), reduced-motion hero renders
  h1+CTA, TrustSection content, footer links, leads honeypot/rate-limit, robots/sitemap.
- Manual: real scroll-through of the re-beat hero (desktop + mobile), reduced-motion pass,
  keyboard-tab pass.
- **Preview deploy required** for: venue logo renames (case-sensitivity is
  production-only; also verify git tracked the rename), link unfurl (OG card), lead
  fallback behavior.
- Repo hygiene: this environment intermittently auto-commits/pushes — verify `git status`
  before/after sessions; `docs/` is gitignored — spec committed with `git add -f`.

## Owner-side parallel track (never blocks code)

- Four re-shot product screenshots at 16:10 (`chainview.png`, `portfolio1.png` — currently
  shows six TODO badges, `showcase/route.png`, `showcase/feed.png`): cropped/legible, no
  app chrome/scrollbars, in-app brand unified to "Oggregator" (currently
  "Theta Oggregator"). Code ships first; PNGs swap in when ready.
- Privacy/Terms text (decision 4) and contact email + entity line for the footer.
- Founder copy for the TrustSection slot (later).

## Risks

- Hero regression risk is concentrated in the scene re-beat over the protected canvas;
  presence-only tests can't catch pacing/visual issues — the manual scroll pass is
  mandatory.
- The contrast/token sweep touches many call sites with presence-only tests as the net —
  isolated commit with per-section before/after screenshots.
- Deleting nothing in PR 1–3 keeps every step revertible; PR 4 is the only destructive
  pass and is isolated.
- Footer legal links must not ship pointing at empty routes (gated on owner text).
