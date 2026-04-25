import { useEffect, useState } from 'react';

import styles from './Architect.module.css';

interface SnapshotBannerProps {
  dataUpdatedAt: number;
  refreshIntervalMs: number;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SnapshotBanner({
  dataUpdatedAt,
  refreshIntervalMs,
}: SnapshotBannerProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!dataUpdatedAt) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span>Loading snapshot…</span>
      </div>
    );
  }

  const elapsed = Date.now() - dataUpdatedAt;
  const remainingMs = Math.max(0, refreshIntervalMs - elapsed);
  const seconds = Math.floor(remainingMs / 1000);

  return (
    <div className={styles.snapshotBanner}>
      <span className={styles.snapshotDot} />
      <span className={styles.snapshotPrimary}>
        Snapshot — refreshes in {formatCountdown(seconds)}
      </span>
      <span className={styles.snapshotSecondary}>
        prices may have moved since last fetch
      </span>
    </div>
  );
}
