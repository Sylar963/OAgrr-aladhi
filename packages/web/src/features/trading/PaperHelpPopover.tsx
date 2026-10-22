import { defineMessages, useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';

import styles from './PaperHelpPopover.module.css';

const messages = defineMessages(
  {
    help: 'Paper trading help',
    title: 'Paper trading',
    signIn:
      'Sign in via the account chip in the top bar to get an API key — your paper book is tied to that account.',
    step1Before: 'Build a strategy in the ',
    step1Strong: 'Builder',
    step1After: ' tab.',
    step2Before: 'Click ',
    step2Strong: 'Send to paper',
    step2After: ' to open a position.',
    step3: 'Manage trades here — reduce, roll, or close.',
    step4Before: 'The ',
    step4Strong: 'Portfolio',
    step4After: ' tab shows vega/vanna/volga curves and shock P&L on this paper book.',
  },
  {
    help: 'Ayuda de paper trading',
    title: 'Paper trading',
    signIn:
      'Inicia sesión con el chip de cuenta en la barra superior para obtener una API key — tu libro paper está vinculado a esa cuenta.',
    step1Before: 'Arma una estrategia en la pestaña ',
    step1Strong: 'Constructor',
    step1After: '.',
    step2Before: 'Haz clic en ',
    step2Strong: 'Enviar a paper',
    step2After: ' para abrir una posición.',
    step3: 'Gestiona tus trades aquí — reducir, rolar o cerrar.',
    step4Before: 'La pestaña ',
    step4Strong: 'Portafolio',
    step4After: ' muestra curvas de vega/vanna/volga y P&L de shock de este libro paper.',
  },
);

export default function PaperHelpPopover() {
  const t = useT(messages);
  const accountId = useAppStore((s) => s.accountId);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onMouseDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls="paper-help-popover"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t('help')}</span>
        <span className={styles.triggerQ} aria-hidden="true">
          ?
        </span>
      </button>

      {open && (
        <div
          id="paper-help-popover"
          role="dialog"
          aria-label={t('help')}
          className={styles.popover}
        >
          <div className={styles.title}>{t('title')}</div>
          {accountId == null && (
            <p className={styles.paragraph}>{t('signIn')}</p>
          )}
          <ol className={styles.steps}>
            <li>
              {t('step1Before')}
              <strong>{t('step1Strong')}</strong>
              {t('step1After')}
            </li>
            <li>
              {t('step2Before')}
              <strong>{t('step2Strong')}</strong>
              {t('step2After')}
            </li>
            <li>{t('step3')}</li>
            <li>
              {t('step4Before')}
              <strong>{t('step4Strong')}</strong>
              {t('step4After')}
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
