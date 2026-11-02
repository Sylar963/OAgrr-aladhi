import { AccountAccessBoundary } from '@components/auth/AccountSessionProvider';
import { ErrorBoundary, Spinner } from '@components/ui';
import { ChainView } from '@features/chain';
import { defineMessages, useT } from '@lib/i18n';
import { type TabId, useTabs, WIDGET_TRAITS } from '@lib/tabs';
import { type ComponentType, lazy, Suspense } from 'react';

const WIDGET_VIEWS: Record<TabId, ComponentType> = {
  chain: ChainView,
  alpha: lazy(() => import('@features/alpha').then((m) => ({ default: m.AlphaView }))),
  architect: lazy(() =>
    import('@features/architect').then((m) => ({ default: m.ArchitectView })),
  ),
  trading: lazy(() => import('@features/trading').then((m) => ({ default: m.TradingView }))),
  portfolio: lazy(() =>
    import('@features/portfolio').then((m) => ({ default: m.PortfolioView })),
  ),
  social: lazy(() => import('@features/social').then((m) => ({ default: m.SocialView }))),
  surface: lazy(() => import('@features/surface').then((m) => ({ default: m.SurfaceView }))),
  flow: lazy(() => import('@features/flow').then((m) => ({ default: m.FlowView }))),
  sectors: lazy(() => import('@features/sectors').then((m) => ({ default: m.SectorsView }))),
  analytics: lazy(() =>
    import('@features/analytics').then((m) => ({ default: m.AnalyticsView })),
  ),
  gex: lazy(() => import('@features/gex').then((m) => ({ default: m.GexView }))),
  news: lazy(() => import('@features/news').then((m) => ({ default: m.NewsView }))),
};

const messages = defineMessages({ loading: 'Loading {label}…' }, { loading: 'Cargando {label}…' });

export default function WidgetFrame({ kind }: { kind: TabId }) {
  const t = useT(messages);
  const label = useTabs().find((tab) => tab.id === kind)?.label ?? kind;
  const View = WIDGET_VIEWS[kind];

  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={<Spinner size="lg" label={t('loading', { label })} />}>
        {WIDGET_TRAITS[kind].requiresAccount ? (
          <AccountAccessBoundary>
            <View />
          </AccountAccessBoundary>
        ) : (
          <View />
        )}
      </Suspense>
    </ErrorBoundary>
  );
}
