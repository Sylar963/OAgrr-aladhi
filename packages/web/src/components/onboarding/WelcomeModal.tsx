import { useEffect, useRef, useState } from 'react';

import { useIsMobile } from '@hooks/useIsMobile';
import { hasSeenOnboarding, markOnboardingSeen } from '@lib/onboarding';
import { useAppStore } from '@stores/app-store';

import styles from './WelcomeModal.module.css';

export default function WelcomeModal() {
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
            Welcome to oggregator
          </span>
        </div>
        <p className={styles.body}>
          Cross-venue crypto options on one screen. Compare quotes, vol, and Greeks across Deribit,
          OKX, Bybit and more.
        </p>
        <div className={styles.actions}>
          {isMobile ? (
            <button
              type="button"
              ref={primaryRef}
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={dismiss}
            >
              Got it
            </button>
          ) : (
            <>
              <button type="button" className={styles.btn} onClick={dismiss}>
                Skip
              </button>
              <button
                type="button"
                ref={primaryRef}
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onTakeTour}
              >
                Take the tour
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
