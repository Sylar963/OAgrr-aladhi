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
  group: TabGroup;
  badge?: 'NEW' | 'LIVE';
}

export interface WidgetTraits {
  /** Holds the app's main chain socket open while visible. */
  chainFeed: boolean;
  requiresAccount: boolean;
  mobileToolbar: boolean;
}

export const WIDGET_TRAITS: Record<TabId, WidgetTraits> = {
  chain: { chainFeed: true, requiresAccount: false, mobileToolbar: true },
  alpha: { chainFeed: true, requiresAccount: false, mobileToolbar: true },
  architect: { chainFeed: false, requiresAccount: false, mobileToolbar: true },
  surface: { chainFeed: false, requiresAccount: false, mobileToolbar: true },
  flow: { chainFeed: false, requiresAccount: false, mobileToolbar: true },
  gex: { chainFeed: false, requiresAccount: false, mobileToolbar: true },
  trading: { chainFeed: false, requiresAccount: true, mobileToolbar: false },
  portfolio: { chainFeed: false, requiresAccount: true, mobileToolbar: false },
  social: { chainFeed: false, requiresAccount: true, mobileToolbar: false },
  analytics: { chainFeed: false, requiresAccount: false, mobileToolbar: false },
  news: { chainFeed: false, requiresAccount: false, mobileToolbar: false },
  sectors: { chainFeed: false, requiresAccount: false, mobileToolbar: false },
};

export type WidgetKind = TabId;

export function isWidgetKind(value: string): value is WidgetKind {
  return Object.hasOwn(WIDGET_TRAITS, value);
}

export const TAB_GROUPS: readonly TabGroup[] = ['market', 'trade', 'research'];

export const TABS: readonly TabDef[] = [
  { id: 'chain', label: 'Chain', slug: 'chain', group: 'market' },
  { id: 'surface', label: 'Volatility', slug: 'volatility', group: 'market' },
  { id: 'gex', label: 'GEX', slug: 'gex', group: 'market' },
  { id: 'flow', label: 'Flow', slug: 'flow', group: 'market', badge: 'LIVE' },
  { id: 'sectors', label: 'Sectors', slug: 'sectors', group: 'market', badge: 'NEW' },
  { id: 'architect', label: 'Builder', slug: 'builder', group: 'trade' },
  { id: 'trading', label: 'Paper', slug: 'paper', group: 'trade' },
  { id: 'portfolio', label: 'Portfolio', slug: 'portfolio', group: 'trade', badge: 'NEW' },
  { id: 'social', label: 'Social', slug: 'social', group: 'trade', badge: 'NEW' },
  { id: 'alpha', label: 'Alpha', slug: 'alpha', group: 'research', badge: 'NEW' },
  { id: 'analytics', label: 'Analytics', slug: 'analytics', group: 'research' },
  { id: 'news', label: 'News', slug: 'news', group: 'research', badge: 'NEW' },
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
