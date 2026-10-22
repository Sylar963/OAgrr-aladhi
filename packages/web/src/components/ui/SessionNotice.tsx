import { useEffect, useState } from 'react';

import { defineMessages, useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';

import styles from './SessionNotice.module.css';

const messages = defineMessages(
  {
    newVersion: 'New version available',
    newVersionBody:
      'The server has been updated with improvements and fixes. The page will refresh automatically to load the latest version.',
    refreshingIn: 'Refreshing in',
    updateNow: 'Update now',
    aboutToExpire: 'Session about to expire',
    aboutToExpireBody:
      'Your session has been inactive for a while. To keep resources available for active users, you will be logged out automatically.',
    autoLogoutIn: 'Auto-logout in',
    stayActive: 'Stay active',
    loggedOut: 'Logged out for inactivity',
    loggedOutBody:
      'Your session was ended after 30 minutes of inactivity. Idle sessions are released to keep live market data responsive for active users. Reload the page to start a new session.',
    reconnect: 'Reconnect',
  },
  {
    newVersion: 'Nueva versión disponible',
    newVersionBody:
      'El servidor se actualizó con mejoras y correcciones. La página se recargará automáticamente para cargar la última versión.',
    refreshingIn: 'Recargando en',
    updateNow: 'Actualizar ahora',
    aboutToExpire: 'Tu sesión está por expirar',
    aboutToExpireBody:
      'Tu sesión ha estado inactiva por un tiempo. Para mantener los recursos disponibles para usuarios activos, se cerrará automáticamente.',
    autoLogoutIn: 'Cierre automático en',
    stayActive: 'Seguir activo',
    loggedOut: 'Sesión cerrada por inactividad',
    loggedOutBody:
      'Tu sesión terminó tras 30 minutos de inactividad. Las sesiones inactivas se liberan para que los datos de mercado en vivo respondan rápido a los usuarios activos. Recarga la página para iniciar una nueva sesión.',
    reconnect: 'Reconectar',
  },
);

function reload() {
  window.location.reload();
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SessionNotice() {
  const t = useT(messages);
  const notice = useAppStore((s) => s.sessionNotice);
  const extendSession = useAppStore((s) => s.extendSession);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (notice?.kind !== 'idle-warning' && notice?.kind !== 'server-updated') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [notice?.kind]);

  const reloadAtMs = notice?.kind === 'server-updated' ? notice.reloadAtMs : undefined;
  useEffect(() => {
    if (reloadAtMs == null) return;
    const id = setTimeout(reload, Math.max(0, reloadAtMs - Date.now()));
    return () => clearTimeout(id);
  }, [reloadAtMs]);

  if (!notice) return null;

  const titleId = 'session-notice-title';

  if (notice.kind === 'server-updated') {
    return (
      <div className={styles.corner} role="alertdialog" aria-labelledby={titleId}>
        <div className={styles.panel} data-kind="server-updated">
          <div className={styles.header}>
            <span className={styles.icon} aria-hidden>
              ↻
            </span>
            <span className={styles.title} id={titleId}>
              {t('newVersion')}
            </span>
          </div>
          <p className={styles.body}>{t('newVersionBody')}</p>
          {reloadAtMs != null && (
            <div className={styles.countdown}>
              <span>{t('refreshingIn')}</span>
              <span className={styles.countdownValue}>{formatCountdown(reloadAtMs - now)}</span>
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={reload}>
              {t('updateNow')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (notice.kind === 'idle-warning') {
    const remaining = (notice.autoLogoutAtMs ?? now) - now;
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.panel} data-kind="idle-warning">
          <div className={styles.header}>
            <span className={styles.icon} aria-hidden>
              ⏱
            </span>
            <span className={styles.title} id={titleId}>
              {t('aboutToExpire')}
            </span>
          </div>
          <p className={styles.body}>{t('aboutToExpireBody')}</p>
          <div className={styles.countdown}>
            <span>{t('autoLogoutIn')}</span>
            <span className={styles.countdownValue}>{formatCountdown(remaining)}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={extendSession}>
              {t('stayActive')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.panel} data-kind="idle-logout">
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden>
            ⏻
          </span>
          <span className={styles.title} id={titleId}>
            {t('loggedOut')}
          </span>
        </div>
        <p className={styles.body}>{t('loggedOutBody')}</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={reload}>
            {t('reconnect')}
          </button>
        </div>
      </div>
    </div>
  );
}
