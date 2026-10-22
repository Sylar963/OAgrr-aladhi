import { useEffect, useState } from 'react';

import { defineMessages, useT, type Translate } from '@lib/i18n';

import styles from './Architect.module.css';

const messages = defineMessages(
  {
    secondsAgo: '{s}s ago',
    minutesAgo: '{m}m {s}s ago',
    retrying: 'Retrying live history…',
    fetchingUpstream: 'fetching from upstream',
    unavailable: 'Live history unavailable',
    fetchFailed: 'upstream candle fetch failed',
    retry: 'Retry',
    stale: 'History sync stale',
    showingCached: 'last refresh failed — showing cached candles',
    loading: 'Loading live chart…',
    noHistory: 'No live history available',
    emptyUpstream: 'upstream returned empty data',
    switching: 'Switching live window…',
    windowCandles: '{window} window · {interval} candles',
    refreshing: 'Refreshing Deribit perp history…',
    active: 'Deribit perp history active',
    windowCandlesSync: '{window} window · {interval} candles · sync {age}',
  },
  {
    secondsAgo: 'hace {s}s',
    minutesAgo: 'hace {m}m {s}s',
    retrying: 'Reintentando historial en vivo…',
    fetchingUpstream: 'obteniendo desde la fuente',
    unavailable: 'Historial en vivo no disponible',
    fetchFailed: 'falló la descarga de velas de la fuente',
    retry: 'Reintentar',
    stale: 'Sincronización de historial desactualizada',
    showingCached: 'falló la última actualización — mostrando velas en caché',
    loading: 'Cargando gráfico en vivo…',
    noHistory: 'No hay historial en vivo disponible',
    emptyUpstream: 'la fuente devolvió datos vacíos',
    switching: 'Cambiando ventana en vivo…',
    windowCandles: 'ventana {window} · velas {interval}',
    refreshing: 'Actualizando historial del perp de Deribit…',
    active: 'Historial del perp de Deribit activo',
    windowCandlesSync: 'ventana {window} · velas {interval} · sinc. {age}',
  },
);

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

function formatAge(seconds: number, t: Translate<typeof messages.en>): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return t('secondsAgo', { s });
  return t('minutesAgo', { m, s: s.toString().padStart(2, '0') });
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
  const t = useT(messages);
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
        <span className={styles.snapshotPrimary}>{t('retrying')}</span>
        <span className={styles.snapshotSecondary}>{t('fetchingUpstream')}</span>
      </div>
    );
  }

  // Hard error: latest fetch failed AND there's no cached data on screen.
  // This is the "you have nothing to look at" case.
  if (isError && !hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>{t('unavailable')}</span>
        <span className={styles.snapshotSecondary}>
          {errorMessage ?? t('fetchFailed')}
        </span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            {t('retry')}
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
        <span className={styles.snapshotPrimary}>{t('stale')}</span>
        <span className={styles.snapshotSecondary}>
          {errorMessage ?? t('showingCached')}
        </span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            {t('retry')}
          </button>
        )}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className={styles.snapshotBanner} data-state="loading">
        <span className={styles.snapshotDot} />
        <span>{t('loading')}</span>
      </div>
    );
  }

  // Empty history is distinct from loading: the request succeeded but the
  // upstream payload could not produce usable candles.
  if (isEmpty && !isFetching) {
    return (
      <div className={styles.snapshotBanner} data-state="error">
        <span className={styles.snapshotDot} />
        <span className={styles.snapshotPrimary}>{t('noHistory')}</span>
        <span className={styles.snapshotSecondary}>{t('emptyUpstream')}</span>
        {onRetry && (
          <button type="button" className={styles.snapshotRetry} onClick={onRetry}>
            {t('retry')}
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
        <span className={styles.snapshotPrimary}>{t('switching')}</span>
        <span className={styles.snapshotSecondary}>
          {t('windowCandles', { window: windowLabel, interval: intervalLabel })}
        </span>
      </div>
    );
  }

  const elapsed = dataUpdatedAt ? Date.now() - dataUpdatedAt : 0;
  const seconds = Math.floor(elapsed / 1000);
  const livePrimary = isFetching ? t('refreshing') : t('active');

  return (
    <div className={styles.snapshotBanner} data-state={isFetching ? 'loading' : 'fresh'}>
      <span className={styles.snapshotDot} />
      <span className={styles.snapshotPrimary}>{livePrimary}</span>
      <span className={styles.snapshotSecondary}>
        {t('windowCandlesSync', {
          window: windowLabel,
          interval: intervalLabel,
          age: formatAge(seconds, t),
        })}
      </span>
    </div>
  );
}
