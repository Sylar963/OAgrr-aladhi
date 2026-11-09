import { TABS, type TabId, WIDGET_TRAITS, type WidgetKind } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WidgetFrame from './WidgetFrame';

vi.mock('@components/auth/AccountSessionProvider', () => ({
  AccountAccessBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="account-boundary">{children}</div>
  ),
}));
vi.mock('@features/chain', () => ({
  ChainView: () => <div>view:chain</div>,
  ChainTableWidget: () => <div>card:chain-table</div>,
  ChainVenuesWidget: () => <div>card:chain-venues</div>,
}));
vi.mock('@features/alpha', () => ({ AlphaView: () => <div>view:alpha</div> }));
vi.mock('@features/architect', () => ({ ArchitectView: () => <div>view:architect</div> }));
vi.mock('@features/trading', () => ({ TradingView: () => <div>view:trading</div> }));
vi.mock('@features/portfolio', () => ({ PortfolioView: () => <div>view:portfolio</div> }));
vi.mock('@features/social', () => ({ SocialView: () => <div>view:social</div> }));
vi.mock('@features/surface', () => ({
  SurfaceView: () => <div>view:surface</div>,
  VolSmileWidget: () => <div>card:vol-smile</div>,
  AtmTermWidget: () => <div>card:atm-term</div>,
  RealizedVsImpliedWidget: () => <div>card:realized-vs-implied</div>,
  Surface3DWidget: () => <div>card:surface-3d</div>,
  IvRankWidget: () => <div>card:iv-rank</div>,
  SkewHistoryWidget: () => <div>card:skew-history</div>,
}));
vi.mock('@features/flow', () => ({ FlowView: () => <div>view:flow</div> }));
vi.mock('@features/sectors', () => ({ SectorsView: () => <div>view:sectors</div> }));
vi.mock('@features/analytics', () => ({
  AnalyticsView: () => <div>view:analytics</div>,
  OiSummaryWidget: () => <div>card:oi-summary</div>,
  VenueShareWidget: () => <div>card:venue-share</div>,
  TopPositionsWidget: () => <div>card:top-positions</div>,
  ExpiryCalendarWidget: () => <div>card:expiry-calendar</div>,
  VolCurvesWidget: () => <div>card:vol-curves</div>,
  BreakEvenWidget: () => <div>card:break-even</div>,
  TimeAtPriceWidget: () => <div>card:time-at-price</div>,
  OiByStrikeWidget: () => <div>card:oi-by-strike</div>,
  DvolChartWidget: () => <div>card:dvol-chart</div>,
  DvolHeatmapWidget: () => <div>card:dvol-heatmap</div>,
}));
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

describe('main feed claim', () => {
  afterEach(cleanup);

  it.each(
    TABS.map((tab) => tab.id),
  )('claims the socket only for feed widgets: %s', async (kind) => {
    useAppStore.setState({ mainFeedClaims: 0 });
    const { unmount } = render(<WidgetFrame kind={kind} />);
    await screen.findByText(`view:${kind}`);
    expect(useAppStore.getState().mainFeedClaims).toBe(WIDGET_TRAITS[kind].chainFeed ? 1 : 0);

    unmount();
    expect(useAppStore.getState().mainFeedClaims).toBe(0);
  });
});

describe('card widgets', () => {
  afterEach(cleanup);

  const cardKinds = (Object.keys(WIDGET_TRAITS) as WidgetKind[]).filter(
    (kind) => !TABS.some((tab) => tab.id === kind),
  );

  it('lists eighteen cards', () => {
    expect(cardKinds).toHaveLength(18);
  });

  it.each(cardKinds)('renders the %s card without needing an account', async (kind) => {
    useAppStore.setState({ mainFeedClaims: 0 });
    render(<WidgetFrame kind={kind} />);
    expect(await screen.findByText(`card:${kind}`)).toBeDefined();
    expect(screen.queryByTestId('account-boundary')).toBeNull();
    expect(useAppStore.getState().mainFeedClaims).toBe(WIDGET_TRAITS[kind].chainFeed ? 1 : 0);
  });

  it('holds the chain socket only for cards showing chain data', () => {
    expect(cardKinds.filter((kind) => WIDGET_TRAITS[kind].chainFeed).sort()).toEqual([
      'chain-table',
    ]);
  });
});
