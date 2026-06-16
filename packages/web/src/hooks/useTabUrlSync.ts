import { useEffect, useRef } from 'react';

import { DEFAULT_TAB, slugFromTabId, tabIdFromSlug } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';

// TradFi is an `assetMode`, not a tab, so it gets its own reserved hash slug.
const TRADFI_SLUG = 'tradfi';

// Bidirectional sync between `location.hash` and `activeTab` / `assetMode`.
// Hash → store on mount and on `hashchange` (back/forward, manual edits).
// Store → hash on tab/asset-mode change. Initial sync uses `replaceState` so
// the landing entry isn't duplicated; subsequent changes use `pushState` so
// the back button navigates between views.
export function useTabUrlSync(): void {
  const activeTab = useAppStore((s) => s.activeTab);
  const assetMode = useAppStore((s) => s.assetMode);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const initialMount = useRef(true);

  useEffect(() => {
    const apply = () => {
      const slug = window.location.hash.replace(/^#/, '');
      if (slug === TRADFI_SLUG) {
        if (useAppStore.getState().assetMode !== 'tradfi') setAssetMode('tradfi');
        return;
      }
      if (useAppStore.getState().assetMode !== 'crypto') setAssetMode('crypto');
      const next = tabIdFromSlug(slug) ?? DEFAULT_TAB;
      if (next !== useAppStore.getState().activeTab) {
        setActiveTab(next);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [setActiveTab, setAssetMode]);

  useEffect(() => {
    const desired = assetMode === 'tradfi' ? `#${TRADFI_SLUG}` : `#${slugFromTabId(activeTab)}`;
    if (window.location.hash === desired) {
      initialMount.current = false;
      return;
    }
    const url = `${window.location.pathname}${window.location.search}${desired}`;
    if (initialMount.current) {
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    initialMount.current = false;
  }, [activeTab, assetMode]);
}
