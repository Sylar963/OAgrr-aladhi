export interface WorkflowStep {
  id: string;
  label: string;
  title: string;
  description: string;
  detail: string;
}

export interface SpatialMode {
  id: string;
  title: string;
  description: string;
  signal: string;
  emphasis: string;
}

export interface SpatialOverlayRule {
  id: string;
  title: string;
  description: string;
  detail: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface Venue {
  slug: string;
  name: string;
  logo: string;
}

export interface ShowcaseFrame {
  id: string;
  src: string;
  eyebrow: string;
  title: string;
  detail: string;
}

export const workflowSteps: WorkflowStep[] = [
  {
    id: 'surface',
    label: '01',
    title: 'Surface',
    description: 'Cross-venue IV surface. Tick-by-tick.',
    detail: 'Eight venues. One smile.',
  },
  {
    id: 'chain',
    label: '02',
    title: 'Chain',
    description: 'Normalized quotes. Best edge per strike.',
    detail: 'Deribit · OKX · Binance · Bybit · Thalex · Derive · Coincall · Gate.io.',
  },
  {
    id: 'portfolio',
    label: '03',
    title: 'Portfolio',
    description: 'Greeks aggregated across venues. Real PnL.',
    detail: 'Per-venue risk. Per-strategy view.',
  },
] as const;

export const spatialModes: SpatialMode[] = [
  {
    id: 'surface',
    title: 'Surface',
    description: 'Live IV smile and term across every venue.',
    signal: 'Cross-venue regime',
    emphasis: 'One shape. All books.',
  },
  {
    id: 'skew',
    title: 'Skew',
    description: 'Wing stress and put/call imbalance, ranked.',
    signal: 'Directional risk',
    emphasis: 'Find the venue with the cheapest hedge.',
  },
  {
    id: 'term',
    title: 'Term',
    description: 'Tenor structure, event humps, calendar spreads.',
    signal: 'Expiry edge',
    emphasis: 'Spot the venue with the steepest curve.',
  },
  {
    id: 'route',
    title: 'Route',
    description: 'Best executable price across all eight venues.',
    signal: 'Execution edge',
    emphasis: 'Quote · spread · latency · in one row.',
  },
] as const;

export const spatialOverlayRules: SpatialOverlayRule[] = [
  {
    id: 'normalize',
    title: 'Normalized quotes',
    description: 'Every venue speaks the same units, conventions, and tick scales.',
    detail: 'Compare Deribit and Bybit on the same axis. No spreadsheet glue.',
  },
  {
    id: 'route',
    title: 'Best-venue routing',
    description: 'Live spread, depth, and latency budget per strike, per venue.',
    detail: 'See which book fills first — before you send the order.',
  },
  {
    id: 'feeds',
    title: 'Venue-tagged feeds',
    description: 'Every quote, fill, and greek carries its source venue end-to-end.',
    detail: 'Risk views split per venue automatically. Reconciliation is free.',
  },
  {
    id: 'failover',
    title: 'Failover in the UI',
    description: 'Degraded feeds show as degraded — never as silent stale state.',
    detail: 'Health is a first-class surface, not a hidden log line.',
  },
] as const;

export const faqItems: FaqItem[] = [
  {
    question: 'Which venues are supported?',
    answer:
      'Deribit, OKX, Binance, Bybit, Thalex, Derive, Coincall, and Gate.io — options books, normalized to one schema and one set of conventions.',
  },
  {
    question: 'How fast is the feed?',
    answer:
      'Sub-second across every venue. Quotes, greeks, and route candidates update tick-by-tick with an explicit latency budget surfaced in the UI.',
  },
  {
    question: 'Can we plug in our own signals?',
    answer:
      'Yes. Internal marks, risk overlays, and desk-specific enrichment merge into the same surface so routing reflects your stack, not a generic market view.',
  },
  {
    question: 'Browser or desktop?',
    answer:
      'Terminal-first. Delivery shape is decided per desk, but the UX is built to feel like a serious pro tool — not a dashboard.',
  },
  {
    question: 'What happens when a venue goes down?',
    answer:
      'Degraded feeds show as degraded in the UI. Venue health, route confidence, and stale-quote flags are first-class surface elements.',
  },
  {
    question: 'Is there an API?',
    answer:
      'The platform is built around command-driven workflows and extensible hooks. API surface and automation scope are shaped during onboarding.',
  },
] as const;

export const marketContextRows = [
  { label: 'BTC 30D ATM IV', value: '54.2%', detail: 'front vol +1.8%' },
  { label: 'ETH 25D RR', value: '-3.6', detail: 'put skew bid' },
  { label: 'XRP FRONT PREM', value: '12.4%', detail: 'near expiry premium' },
  { label: 'BNB OPEN INTEREST', value: '$184M', detail: 'cross-venue monitored' },
] as const;

export const testimonials = [
  {
    quote:
      'Oggregator gave us one screen for IV, skew, and routing context without the usual venue switching.',
    person: 'Desk PM',
    company: 'Crypto Vol Desk',
  },
  {
    quote:
      'The venue normalization is the difference. We stopped comparing mismatched quotes by hand.',
    person: 'Execution Lead',
    company: 'Options Market Maker',
  },
  {
    quote:
      'It feels like a serious desk product, not another retail dashboard pretending to be institutional.',
    person: 'Founder',
    company: 'Systematic Trading Team',
  },
] as const;

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

export const showcaseFrames: ShowcaseFrame[] = [
  {
    id: 'chain',
    src: '/chainview.png',
    eyebrow: '01 · Chain',
    title: 'Every venue, one chain.',
    detail: 'Normalized quotes. Best edge per strike, tagged by venue.',
  },
  {
    id: 'portfolio',
    src: '/portfolio1.png',
    eyebrow: '02 · Portfolio',
    title: 'Greeks across the book.',
    detail: 'Per-venue, per-strategy. PnL that matches the desk.',
  },
  {
    id: 'route',
    src: '/showcase/route.png',
    eyebrow: '03 · Route',
    title: 'Best executable price.',
    detail: 'Live spread, depth, latency — across all eight venues.',
  },
  {
    id: 'feed',
    src: '/showcase/feed.png',
    eyebrow: '04 · Feed',
    title: 'Venue-tagged tape.',
    detail: 'Quotes and fills stream with their source venue end-to-end.',
  },
] as const;
