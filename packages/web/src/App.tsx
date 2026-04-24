import { lazy, Suspense, useEffect } from 'react';

import { AppShell } from '@components/layout';
import { ChainView, useUnderlyings } from '@features/chain';
import { ErrorBoundary, SessionNotice, Spinner } from '@components/ui';
import { useServerVersion } from '@hooks/useServerVersion';
import { useSessionTimeout } from '@hooks/useSessionTimeout';
import { useAppStore } from '@stores/app-store';

import styles from './App.module.css';

const SurfaceView = lazy(() =>
  import('@features/surface').then((m) => ({ default: m.SurfaceView })),
);
const GexView = lazy(() => import('@features/gex').then((m) => ({ default: m.GexView })));
const FlowView = lazy(() => import('@features/flow').then((m) => ({ default: m.FlowView })));
const AnalyticsView = lazy(() =>
  import('@features/analytics').then((m) => ({ default: m.AnalyticsView })),
);
const ArchitectView = lazy(() =>
  import('@features/architect').then((m) => ({ default: m.ArchitectView })),
);
const TradingView = lazy(() =>
  import('@features/trading').then((m) => ({ default: m.TradingView })),
);
const AlphaView = lazy(() =>
  import('@features/alpha').then((m) => ({ default: m.AlphaView })),
);

const TABS = [
  { id: 'chain', label: 'Chain' },
  { id: 'alpha', label: 'Alpha', badge: 'NEW' },
  { id: 'architect', label: 'Builder' },
  { id: 'trading', label: 'Paper' },
  { id: 'surface', label: 'Volatility' },
  { id: 'flow', label: 'Flow', badge: 'LIVE' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'gex', label: 'GEX' },
] as const;

export default function App() {
  useServerVersion();
  useSessionTimeout();

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const activeTab = useAppStore((s) => s.activeTab);

  const underlying = useAppStore((s) => s.underlying);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  useEffect(() => {
    if (underlyings.length > 0 && !underlyings.includes(underlying)) {
      setUnderlying(underlyings[0]!);
    }
  }, [underlyings, underlying, setUnderlying]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('strategy')) {
      setActiveTab('architect');
    }
  }, [setActiveTab]);

  const activeLabel = TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

  return (
    <AppShell underlyings={underlyings} tabs={TABS}>
      <div className={styles.panel}>
        <ErrorBoundary key={activeTab} label={activeLabel}>
          {activeTab === 'chain' && <ChainView />}
          <Suspense fallback={<Spinner size="lg" label={`Loading ${activeLabel}…`} />}>
            {activeTab === 'alpha' && <AlphaView />}
            {activeTab === 'architect' && <ArchitectView />}
            {activeTab === 'trading' && <TradingView />}
            {activeTab === 'surface' && <SurfaceView />}
            {activeTab === 'flow' && <FlowView />}
            {activeTab === 'analytics' && <AnalyticsView />}
            {activeTab === 'gex' && <GexView />}
          </Suspense>
        </ErrorBoundary>
      </div>
      <SessionNotice />
    </AppShell>
  );
}
