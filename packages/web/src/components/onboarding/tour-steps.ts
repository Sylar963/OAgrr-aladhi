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
