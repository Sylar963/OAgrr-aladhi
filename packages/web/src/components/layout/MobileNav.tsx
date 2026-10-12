import { useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';
import { TABS } from '@lib/tabs';

import styles from './MobileNav.module.css';

export default function MobileNav() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const aggrUrl = import.meta.env.VITE_AGGR_URL;
  const tradfiEnabled = import.meta.env.DEV || Boolean(import.meta.env.VITE_TRADFI_API_BASE);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeTab]);

  return (
    <nav className={styles.nav}>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={isActive ? activeRef : null}
            className={styles.tab}
            data-active={isActive}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
            {tab.badge && isActive && <span className={styles.badge}>{tab.badge}</span>}
          </button>
        );
      })}
      {aggrUrl && (
        <a className={styles.tab} href={aggrUrl} target="_blank" rel="noopener noreferrer">
          <span className={styles.icon}>↗</span>
          <span className={styles.label}>Charts</span>
        </a>
      )}
      {tradfiEnabled && (
        <button className={styles.tab} onClick={() => setAssetMode('tradfi')}>
          <span className={styles.icon}>⇄</span>
          <span className={styles.label}>TradFi</span>
        </button>
      )}
    </nav>
  );
}
