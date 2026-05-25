import { type Toast, useAppStore } from '@stores/app-store';
import { useEffect } from 'react';

import styles from './ToastStack.module.css';

const AUTO_DISMISS_MS = 4000;

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className={styles.toast} data-tone={toast.tone}>
      <span className={styles.icon} aria-hidden>
        {toast.icon}
      </span>
      <span className={styles.text}>{toast.text}</span>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}

export default function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
