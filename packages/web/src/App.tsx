import { AppShell } from '@components/layout';
import { TradfiApp } from '@features/tradfi';
import { SessionNotice } from '@components/ui';
import { ChartPanelLayer, useUnderlyings } from '@features/chain';
import { WidgetFrame } from '@features/workspace';
import { useGlobalFeedStatus } from '@hooks/useGlobalFeedStatus';
import { useServerVersion } from '@hooks/useServerVersion';
import { useSessionTimeout } from '@hooks/useSessionTimeout';
import { useTabUrlSync } from '@hooks/useTabUrlSync';
import { useTabs, WIDGET_TRAITS } from '@lib/tabs';
import { useAppStore, useMarket } from '@stores/app-store';
import { useEffect } from 'react';

import styles from './App.module.css';

export default function App() {
  useServerVersion();
  useSessionTimeout();
  useTabUrlSync();

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const activeTab = useAppStore((s) => s.activeTab);
  useGlobalFeedStatus(WIDGET_TRAITS[activeTab].chainFeed);

  const underlying = useMarket((m) => m.underlying);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  useEffect(() => {
    if (underlyings.length > 0 && !underlyings.includes(underlying)) {
      const baseFallback = underlying.split('_')[0];
      if (baseFallback && underlyings.includes(baseFallback)) {
        setUnderlying(baseFallback);
        return;
      }
      setUnderlying(underlyings[0]!);
    }
  }, [underlyings, underlying, setUnderlying]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('strategy')) {
      setActiveTab('architect');
    }
  }, [setActiveTab]);

  const assetMode = useAppStore((s) => s.assetMode);
  const tabs = useTabs();

  if (assetMode === 'tradfi') return <TradfiApp />;

  return (
    <AppShell underlyings={underlyings} tabs={tabs}>
      <div className={styles.panel}>
        <WidgetFrame key={activeTab} kind={activeTab} />
      </div>
      <SessionNotice />
      <ChartPanelLayer />
    </AppShell>
  );
}
