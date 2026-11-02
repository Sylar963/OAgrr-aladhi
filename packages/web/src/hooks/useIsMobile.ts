import { MOBILE_QUERY } from '@lib/breakpoints';
import { useSyncExternalStore } from 'react';

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY) as LegacyMediaQueryList;
  const listener = () => callback();

  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }

  mql.addListener?.(listener);
  return () => mql.removeListener?.(listener);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
