import { useEffect, useState } from 'react';

import { useAppStore } from '@stores/app-store';

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatAgo(ms).replace(' ago', '');
}

function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function FreshnessLabel() {
  const lastUpdateMs = useAppStore((s) => s.feedStatus.lastUpdateMs);
  const staleMs = useAppStore((s) => s.feedStatus.staleMs);
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (lastUpdateMs == null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [lastUpdateMs]);

  if (connectionState === 'closed' || connectionState === 'connecting') {
    return <span>connecting…</span>;
  }

  if (connectionState === 'reconnecting') {
    return <span aria-live="polite">reconnecting…</span>;
  }

  if (connectionState === 'error') {
    return <span aria-live="polite">disconnected</span>;
  }

  if (connectionState === 'live' && staleMs != null) {
    return <span>{formatLatency(staleMs)}</span>;
  }

  // Degraded: fall back to coarse "updated Xs ago" so users see the feed is stuck.
  if (lastUpdateMs == null) return <span>no data</span>;
  const age = Date.now() - lastUpdateMs;
  return <span>{formatAgo(age)}</span>;
}
