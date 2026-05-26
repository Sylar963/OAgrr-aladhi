import { HelpMenu } from '@components/onboarding';

import ExpiryCountdown from '@components/ui/ExpiryCountdown';
import { useAppStore } from '@stores/app-store';
import AccountChip from './AccountChip';
import FreshnessLabel from './FreshnessLabel';
import styles from './TopBar.module.css';
import VenueStatusRow from './VenueStatusRow';

interface Tab {
  id: string;
  label: string;
  badge?: string;
}

interface TopBarProps {
  tabs: readonly Tab[];
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}

export default function TopBar({ tabs, onOpenPalette, onOpenShortcuts }: TopBarProps) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);

  return (
    <header className={styles.bar}>
      <a href="#" className={styles.logo} aria-label="oggregator">
        <img src="/oggregator-logo.svg" alt="oggregator" />
      </a>

      <div className={styles.pillGroup} role="tablist" data-tour="views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={styles.pill}
            role="tab"
            aria-selected={tab.id === activeTab}
            data-active={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
          >
            {tab.label}
            {tab.badge && <span className={styles.badge}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div className={styles.right}>
        <ExpiryCountdown />
        <div className={styles.status} data-state={connectionState} data-tour="venue-status">
          <VenueStatusRow />
          <span className={styles.freshness}>
            <FreshnessLabel />
          </span>
        </div>
        <AccountChip />
        <HelpMenu onOpenShortcuts={onOpenShortcuts} />
        <button className={styles.cmdk} onClick={onOpenPalette} data-tour="asset-picker">
          ⌘K
        </button>
      </div>
    </header>
  );
}
