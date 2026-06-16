import { buildHash, parseHash, type RouteState } from '@lib/route-hash';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef } from 'react';

// The "view key" is everything in the hash EXCEPT the ticker. It decides
// push vs replace: a view change (tab / asset-mode / TradFi page) pushes a
// history entry; a ticker-only change replaces, so cycling tickers doesn't
// bury the back button.
function viewKey(state: RouteState): string {
  return state.mode === 'tradfi' ? `tradfi/${state.page}` : `crypto/${state.tab}`;
}

// Bidirectional sync between `location.hash` and the store's view state
// (tab / asset-mode / TradFi page) plus the selected ticker.
//   Hash → store on mount and on `hashchange` (back/forward, manual edits).
//   Store → hash on change. The first mount adopts an incoming hash as-is and
//   only seeds a canonical hash when none is present, so a shared deep link is
//   never overwritten or flickered.
export function useTabUrlSync(): void {
  const activeTab = useAppStore((s) => s.activeTab);
  const assetMode = useAppStore((s) => s.assetMode);
  const underlying = useAppStore((s) => s.underlying);
  const tradfiUnderlying = useAppStore((s) => s.tradfiUnderlying);
  const tradfiPage = useAppStore((s) => s.tradfiPage);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  const setTradfiUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const setTradfiPage = useAppStore((s) => s.setTradfiPage);
  const initialMount = useRef(true);
  const lastViewKey = useRef<string | null>(null);

  // Hash → store.
  useEffect(() => {
    const apply = () => {
      const route = parseHash(window.location.hash);
      const s = useAppStore.getState();
      if (route.mode === 'tradfi') {
        if (s.assetMode !== 'tradfi') setAssetMode('tradfi');
        if (route.page !== s.tradfiPage) setTradfiPage(route.page);
        // Only set when present and changed — the setter clears expiry.
        if (route.ticker && route.ticker !== s.tradfiUnderlying) {
          setTradfiUnderlying(route.ticker);
        }
        return;
      }
      if (s.assetMode !== 'crypto') setAssetMode('crypto');
      if (route.tab !== s.activeTab) setActiveTab(route.tab);
      if (route.ticker && route.ticker !== s.underlying) {
        setUnderlying(route.ticker);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [setActiveTab, setAssetMode, setUnderlying, setTradfiUnderlying, setTradfiPage]);

  // Store → hash.
  useEffect(() => {
    const route: RouteState =
      assetMode === 'tradfi'
        ? { mode: 'tradfi', page: tradfiPage, ticker: tradfiUnderlying || null }
        : { mode: 'crypto', tab: activeTab, ticker: underlying || null };
    const desired = buildHash(route);
    const key = viewKey(route);

    if (initialMount.current) {
      initialMount.current = false;
      lastViewKey.current = key;
      // Adopt an incoming hash as-is (Hash → store already applied it).
      if (window.location.hash && window.location.hash !== '#') return;
      // No hash on first load — seed the canonical URL without a history entry.
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${desired}`,
      );
      return;
    }

    if (window.location.hash === desired) {
      lastViewKey.current = key;
      return;
    }

    const url = `${window.location.pathname}${window.location.search}${desired}`;
    if (lastViewKey.current === key) {
      // Ticker-only change within the same view — replace, don't grow history.
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    lastViewKey.current = key;
  }, [activeTab, assetMode, underlying, tradfiUnderlying, tradfiPage]);
}
