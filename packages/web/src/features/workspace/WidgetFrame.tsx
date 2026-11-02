import { AccountAccessBoundary } from '@components/auth/AccountSessionProvider';
import { ErrorBoundary, Spinner } from '@components/ui';
import { ChainView } from '@features/chain';
import { defineMessages, useT } from '@lib/i18n';
import { isCardKind, type TabId, useTabs, WIDGET_TRAITS, type WidgetKind } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';
import { type ComponentType, lazy, Suspense, useEffect } from 'react';

const TAB_VIEWS: Record<TabId, ComponentType> = {
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

const CardView = lazy(() => import('./CardView'));

const messages = defineMessages({ loading: 'Loading {label}…' }, { loading: 'Cargando {label}…' });

interface WidgetFrameProps {
  kind: WidgetKind;
  /** Card titles live in the custom tab chunk, so DockHost passes them in. */
  label?: string;
}

export default function WidgetFrame({ kind, label: cardLabel }: WidgetFrameProps) {
  const t = useT(messages);
  const tabLabel = useTabs().find((tab) => tab.id === kind)?.label;
  const label = cardLabel ?? tabLabel ?? kind;
  const claimMainFeed = useAppStore((s) => s.claimMainFeed);
  const { chainFeed } = WIDGET_TRAITS[kind];

  useEffect(() => (chainFeed ? claimMainFeed() : undefined), [chainFeed, claimMainFeed]);

  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={<Spinner size="lg" label={t('loading', { label })} />}>
        {isCardKind(kind) ? (
          <CardView kind={kind} />
        ) : (
          <TabView kind={kind} />
        )}
      </Suspense>
    </ErrorBoundary>
  );
}

function TabView({ kind }: { kind: TabId }) {
  const View = TAB_VIEWS[kind];
  return WIDGET_TRAITS[kind].requiresAccount ? (
    <AccountAccessBoundary>
      <View />
    </AccountAccessBoundary>
  ) : (
    <View />
  );
}
