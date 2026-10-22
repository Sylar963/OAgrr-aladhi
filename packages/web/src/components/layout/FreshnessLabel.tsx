import { useEffect, useState } from 'react';

import { defineMessages, useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';

const messages = defineMessages(
  {
    connecting: 'connecting…',
    reconnecting: 'reconnecting…',
    disconnected: 'disconnected',
    noData: 'no data',
    ago: '{age} ago',
  },
  {
    connecting: 'conectando…',
    reconnecting: 'reconectando…',
    disconnected: 'desconectado',
    noData: 'sin datos',
    ago: 'hace {age}',
  },
);

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatAge(ms);
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export default function FreshnessLabel() {
  const t = useT(messages);
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
    return <span>{t('connecting')}</span>;
  }

  if (connectionState === 'reconnecting') {
    return <span aria-live="polite">{t('reconnecting')}</span>;
  }

  if (connectionState === 'error') {
    return <span aria-live="polite">{t('disconnected')}</span>;
  }

  if (connectionState === 'live' && staleMs != null) {
    return <span>{formatLatency(staleMs)}</span>;
  }

  // Degraded: fall back to coarse "updated Xs ago" so users see the feed is stuck.
  if (lastUpdateMs == null) return <span>{t('noData')}</span>;
  const age = Date.now() - lastUpdateMs;
  return <span>{t('ago', { age: formatAge(age) })}</span>;
}
