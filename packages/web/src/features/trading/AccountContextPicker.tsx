import { useFundedRuns } from '@features/funded';
import { venueStatus } from '@features/portfolio';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import { type ActiveContext, useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';
import styles from './AccountContextPicker.module.css';

const messages = defineMessages(
  {
    challenge: 'Challenge',
    live: 'Live',
    paper: 'Paper',
    account: 'Account',
    simPaper: 'Sim Paper',
    simChallenge: 'Sim Challenge',
    fundedLive: 'Funded Live',
    startChallenge: '+ Start challenge',
  },
  {
    challenge: 'Desafío',
    live: 'Real',
    paper: 'Paper',
    account: 'Cuenta',
    simPaper: 'Sim Paper',
    simChallenge: 'Sim Desafío',
    fundedLive: 'Fondeada real',
    startChallenge: '+ Iniciar desafío',
  },
);

function shortLabel(ctx: ActiveContext, t: Translate<typeof messages.en>): string {
  switch (ctx.kind) {
    case 'challenge':
      return t('challenge');
    case 'thalex':
      return t('live');
    default:
      return t('paper');
  }
}

export default function AccountContextPicker() {
  const t = useT(messages);
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
        aria-label={t('account')}
        aria-expanded={open}
        aria-haspopup="menu"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerHint}>{t('account')}</span>
        <span className={styles.label}>{shortLabel(activeContext, t)}</span>
        <span className={styles.chevron} data-open={open || undefined}>
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.panel} role="menu">
          <button
            key="paper"
            type="button"
            role="menuitem"
            className={styles.option}
            data-active={activeContext.kind === 'paper' || undefined}
            onClick={() => choose({ kind: 'paper' })}
          >
            {t('simPaper')}
          </button>
          {run != null ? (
            <button
              key="challenge"
              type="button"
              role="menuitem"
              className={styles.option}
              data-active={activeContext.kind === 'challenge' || undefined}
              onClick={() => choose({ kind: 'challenge', runId: run.id })}
            >
              {t('simChallenge')}
            </button>
          ) : null}
          {thalexConnected ? (
            <button
              key="thalex"
              type="button"
              role="menuitem"
              className={styles.option}
              data-active={activeContext.kind === 'thalex' || undefined}
              onClick={() => choose({ kind: 'thalex' })}
            >
              {t('fundedLive')}
            </button>
          ) : null}
          <button
            key="start-challenge"
            type="button"
            role="menuitem"
            className={styles.action}
            onClick={() =>
              choose(run != null ? { kind: 'challenge', runId: run.id } : { kind: 'challenge' })
            }
          >
            {t('startChallenge')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
