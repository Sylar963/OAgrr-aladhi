import ExpiryCountdown from '@components/ui/ExpiryCountdown';
import { TAB_GROUPS, type TabDef, type TabGroup } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';

import AccountChip from './AccountChip';
import AssetModeToggle from './AssetModeToggle';
import { useSeenTabs } from './seen-tabs';
import styles from './TopBar.module.css';
import VenueHealth from './VenueHealth';

const COLLAPSIBLE_GROUP: TabGroup = 'research';

interface TopBarProps {
  tabs: readonly TabDef[];
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}

export default function TopBar({ tabs, onOpenPalette, onOpenShortcuts }: TopBarProps) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const underlying = useAppStore((s) => s.underlying);
  const seenTabs = useSeenTabs(activeTab);

  // Show the TradFi entry only when its backend is reachable: always in dev
  // (the /tradfi-api proxy), and in prod only once VITE_TRADFI_API_BASE is set.
  const tradfiEnabled = import.meta.env.DEV || Boolean(import.meta.env.VITE_TRADFI_API_BASE);
  // Aggr live charts (separate app); hidden until VITE_AGGR_URL is set.
  const aggrUrl = import.meta.env.VITE_AGGR_URL;

  const renderTab = (tab: TabDef) => (
    <button
      key={tab.id}
      className={styles.pill}
      role="tab"
      aria-selected={tab.id === activeTab}
      data-active={tab.id === activeTab}
      onClick={() => setActiveTab(tab.id)}
    >
      {tab.label}
      <TabIndicator tab={tab} seen={seenTabs.has(tab.id)} />
    </button>
  );

  const collapsibleTabs = tabs.filter((t) => t.group === COLLAPSIBLE_GROUP);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <a href="#" className={styles.logo} aria-label="oggregator">
          <img src="/oggregator-logo.svg" alt="oggregator" />
        </a>
        {tradfiEnabled && <AssetModeToggle />}
      </div>

      <div className={styles.pillGroup} role="tablist" data-tour="views">
        {TAB_GROUPS.map((group, i) => {
          const groupTabs = tabs.filter((t) => t.group === group);
          if (groupTabs.length === 0) return null;
          return (
            <div
              key={group}
              className={styles.group}
              data-collapsible={group === COLLAPSIBLE_GROUP || undefined}
            >
              {i > 0 && <span className={styles.divider} aria-hidden="true" />}
              {groupTabs.map(renderTab)}
            </div>
          );
        })}
        {collapsibleTabs.length > 0 && (
          <MoreMenu
            tabs={collapsibleTabs}
            activeTab={activeTab}
            seenTabs={seenTabs}
            onSelect={setActiveTab}
          />
        )}
      </div>

      <div className={styles.right}>
        <ExpiryCountdown />
        <VenueHealth />
        {aggrUrl && (
          <a
            className={styles.iconBtn}
            href={aggrUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Live charts (Aggr)"
            aria-label="Live charts (Aggr)"
          >
            ↗
          </a>
        )}
        <button
          className={styles.cmdk}
          onClick={onOpenPalette}
          data-tour="asset-picker"
          title="Switch underlying (⌘K)"
        >
          <span className={styles.asset}>{underlying}</span>
          <span className={styles.caret}>▾</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
        <AccountChip onOpenShortcuts={onOpenShortcuts} />
      </div>
    </header>
  );
}

function TabIndicator({ tab, seen }: { tab: TabDef; seen: boolean }) {
  if (tab.badge === 'LIVE') return <span className={styles.liveDot} title="Live" />;
  if (tab.badge === 'NEW' && !seen) return <span className={styles.newDot} title="New" />;
  return null;
}

interface MoreMenuProps {
  tabs: readonly TabDef[];
  activeTab: TabDef['id'];
  seenTabs: ReadonlySet<string>;
  onSelect: (id: TabDef['id']) => void;
}

function MoreMenu({ tabs, activeTab, seenTabs, onSelect }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeInMenu = tabs.find((t) => t.id === activeTab);
  const hasUnseen = tabs.some((t) => t.badge === 'NEW' && !seenTabs.has(t.id));

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className={styles.more} ref={wrapRef}>
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={styles.pill}
        data-active={activeInMenu != null}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {activeInMenu?.label ?? 'More'}
        <span className={styles.caret}>▾</span>
        {hasUnseen && <span className={styles.newDot} />}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              data-active={tab.id === activeTab}
              onClick={() => {
                onSelect(tab.id);
                setOpen(false);
              }}
            >
              {tab.label}
              <TabIndicator tab={tab} seen={seenTabs.has(tab.id)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
