import AssetModeToggle from '@components/layout/AssetModeToggle';
import styles from '@components/layout/TopBar.module.css';
import { TAB_GROUPS, type TabGroup } from '@lib/tabs';
import { type TradfiPage, useAppStore } from '@stores/app-store';
import { useEffect, useRef } from 'react';

import { useTradfiUnderlyings } from './queries';
import tradfiStyles from './TradfiApp.module.css';

const PAGES: ReadonlyArray<{ id: TradfiPage; label: string; group: TabGroup }> = [
  { id: 'chain', label: 'Chain', group: 'market' },
  { id: 'gex', label: 'GEX', group: 'market' },
  { id: 'vol', label: 'Volatility', group: 'market' },
  { id: 'builder', label: 'Builder', group: 'trade' },
  { id: 'alpha', label: 'Alpha', group: 'research' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export default function TradfiTopBar() {
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const page = useAppStore((s) => s.tradfiPage);
  const setPage = useAppStore((s) => s.setTradfiPage);
  const { data } = useTradfiUnderlyings();
  const underlyings = data?.underlyings ?? [];
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target);
      if (!cmdK && !slash) return;
      e.preventDefault();
      const select = selectRef.current;
      if (!select) return;
      select.focus();
      try {
        select.showPicker();
      } catch {}
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <a href="#" className={styles.logo} aria-label="oggregator">
          <img src="/oggregator-logo.svg" alt="oggregator" />
        </a>
        <AssetModeToggle />
      </div>

      <div className={styles.pillGroup} role="tablist" data-mobile="scroll">
        {TAB_GROUPS.map((group, i) => {
          const groupPages = PAGES.filter((p) => p.group === group);
          if (groupPages.length === 0) return null;
          return (
            <div key={group} className={styles.group}>
              {i > 0 && <span className={styles.divider} aria-hidden="true" />}
              {groupPages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  className={styles.pill}
                  aria-selected={page === p.id}
                  data-active={page === p.id}
                  onClick={() => setPage(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className={styles.right}>
        <span className={styles.notice} title="TastyTrade market data is delayed 15 minutes">
          <span className={styles.noticeDot} />
          15-min delayed
        </span>
        <div className={styles.cmdk} data-tour="asset-picker">
          <select
            ref={selectRef}
            className={tradfiStyles.tickerSelect}
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value)}
            aria-label="Underlying"
            title="Switch underlying (⌘K)"
          >
            {underlyings.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <span className={styles.caret}>▾</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </div>
      </div>
    </header>
  );
}
