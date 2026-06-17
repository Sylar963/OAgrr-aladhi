import { DEFAULT_TAB, slugFromTabId, tabIdFromSlug, type TabId } from '@lib/tabs';
import type { TradfiPage } from '@stores/app-store';

const TRADFI_PREFIX = 'tradfi';
// Listing every TradfiPage as a Record key forces exhaustiveness: adding a
// page to the union without adding it here becomes a compile error instead of
// a silent parse failure.
const TRADFI_PAGES: Record<TradfiPage, true> = { chain: true, gex: true };

// Hash route state, discriminated by asset mode. `ticker` is null when no
// ticker is encoded (e.g. a legacy `#chain` link or TradFi before selection).
export type RouteState =
  | { mode: 'crypto'; tab: TabId; ticker: string | null }
  | { mode: 'tradfi'; page: TradfiPage; ticker: string | null };

function isTradfiPage(value: string): value is TradfiPage {
  return Object.hasOwn(TRADFI_PAGES, value);
}

function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ticker = raw.trim().toUpperCase();
  return ticker.length > 0 ? ticker : null;
}

// Parse a `location.hash` value into route state. Tolerant of a missing
// leading `#`, empty input, unknown slugs, and an omitted TradFi page.
export function parseHash(rawHash: string): RouteState {
  const segments = rawHash
    .replace(/^#/, '')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (segments[0] === TRADFI_PREFIX) {
    const maybePage = segments[1];
    if (maybePage && isTradfiPage(maybePage)) {
      return { mode: 'tradfi', page: maybePage, ticker: normalizeTicker(segments[2]) };
    }
    // Page omitted: treat segment[1] (if present) as the ticker, default to chain.
    return { mode: 'tradfi', page: 'chain', ticker: normalizeTicker(maybePage) };
  }

  const tab = tabIdFromSlug(segments[0] ?? '') ?? DEFAULT_TAB;
  return { mode: 'crypto', tab, ticker: normalizeTicker(segments[1]) };
}

// Build the canonical `location.hash` (including the leading `#`) for a state.
export function buildHash(state: RouteState): string {
  const ticker = normalizeTicker(state.ticker);
  const base =
    state.mode === 'tradfi' ? `${TRADFI_PREFIX}/${state.page}` : slugFromTabId(state.tab);
  return `#${ticker ? `${base}/${ticker}` : base}`;
}
