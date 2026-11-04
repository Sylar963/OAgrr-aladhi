import { AppShell } from '@components/layout';
import { TradfiApp } from '@features/tradfi';
import { SessionNotice } from '@components/ui';
import { ChartPanelLayer, useUnderlyings } from '@features/chain';
import { CustomTabView, WidgetFrame } from '@features/workspace';
import { useGlobalFeedStatus } from '@hooks/useGlobalFeedStatus';
import { useIsMobile } from '@hooks/useIsMobile';
import { useServerVersion } from '@hooks/useServerVersion';
import { useSessionTimeout } from '@hooks/useSessionTimeout';
import { useTabUrlSync } from '@hooks/useTabUrlSync';
import { useTabs } from '@lib/tabs';
import { MAIN_MARKET_ID, useAppStore, useMarket } from '@stores/app-store';
import { useEffect } from 'react';

import styles from './App.module.css';

export default function App() {
  useServerVersion();
  useSessionTimeout();
  useTabUrlSync();

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const activeTab = useAppStore((s) => s.activeTab);
  const activeMarketId = useAppStore((s) => s.activeMarketId);
  const isMobile = useIsMobile();
  useGlobalFeedStatus(useAppStore((s) => s.mainFeedClaims > 0));

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

  const customTabOpen = activeMarketId !== MAIN_MARKET_ID;
  useEffect(() => {
    if (isMobile && customTabOpen) setActiveTab(activeTab);
  }, [isMobile, customTabOpen, activeTab, setActiveTab]);

  const assetMode = useAppStore((s) => s.assetMode);
  const tabs = useTabs();

  if (assetMode === 'tradfi') return <TradfiApp />;

  return (
    <AppShell underlyings={underlyings} tabs={tabs}>
      <div className={styles.panel}>
        {customTabOpen && !isMobile ? (
          <CustomTabView key={activeMarketId} tabId={activeMarketId} />
        ) : (
          <WidgetFrame key={activeTab} kind={activeTab} />
        )}
      </div>
      <SessionNotice />
      <ChartPanelLayer />
    </AppShell>
  );
}
