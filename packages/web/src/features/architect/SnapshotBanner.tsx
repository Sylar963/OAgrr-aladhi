import { useEffect, useState } from 'react';

import styles from './Architect.module.css';

interface SnapshotBannerProps {
  dataUpdatedAt: number;
  hasData: boolean;
  isFetching: boolean;
  windowLabel: string;
  intervalLabel: string;
  isSwitchingWindow?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
}

function formatAge(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s ago`;
  return `${m}m ${s.toString().padStart(2, '0')}s ago`;
}

export default function SnapshotBanner({
  dataUpdatedAt,
  hasData,
  isFetching,
  windowLabel,
  intervalLabel,
  isSwitchingWindow = false,
  isError = false,
  errorMessage = null,
  isEmpty = false,
  onRetry,
}: SnapshotBannerProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Show retries explicitly so the button click has immediate visible feedback.
  if (isError && isFetching) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Retrying live history…</span>
        <span className={styles.snapshotSecondary}>fetching from upstream</span>
      </div>
    );
  }

  // Hard error: latest fetch failed AND there's no cached data on screen.
  // This is the "you have nothing to look at" case.
  if (isError && !hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Live history unavailable</span>
        <span className={styles.snapshotSecondary}>
          {errorMessage ?? 'upstream candle fetch failed'}
        </span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  // `keepPreviousData` leaves the last good history window on screen, so this
  // becomes a stale-data warning rather than a hard outage.
  if (isError && hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>History sync stale</span>
        <span className={styles.snapshotSecondary}>
          {errorMessage ?? 'last refresh failed — showing cached candles'}
        </span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span>Loading live chart…</span>
      </div>
    );
  }

  // Empty history is distinct from loading: the request succeeded but the
  // upstream payload could not produce usable candles.
  if (isEmpty && !isFetching) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>No live history available</span>
        <span className={styles.snapshotSecondary}>upstream returned empty data</span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  // keepPreviousData keeps the previous window visible while the new tenor's
  // history loads.
  if (isSwitchingWindow) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>Switching live window…</span>
        <span className={styles.snapshotSecondary}>{windowLabel} window · {intervalLabel} candles</span>
      </div>
    );
  }

  const elapsed = dataUpdatedAt ? Date.now() - dataUpdatedAt : 0;
  const seconds = Math.floor(elapsed / 1000);
  const livePrimary = isFetching ? 'Refreshing Deribit perp history…' : 'Deribit perp history active';

  return (
    <div className={styles.snapshotBanner} data-state={isFetching ? 'loading' : 'fresh'}>
      <span className={styles.snapshotDot} />
      <span className={styles.snapshotPrimary}>{livePrimary}</span>
      <span className={styles.snapshotSecondary}>
        {windowLabel} window · {intervalLabel} candles · sync {formatAge(seconds)}
      </span>
    </div>
  );
}
