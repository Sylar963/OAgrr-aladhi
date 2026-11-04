import { MOBILE_QUERY } from '@lib/breakpoints';
import { buildHash, parseHash, type RouteState } from '@lib/route-hash';
import { DEFAULT_TAB } from '@lib/tabs';
import {
  MAIN_MARKET_ID,
  selectActiveCustomTab,
  selectActiveMarket,
  useAppStore,
  useMarket,
} from '@stores/app-store';
import { useEffect, useRef } from 'react';

// The "view key" is everything in the hash EXCEPT the ticker. It decides
// push vs replace: a view change (tab / asset-mode / TradFi page) pushes a
// history entry; a ticker-only change replaces, so cycling tickers doesn't
// bury the back button.
function viewKey(state: RouteState): string {
  if (state.mode === 'tradfi') return `tradfi/${state.page}`;
  return state.mode === 'custom' ? `custom/${state.id}` : `crypto/${state.tab}`;
}

function applyCryptoTicker(ticker: string | null): void {
  const s = useAppStore.getState();
  // Only set when present and changed — the setter clears expiry.
  if (ticker && ticker !== selectActiveMarket(s).underlying) s.setUnderlying(ticker);
}

// Bidirectional sync between `location.hash` and the store's view state
// (tab / custom tab / asset-mode / TradFi page) plus the selected ticker.
//   Hash → store on mount and on `hashchange` (back/forward, manual edits).
//   Store → hash on change. The first mount adopts an incoming hash as-is and
//   only seeds a canonical hash when none is present, so a shared deep link is
//   never overwritten or flickered.
export function useTabUrlSync(): void {
  const activeTab = useAppStore((s) => s.activeTab);
  const activeMarketId = useAppStore((s) => s.activeMarketId);
  const assetMode = useAppStore((s) => s.assetMode);
  const underlying = useMarket((m) => m.underlying);
  const tradfiUnderlying = useAppStore((s) => s.tradfiUnderlying);
  const tradfiPage = useAppStore((s) => s.tradfiPage);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setAssetMode = useAppStore((s) => s.setAssetMode);
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
      if (route.mode === 'custom') {
        // Layouts live on one device, so a link from elsewhere may name a tab that isn't here.
        const known = s.customTabs.some((tab) => tab.id === route.id);
        if (known && !window.matchMedia?.(MOBILE_QUERY).matches) {
          if (s.activeMarketId !== route.id) s.openCustomTab(route.id);
          applyCryptoTicker(route.ticker);
        } else {
          setActiveTab(DEFAULT_TAB);
        }
        return;
      }
      if (route.tab !== s.activeTab || s.activeMarketId !== MAIN_MARKET_ID) {
        setActiveTab(route.tab);
      }
      applyCryptoTicker(route.ticker);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [setActiveTab, setAssetMode, setTradfiUnderlying, setTradfiPage]);

  // Store → hash. Reads the live store via getState() rather than the closure
  // selector values, so a React StrictMode double-mount (which re-runs this
  // effect before the store-driven re-render commits) still sees what the
  // Hash→store effect just wrote and won't clobber an incoming deep link with
  // stale initial values.
  useEffect(() => {
    const s = useAppStore.getState();
    const customTab = selectActiveCustomTab(s);
    const ticker = selectActiveMarket(s).underlying || null;
    const route: RouteState =
      s.assetMode === 'tradfi'
        ? { mode: 'tradfi', page: s.tradfiPage, ticker: s.tradfiUnderlying || null }
        : customTab
          ? { mode: 'custom', id: customTab.id, ticker }
          : { mode: 'crypto', tab: s.activeTab, ticker };
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
  }, [activeTab, activeMarketId, assetMode, underlying, tradfiUnderlying, tradfiPage]);
}
