import { ChainStatsWidget, ChainTableWidget, ChainVenuesWidget } from '@features/chain';
import type { CardKind } from '@lib/tabs';
import { type ComponentType, lazy } from 'react';

const CARD_VIEWS: Record<CardKind, ComponentType<{ underlying?: string }>> = {
  'chain-table': ChainTableWidget,
  'chain-stats': ChainStatsWidget,
  'chain-venues': ChainVenuesWidget,
  'oi-summary': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.OiSummaryWidget })),
  ),
  'venue-share': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.VenueShareWidget })),
  ),
  'top-positions': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.TopPositionsWidget })),
  ),
  'expiry-calendar': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.ExpiryCalendarWidget })),
  ),
  'vol-curves': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.VolCurvesWidget })),
  ),
  'break-even': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.BreakEvenWidget })),
  ),
  'time-at-price': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.TimeAtPriceWidget })),
  ),
  'oi-by-strike': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.OiByStrikeWidget })),
  ),
  'dvol-chart': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.DvolChartWidget })),
  ),
  'dvol-heatmap': lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.DvolHeatmapWidget })),
  ),
  'vol-smile': lazy(() => import('@features/surface').then((m) => ({ default: m.VolSmileWidget }))),
  'atm-term': lazy(() => import('@features/surface').then((m) => ({ default: m.AtmTermWidget }))),
  'realized-vs-implied': lazy(() =>
    import('@features/surface').then((m) => ({ default: m.RealizedVsImpliedWidget })),
  ),
  'surface-3d': lazy(() =>
    import('@features/surface').then((m) => ({ default: m.Surface3DWidget })),
  ),
  'iv-rank': lazy(() => import('@features/surface').then((m) => ({ default: m.IvRankWidget }))),
  'skew-history': lazy(() =>
    import('@features/surface').then((m) => ({ default: m.SkewHistoryWidget })),
  ),
};

export default function CardView({ kind, underlying }: { kind: CardKind; underlying?: string }) {
  const View = CARD_VIEWS[kind];
  return <View underlying={underlying} />;
}
