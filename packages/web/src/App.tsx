import { lazy, Suspense, useEffect } from 'react';

import { AppShell } from '@components/layout';
import { ChainView, useUnderlyings } from '@features/chain';
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

const TABS = [
  { id: 'chain', label: 'Chain' },
  { id: 'architect', label: 'Builder' },
  { id: 'trading', label: 'Paper' },
  { id: 'surface', label: 'Volatility' },
  { id: 'flow', label: 'Flow', badge: 'LIVE' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'gex', label: 'GEX' },
] as const;

export default function App() {
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

  return (
    <AppShell underlyings={underlyings} tabs={TABS}>
      <div className={styles.panel}>
        {activeTab === 'chain' && <ChainView />}
        <Suspense fallback={null}>
          {activeTab === 'architect' && <ArchitectView />}
          {activeTab === 'trading' && <TradingView />}
          {activeTab === 'surface' && <SurfaceView />}
          {activeTab === 'flow' && <FlowView />}
          {activeTab === 'analytics' && <AnalyticsView />}
          {activeTab === 'gex' && <GexView />}
        </Suspense>
      </div>
    </AppShell>
  );
}
