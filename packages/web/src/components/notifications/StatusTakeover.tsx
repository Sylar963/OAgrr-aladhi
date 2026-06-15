import { type ActiveNotice, SEVERITY_ICON } from '@lib/system-status';
import { useEffect, useRef } from 'react';

import styles from './StatusTakeover.module.css';

const TITLE_ID = 'status-takeover-title';

export default function StatusTakeover({ notice }: { notice: ActiveNotice }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div ref={panelRef} tabIndex={-1} className={styles.panel} data-severity={notice.severity}>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden>
            {SEVERITY_ICON[notice.severity]}
          </span>
          <span className={styles.title} id={TITLE_ID}>
            {notice.title}
          </span>
        </div>
        {notice.message && <p className={styles.body}>{notice.message}</p>}
      </div>
    </div>
  );
}
