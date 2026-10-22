import { defineMessages, useT } from '@lib/i18n';
import { useMemo } from 'react';

export type TabId =
  | 'chain'
  | 'alpha'
  | 'architect'
  | 'trading'
  | 'portfolio'
  | 'social'
  | 'surface'
  | 'flow'
  | 'analytics'
  | 'gex'
  | 'news'
  | 'sectors';

export type TabGroup = 'market' | 'trade' | 'research';

export interface TabDef {
  id: TabId;
  label: string;
  slug: string;
  icon: string;
  group: TabGroup;
  badge?: 'NEW' | 'LIVE';
}

export const TAB_GROUPS: readonly TabGroup[] = ['market', 'trade', 'research'];

export const TABS: readonly TabDef[] = [
  { id: 'chain', label: 'Chain', slug: 'chain', icon: '⟐', group: 'market' },
  { id: 'surface', label: 'Volatility', slug: 'volatility', icon: '◈', group: 'market' },
  { id: 'gex', label: 'GEX', slug: 'gex', icon: '▧', group: 'market' },
  { id: 'flow', label: 'Flow', slug: 'flow', icon: '⚡', group: 'market', badge: 'LIVE' },
  { id: 'sectors', label: 'Sectors', slug: 'sectors', icon: '▦', group: 'market', badge: 'NEW' },
  { id: 'architect', label: 'Builder', slug: 'builder', icon: '⚙', group: 'trade' },
  { id: 'trading', label: 'Paper', slug: 'paper', icon: '$', group: 'trade' },
  { id: 'portfolio', label: 'Portfolio', slug: 'portfolio', icon: 'Σ', group: 'trade', badge: 'NEW' },
  { id: 'social', label: 'Social', slug: 'social', icon: '☍', group: 'trade', badge: 'NEW' },
  { id: 'alpha', label: 'Alpha', slug: 'alpha', icon: 'α', group: 'research', badge: 'NEW' },
  { id: 'analytics', label: 'Analytics', slug: 'analytics', icon: '◎', group: 'research' },
  { id: 'news', label: 'News', slug: 'news', icon: '▤', group: 'research', badge: 'NEW' },
] as const;

const tabMessages = defineMessages(
  {
    chain: 'Chain',
    surface: 'Volatility',
    gex: 'GEX',
    flow: 'Flow',
    sectors: 'Sectors',
    architect: 'Builder',
    trading: 'Paper',
    portfolio: 'Portfolio',
    social: 'Social',
    alpha: 'Alpha',
    analytics: 'Analytics',
    news: 'News',
  } satisfies Record<TabId, string>,
  {
    chain: 'Cadena',
    surface: 'Volatilidad',
    gex: 'GEX',
    flow: 'Flujo',
    sectors: 'Sectores',
    architect: 'Constructor',
    trading: 'Paper',
    portfolio: 'Portafolio',
    social: 'Social',
    alpha: 'Alpha',
    analytics: 'Analítica',
    news: 'Noticias',
  },
);

/** TABS with labels in the active language. */
export function useTabs(): readonly TabDef[] {
  const t = useT(tabMessages);
  return useMemo(() => TABS.map((tab) => ({ ...tab, label: t(tab.id) })), [t]);
}

export const DEFAULT_TAB: TabId = 'chain';

export function tabIdFromSlug(slug: string): TabId | undefined {
  return TABS.find((t) => t.slug === slug)?.id;
}

export function slugFromTabId(id: TabId): string {
  return TABS.find((t) => t.id === id)?.slug ?? TABS[0]!.slug;
}
