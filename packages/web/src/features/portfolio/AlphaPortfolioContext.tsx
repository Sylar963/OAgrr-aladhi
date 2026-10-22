import { useQuery } from '@tanstack/react-query';
import { PRIVATE_ADAPTER_SPECS, type VenueId } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { fetchMetrics, venueStatus } from './api';
import styles from './AlphaPortfolioContext.module.css';

const messages = defineMessages(
  {
    aria: 'Existing portfolio exposure',
    heading: 'Already in your book · {venue}',
    open: 'Open Portfolio →',
    unavailable: 'Portfolio unavailable. Open Portfolio to check the connection.',
    loading: 'Loading portfolio exposure…',
    connect: 'Connect this venue in Portfolio to see existing exposure here.',
    noEquity: 'Account equity and free margin are not supplied to this scanner.',
    openLegs: '{n} open legs',
    openPnl: 'Open P&L {v}',
    thetaPerDay: 'Theta {v} / day',
    stale: 'Stale portfolio snapshot',
    updated: 'Updated {time}',
    days: '{n} days',
    legs: '{n} legs',
    footer:
      'New trades add to this exposure. Scanner risk is per trade; it does not approve portfolio margin. Different expiries settle at different prices.',
  },
  {
    aria: 'Exposición existente del portafolio',
    heading: 'Ya está en tu libro · {venue}',
    open: 'Abrir Portafolio →',
    unavailable: 'Portafolio no disponible. Abre Portafolio para revisar la conexión.',
    loading: 'Cargando exposición del portafolio…',
    connect: 'Conecta este exchange en Portafolio para ver aquí la exposición existente.',
    noEquity: 'El equity de la cuenta y el margen libre no se pasan a este escáner.',
    openLegs: '{n} legs abiertos',
    openPnl: 'P&L abierto {v}',
    thetaPerDay: 'Theta {v} / día',
    stale: 'Snapshot del portafolio desactualizado',
    updated: 'Actualizado {time}',
    days: '{n} días',
    legs: '{n} legs',
    footer:
      'Los nuevos trades se suman a esta exposición. El riesgo del escáner es por trade; no aprueba el margen del portafolio. Distintos vencimientos liquidan a distintos precios.',
  },
);

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export default function AlphaPortfolioContext({
  venue,
  underlying,
}: {
  venue: VenueId;
  underlying: string;
}) {
  const t = useT(messages);
  const navigate = useAppStore((s) => s.setActiveTab);
  const supported = PRIVATE_ADAPTER_SPECS[venue].status === 'available';
  const status = useQuery({
    queryKey: ['alpha-portfolio-status', venue],
    queryFn: () => venueStatus(venue),
    enabled: supported,
    retry: false,
    refetchInterval: 15_000,
  });
  const connected = status.data?.connected === true && !status.isError;
  const portfolio = useQuery({
    queryKey: ['portfolio', 'metrics', 0, venue, underlying],
    queryFn: () => fetchMetrics(0, venue, underlying),
    enabled: connected,
    retry: false,
    refetchInterval: 5_000,
  });
  const metrics = connected && !portfolio.isError ? portfolio.data?.metrics : null;
  const positions = connected && !portfolio.isError ? (portfolio.data?.positions ?? []) : [];
  const stale = metrics != null && Date.now() - metrics.generatedAt > 30_000;
  function openPortfolio() {
    try {
      localStorage.setItem('portfolioSource', venue);
      localStorage.setItem('portfolioUnderlying', underlying);
    } catch {}
    navigate('portfolio');
  }
  return (
    <section className={styles.wrap} aria-label={t('aria')}>
      <div className={styles.heading}>
        <span>{t('heading', { venue: VENUES[venue]?.label ?? venue })}</span>
        <button type="button" onClick={openPortfolio}>
          {t('open')}
        </button>
      </div>
      {!connected || portfolio.isError || metrics == null ? (
        <p>
          {portfolio.isError || status.isError
            ? t('unavailable')
            : connected
              ? t('loading')
              : t('connect')}{' '}
          {t('noEquity')}
        </p>
      ) : (
        <>
          <div className={styles.stats}>
            <span>{t('openLegs', { n: positions.length })}</span>
            <span>{t('openPnl', { v: money(metrics.totals.unrealizedPnlUsd) })}</span>
            <span>{t('thetaPerDay', { v: money(metrics.totals.netThetaUsd) })}</span>
            <span>
              {stale
                ? t('stale')
                : t('updated', { time: new Date(metrics.generatedAt).toLocaleTimeString() })}
            </span>
          </div>
          {metrics.byExpiry.map((bucket) => (
            <div className={styles.row} key={bucket.expiry}>
              <strong>{bucket.expiry}</strong>
              <span>{t('days', { n: bucket.dte.toFixed(1) })}</span>
              <span>{t('legs', { n: positions.filter((p) => p.expiry === bucket.expiry).length })}</span>
              <span>{t('thetaPerDay', { v: money(bucket.theta) })}</span>
            </div>
          ))}
          <p>
            {t('footer')}
          </p>
        </>
      )}
    </section>
  );
}
