import { useAppStore } from '@stores/app-store';
import { defineMessages, useT } from '@lib/i18n';
import { AssetPickerButton, Spinner, VenuePickerButton } from '@components/ui';
import { DvolChart, DvolHeatmap } from '@features/dvol';
import { useAllExpiriesChain } from './queries';
import { VolCurves } from './vol-curves';
import BreakEvenForecast from './BreakEvenForecast';
import OiSummary from './OiSummary';
import VenueShare from './VenueShare';
import TopPositions from './TopPositions';
import ExpiryCalendar from './ExpiryCalendar';
import styles from './AnalyticsView.module.css';
import { OiByStrikeCard } from './oi-by-strike';
import { TimeAtPrice } from './time-at-price';

const messages = defineMessages(
  {
    loading: 'Loading analytics…',
    title: 'Analytics',
    subtitle: 'Aggregated across {expiries} expiries · {venues} venues',
  },
  {
    loading: 'Cargando analíticas…',
    title: 'Analíticas',
    subtitle: 'Agregado en {expiries} vencimientos · {venues} exchanges',
  },
);

export default function AnalyticsView() {
  const t = useT(messages);
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: chains, isLoading } = useAllExpiriesChain(underlying, activeVenues);

  if (isLoading || !chains) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label={t('loading')} />
      </div>
    );
  }

  const spotPrice =
    chains.find((c) => c.stats.forwardPriceUsd != null)?.stats.forwardPriceUsd ?? null;

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{t('title')}</span>
          <AssetPickerButton />
          <VenuePickerButton />
        </div>
        <span className={styles.subtitle}>
          {t('subtitle', { expiries: chains.length, venues: activeVenues.length })}
        </span>
      </div>

      <div className={styles.grid}>
        <OiSummary chains={chains} />
        <VenueShare chains={chains} />
        <TopPositions chains={chains} spotPrice={spotPrice} />
        <ExpiryCalendar chains={chains} spotPrice={spotPrice} />
        <VolCurves chains={chains} spotPrice={spotPrice} />
        <BreakEvenForecast underlying={underlying} />
        <TimeAtPrice underlying={underlying} />
        <OiByStrikeCard
          chains={chains}
          spotPrice={spotPrice}
          currency={underlying}
        />
        <div className={styles.dvolWrap}>
          <DvolChart />
        </div>
        <div className={styles.dvolWrap}>
          <DvolHeatmap />
        </div>
      </div>
    </div>
  );
}
