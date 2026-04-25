import { useEffect, useState } from 'react';

import styles from './Architect.module.css';

interface SnapshotBannerProps {
  dataUpdatedAt: number;
  refreshIntervalMs: number;
  hasData: boolean;
  isFetching: boolean;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SnapshotBanner({
  dataUpdatedAt,
  refreshIntervalMs,
  hasData,
  isFetching,
}: SnapshotBannerProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span>Loading snapshot…</span>
      </div>
    );
  }

  // Tenor switch: candle data from previous query is still on screen via
  // keepPreviousData, but a new fetch is in flight. Show a transient
  // "updating" state so the user knows the chart is mid-swap.
  if (isFetching && !dataUpdatedAt) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Updating snapshot…</span>
        <span className={styles.snapshotSecondary}>tenor changed — refetching</span>
      </div>
    );
  }

  const elapsed = dataUpdatedAt ? Date.now() - dataUpdatedAt : 0;
  const remainingMs = Math.max(0, refreshIntervalMs - elapsed);
  const seconds = Math.floor(remainingMs / 1000);

  return (
    <div className={styles.snapshotBanner} data-state={isFetching ? 'refreshing' : 'fresh'}>
      <span className={styles.snapshotDot} />
      <span className={styles.snapshotPrimary}>
        {isFetching ? 'Refreshing snapshot…' : `Snapshot — refreshes in ${formatCountdown(seconds)}`}
      </span>
      <span className={styles.snapshotSecondary}>
        prices may have moved since last fetch
      </span>
    </div>
  );
}
