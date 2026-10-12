import ExpiryCountdown from '@components/ui/ExpiryCountdown';
import { TAB_GROUPS, type TabDef, type TabGroup } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';
import { useEffect, useMemo, useRef, useState } from 'react';

import AccountChip from './AccountChip';
import AssetModeToggle from './AssetModeToggle';
import { useSeenTabs } from './seen-tabs';
import { useTabFold } from './tab-fit';
import styles from './TopBar.module.css';
import VenueHealth from './VenueHealth';

interface TopBarProps {
  tabs: readonly TabDef[];
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}

interface TabGroupEntry {
  group: TabGroup;
  tabs: readonly TabDef[];
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

  const groups = useMemo<TabGroupEntry[]>(
    () =>
      TAB_GROUPS.map((group) => ({ group, tabs: tabs.filter((t) => t.group === group) })).filter(
        (g) => g.tabs.length > 0,
      ),
    [tabs],
  );
  const activeGroupIndex = groups.findIndex((g) => g.tabs.some((t) => t.id === activeTab));
  const activeLabel = tabs.find((t) => t.id === activeTab)?.label ?? 'More';

  const barRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fitRefs = useMemo(
    () => ({ bar: barRef, left: leftRef, right: rightRef, tabs: tabsRef, measure: measureRef }),
    [],
  );
  const fold = useTabFold(fitRefs, activeGroupIndex);
  const inlineGroups = groups.slice(0, groups.length - fold);
  const foldedGroups = groups.slice(groups.length - fold);

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

  return (
    <header className={styles.bar} ref={barRef}>
      <div className={styles.left} ref={leftRef}>
        <a href="#" className={styles.logo} aria-label="oggregator">
          <img src="/oggregator-logo.svg" alt="oggregator" />
        </a>
        {tradfiEnabled && <AssetModeToggle />}
      </div>

      <div className={styles.pillGroup} role="tablist" data-tour="views" ref={tabsRef}>
        {inlineGroups.map(({ group, tabs: groupTabs }, i) => (
          <div key={group} className={styles.group}>
            {i > 0 && <span className={styles.divider} aria-hidden="true" />}
            {groupTabs.map(renderTab)}
          </div>
        ))}
        {foldedGroups.length > 0 && (
          <MoreMenu
            groups={foldedGroups}
            showDivider={inlineGroups.length > 0}
            activeTab={activeTab}
            seenTabs={seenTabs}
            onSelect={setActiveTab}
          />
        )}
      </div>

      {/* Hidden full-width copy of the tabs; useTabFold reads its sizes. */}
      <div className={styles.measure} ref={measureRef} aria-hidden="true" inert>
        {groups.map(({ group, tabs: groupTabs }, i) => (
          <div key={group} className={styles.group} data-measure="group">
            {i > 0 && <span className={styles.divider} />}
            {groupTabs.map((tab) => (
              <span key={tab.id} className={styles.pill} data-active={tab.id === activeTab}>
                {tab.label}
                <TabIndicator tab={tab} seen={seenTabs.has(tab.id)} />
              </span>
            ))}
          </div>
        ))}
        <MoreTriggerGhost label="More" />
        <MoreTriggerGhost label={activeLabel} active />
      </div>

      <div className={styles.right} ref={rightRef}>
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

function MoreTriggerGhost({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={styles.more} data-measure={active ? 'more-active' : 'more'}>
      <span className={styles.divider} />
      <span className={styles.pill} data-active={active}>
        {label}
        <span className={styles.caret}>▾</span>
        <span className={styles.newDot} />
      </span>
    </div>
  );
}

interface MoreMenuProps {
  groups: readonly TabGroupEntry[];
  showDivider: boolean;
  activeTab: TabDef['id'];
  seenTabs: ReadonlySet<string>;
  onSelect: (id: TabDef['id']) => void;
}

function MoreMenu({ groups, showDivider, activeTab, seenTabs, onSelect }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tabs = groups.flatMap((g) => g.tabs);
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
      {showDivider && <span className={styles.divider} aria-hidden="true" />}
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
          {groups.map(({ group, tabs: groupTabs }, i) => (
            <div key={group} className={styles.menuGroup}>
              {i > 0 && <span className={styles.menuDivider} aria-hidden="true" />}
              {groupTabs.map((tab) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
