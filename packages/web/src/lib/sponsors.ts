export interface Sponsor {
  id: string;
  category: string;
  sponsor: string;
  label: string;
  href: string;
}

export const SPONSORS: Sponsor[] = [
  {
    id: 'coincall',
    category: 'SPONSORED',
    sponsor: 'Coincall',
    label: 'Trade options with up to $30K bonus',
    href: 'https://www.coincall.com/r/43394533',
  },
];

export const AD_EVERY = 6;
