import type { TabId } from '@lib/tabs';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ogg.seenTabs';

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Tabs the viewer has opened at least once; the active tab is recorded on visit. */
export function useSeenTabs(activeTab: TabId): ReadonlySet<string> {
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    if (seen.has(activeTab)) return;
    const next = new Set(seen).add(activeTab);
    setSeen(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {}
  }, [activeTab, seen]);

  return seen;
}
