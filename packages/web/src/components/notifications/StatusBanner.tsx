import { SEVERITY_ICON, type ActiveNotice } from '@lib/system-status';

import styles from './StatusBanner.module.css';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = total % 60;
  return `${m}m ${s}s`;
}

interface StatusBannerProps {
  notice: ActiveNotice;
  now: number;
  onDismiss: () => void;
}

export default function StatusBanner({ notice, now, onDismiss }: StatusBannerProps) {
  const scheduled = notice.startsAt != null && notice.startsAt > now;
  const countdownMs = scheduled ? notice.startsAt! - now : null;
  const role = notice.severity === 'outage' || notice.severity === 'degraded' ? 'alert' : 'status';

  return (
    <div className={styles.banner} data-severity={notice.severity} role={role}>
      <span className={styles.icon} aria-hidden>
        {SEVERITY_ICON[notice.severity]}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{notice.title}</span>
        {notice.message && <span className={styles.message}>{notice.message}</span>}
        {countdownMs != null && <span className={styles.countdown}>in {formatCountdown(countdownMs)}</span>}
      </span>
      {notice.dismissible && (
        <button type="button" className={styles.close} aria-label="Dismiss" onClick={onDismiss}>
          ✕
        </button>
      )}
    </div>
  );
}
