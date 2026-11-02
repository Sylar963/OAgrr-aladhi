import type { TabId } from '@lib/tabs';
import type { ReactNode } from 'react';

export type NavIconName = TabId | 'charts' | 'tradfi';

// Drawn rather than typed as Unicode symbols: the app font has none of these glyphs, so each OS
// substituted its own, or an empty box, or a colour emoji.
const PATHS: Record<NavIconName, ReactNode> = {
  chain: <path d="M10 2.5 17.5 10 10 17.5 2.5 10ZM2.5 10h15M10 2.5v15" />,
  surface: <path d="M2.5 15c2.5-7 4.5-10 7.5-10s5 3 7.5 10M2.5 15h15M6 10.5c2.5 1.5 5.5 1.5 8 0" />,
  gex: <path d="M3 3.5v13h14M7 16.5v-5M11 16.5V6M15 16.5V9.5" />,
  flow: <path d="M11 2.5 4.5 11.5H10l-1 6 6.5-9H10Z" />,
  sectors: <path d="M3 3h6v6H3ZM11 3h6v6h-6ZM3 11h6v6H3ZM11 11h6v6h-6Z" />,
  architect: (
    <path d="M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M15.3 4.7l-2.1 2.1M6.8 13.2l-2.1 2.1" />
  ),
  trading: <path d="M14 5.5c-.8-1.3-2.2-2-4-2-2.2 0-4 1.2-4 3.2 0 4.3 8.5 2.3 8.5 6.6 0 2-1.9 3.2-4.3 3.2-2 0-3.7-.8-4.5-2.2M10 1.5v17" />,
  portfolio: <path d="M15 3.5H5l5.5 6.5L5 16.5h10" />,
  social: (
    <path d="M6 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.2 8.5l3.6 3.5" />
  ),
  alpha: <path d="M15.5 15.5c-2.5 0-3-3-3.5-5.5S10.7 4.5 8 4.5c-3 0-4.5 2.8-4.5 5.5S5 15.5 8 15.5c2.5 0 4-3 5.5-5.5l2-4" />,
  analytics: (
    <path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
  ),
  news: <path d="M3.5 3.5h13v13h-13ZM6.5 7h7M6.5 10h7M6.5 13h4.5" />,
  charts: <path d="M5 15 15 5M7 5h8v8" />,
  tradfi: <path d="M3 7h13M12.5 3.5 16 7l-3.5 3.5M17 13H4M7.5 9.5 4 13l3.5 3.5" />,
};

export function TabIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
