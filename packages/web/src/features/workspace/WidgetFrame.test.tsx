import { TABS, type TabId, WIDGET_TRAITS } from '@lib/tabs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WidgetFrame from './WidgetFrame';

vi.mock('@components/auth/AccountSessionProvider', () => ({
  AccountAccessBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="account-boundary">{children}</div>
  ),
}));
vi.mock('@features/chain', () => ({ ChainView: () => <div>view:chain</div> }));
vi.mock('@features/alpha', () => ({ AlphaView: () => <div>view:alpha</div> }));
vi.mock('@features/architect', () => ({ ArchitectView: () => <div>view:architect</div> }));
vi.mock('@features/trading', () => ({ TradingView: () => <div>view:trading</div> }));
vi.mock('@features/portfolio', () => ({ PortfolioView: () => <div>view:portfolio</div> }));
vi.mock('@features/social', () => ({ SocialView: () => <div>view:social</div> }));
vi.mock('@features/surface', () => ({ SurfaceView: () => <div>view:surface</div> }));
vi.mock('@features/flow', () => ({ FlowView: () => <div>view:flow</div> }));
vi.mock('@features/sectors', () => ({ SectorsView: () => <div>view:sectors</div> }));
vi.mock('@features/analytics', () => ({ AnalyticsView: () => <div>view:analytics</div> }));
vi.mock('@features/gex', () => ({ GexView: () => <div>view:gex</div> }));
vi.mock('@features/news', () => ({ NewsView: () => <div>view:news</div> }));

function kindsWith(trait: 'chainFeed' | 'requiresAccount' | 'mobileToolbar'): TabId[] {
  return TABS.map((tab) => tab.id).filter((id) => WIDGET_TRAITS[id][trait]);
}

describe('WidgetFrame', () => {
  afterEach(cleanup);

  it.each(TABS.map((tab) => tab.id))('renders the %s view', async (kind) => {
    render(<WidgetFrame kind={kind} />);
    expect(await screen.findByText(`view:${kind}`)).toBeDefined();
  });

  it.each(TABS.map((tab) => tab.id))('guards %s only when it needs an account', async (kind) => {
    render(<WidgetFrame kind={kind} />);
    await screen.findByText(`view:${kind}`);
    expect(screen.queryByTestId('account-boundary') !== null).toBe(
      WIDGET_TRAITS[kind].requiresAccount,
    );
  });
});

describe('WIDGET_TRAITS', () => {
  it('keeps the main chain socket to Chain and Alpha', () => {
    expect(kindsWith('chainFeed').sort()).toEqual(['alpha', 'chain']);
  });

  it('requires an account for Paper, Portfolio and Social', () => {
    expect(kindsWith('requiresAccount').sort()).toEqual(['portfolio', 'social', 'trading']);
  });

  it('shows the mobile toolbar on market views only', () => {
    expect(kindsWith('mobileToolbar').sort()).toEqual([
      'alpha',
      'architect',
      'chain',
      'flow',
      'gex',
      'surface',
    ]);
  });
});
