import { useIsMobile } from '@hooks/useIsMobile';
import { defineMessages, useT } from '@lib/i18n';
import { hasSeenOnboarding, markOnboardingSeen } from '@lib/onboarding';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';

import styles from './WelcomeModal.module.css';

const messages = defineMessages(
  {
    title: 'Welcome to oggregator',
    body: 'Cross-venue crypto options on one screen. Compare quotes, vol, and Greeks across Deribit, OKX, Bybit and more.',
    gotIt: 'Got it',
    skip: 'Skip',
    takeTour: 'Take the tour',
  },
  {
    title: 'Bienvenido a oggregator',
    body: 'Opciones cripto de varios exchanges en una sola pantalla. Compara cotizaciones, vol y Greeks entre Deribit, OKX, Bybit y más.',
    gotIt: 'Entendido',
    skip: 'Omitir',
    takeTour: 'Hacer el recorrido',
  },
);

export default function WelcomeModal() {
  const t = useT(messages);
  const [visible, setVisible] = useState(() => !hasSeenOnboarding());
  const isMobile = useIsMobile();
  const startTour = useAppStore((s) => s.startTour);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        markOnboardingSeen();
        setVisible(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    markOnboardingSeen();
    setVisible(false);
  };

  const onTakeTour = () => {
    markOnboardingSeen();
    setVisible(false);
    startTour();
  };

  const titleId = 'welcome-modal-title';

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            ◎
          </span>
          <span className={styles.title} id={titleId}>
            {t('title')}
          </span>
        </div>
        <p className={styles.body}>{t('body')}</p>
        <div className={styles.actions}>
          {isMobile ? (
            <button
              type="button"
              ref={primaryRef}
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={dismiss}
            >
              {t('gotIt')}
            </button>
          ) : (
            <>
              <button type="button" className={styles.btn} onClick={dismiss}>
                {t('skip')}
              </button>
              <button
                type="button"
                ref={primaryRef}
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onTakeTour}
              >
                {t('takeTour')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
