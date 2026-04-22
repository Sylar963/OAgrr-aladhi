import { useEffect, useState } from 'react';

import { useAppStore } from '@stores/app-store';

function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function FreshnessLabel() {
  const lastUpdateMs = useAppStore((s) => s.feedStatus.lastUpdateMs);
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
  if (lastUpdateMs == null) return <span>no data</span>;

  const age = Date.now() - lastUpdateMs;
  return <span>{`updated ${formatAgo(age)}`}</span>;
}
