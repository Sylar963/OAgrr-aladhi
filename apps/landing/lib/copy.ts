export const landingCopy = {
  nav: {
    home: 'Oggregator',
    workflow: 'Terminal',
    features: 'Features',
    faq: 'FAQ',
    cta: 'Request Access',
    launch: 'Sign in',
  },
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
  workflow: {
    eyebrow: 'The terminal',
    title: 'Surface. Chain. Portfolio.',
    description: 'Three depths of the same market: shape, price, and exposure.',
  },
  showcase: {
    eyebrow: 'Inside the terminal',
    title: 'Built for cross-venue flow.',
    description: 'Chain, portfolio, route, and tape — captured from the live terminal.',
  },
  features: {
    eyebrow: 'Built for desks',
    title: 'Cross-venue from the first quote.',
    description: 'Normalized prices. Sub-second refresh. Venue-aware routing.',
  },
  venues: {
    eyebrow: 'Connected venues',
    title: 'Eight markets. One terminal.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Answers before the call.',
    description: 'What desks ask before onboarding.',
  },
  trust: {
    eyebrow: 'Engineering proof',
    title: 'Built to be checked.',
    description:
      'No fabricated metrics. No anonymous quotes. The claims on this page are properties of the system — verify each one inside the terminal.',
    contactLabel: 'Talk to the desk',
  },
  cta: {
    eyebrow: 'Request access',
    title: 'One source of truth.',
    description: 'For desks, market makers, and execution teams.',
    placeholder: 'desk@fund.com',
    helper: 'Early access. No newsletter.',
    button: 'Request Access',
    success:
      'You are on the list. Expect onboarding details from the desk — typically within a few days.',
    trust: ['Early access', 'Desk-grade support', 'Sub-second feeds'],
  },
  footer: {
    strapline: 'Cross-venue options aggregation.',
    links: [
      { label: 'Terminal', href: '#showcase' },
      { label: 'Features', href: '#features' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Access', href: '#access' },
    ],
  },
} as const;

export const heroCopy = {
  eyebrow: landingCopy.hero.eyebrow,
  headlineA: 'The options terminal',
  headlineB: 'for fragmented markets.',
  cta: landingCopy.hero.primaryCta,
  docs: landingCopy.nav.faq,
} as const;
