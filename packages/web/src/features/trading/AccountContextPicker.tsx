import { useFundedRuns } from '@features/funded';
import { venueStatus } from '@features/portfolio';
import { type ActiveContext, useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';
import styles from './AccountContextPicker.module.css';

function shortLabel(ctx: ActiveContext): string {
  switch (ctx.kind) {
    case 'challenge':
      return 'Challenge';
    case 'thalex':
      return 'Live';
    default:
      return 'Paper';
  }
}

export default function AccountContextPicker() {
  const runs = useFundedRuns();
  const run = runs.data?.runs?.[0] ?? null;

  const activeContext = useAppStore((s) => s.activeContext);
  const setActiveContext = useAppStore((s) => s.setActiveContext);

  const [thalexConnected, setThalexConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    venueStatus('thalex')
      .then((status) => {
        if (!cancelled) setThalexConnected(status.connected);
      })
      .catch(() => {
        if (!cancelled) setThalexConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  function choose(ctx: ActiveContext) {
    setActiveContext(ctx);
    setOpen(false);
  }

  return (
    <div className={styles.picker} data-open={open || undefined} ref={rootRef}>
      <button
        type="button"
        aria-label="account"
        aria-expanded={open}
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerHint}>Account</span>
        <span className={styles.label}>{shortLabel(activeContext)}</span>
        <span className={styles.chevron} data-open={open || undefined}>
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.panel}>
          <button
            key="paper"
            type="button"
            className={styles.option}
            data-active={activeContext.kind === 'paper' || undefined}
            onClick={() => choose({ kind: 'paper' })}
          >
            Sim Paper
          </button>
          {run != null ? (
            <button
              key="challenge"
              type="button"
              className={styles.option}
              data-active={activeContext.kind === 'challenge' || undefined}
              onClick={() => choose({ kind: 'challenge', runId: run.id })}
            >
              Sim Challenge
            </button>
          ) : null}
          {thalexConnected ? (
            <button
              key="thalex"
              type="button"
              className={styles.option}
              data-active={activeContext.kind === 'thalex' || undefined}
              onClick={() => choose({ kind: 'thalex' })}
            >
              Funded Live
            </button>
          ) : null}
          <button
            key="start-challenge"
            type="button"
            className={styles.action}
            onClick={() =>
              choose(run != null ? { kind: 'challenge', runId: run.id } : { kind: 'challenge' })
            }
          >
            + Start challenge
          </button>
        </div>
      ) : null}
    </div>
  );
}
