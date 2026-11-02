import { Spinner } from '@components/ui';
import { DvolChart, DvolHeatmap } from '@features/dvol';
import { defineMessages, useT } from '@lib/i18n';
import type { EnrichedChainResponse } from '@shared/enriched';
import { useMarket } from '@stores/app-store';
import type { ReactNode } from 'react';

import BreakEvenForecast from './BreakEvenForecast';
import ExpiryCalendar from './ExpiryCalendar';
import OiSummary from './OiSummary';
import { OiByStrikeCard } from './oi-by-strike';
import { useAllExpiriesChain } from './queries';
import { TimeAtPrice } from './time-at-price';
import TopPositions from './TopPositions';
import VenueShare from './VenueShare';
import { VolCurves } from './vol-curves';

import styles from './AnalyticsView.module.css';

const messages = defineMessages({ loading: 'Loading…' }, { loading: 'Cargando…' });

interface ChainsCardData {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  underlying: string;
}

// Every card asks for the same query key, so a tab full of them still makes one request.
function ChainsCard({ children }: { children: (data: ChainsCardData) => ReactNode }) {
  const t = useT(messages);
  const underlying = useMarket((m) => m.underlying);
  const activeVenues = useMarket((m) => m.activeVenues);
  const { data: chains, isLoading } = useAllExpiriesChain(underlying, activeVenues);

  if (isLoading || !chains) return <Spinner size="lg" label={t('loading')} />;

  const spotPrice =
    chains.find((c) => c.stats.forwardPriceUsd != null)?.stats.forwardPriceUsd ?? null;
  return <div className={styles.view}>{children({ chains, spotPrice, underlying })}</div>;
}

export function OiSummaryWidget() {
  return <ChainsCard>{({ chains }) => <OiSummary chains={chains} />}</ChainsCard>;
}

export function VenueShareWidget() {
  return <ChainsCard>{({ chains }) => <VenueShare chains={chains} />}</ChainsCard>;
}

export function TopPositionsWidget() {
  return (
    <ChainsCard>
      {({ chains, spotPrice }) => <TopPositions chains={chains} spotPrice={spotPrice} />}
    </ChainsCard>
  );
}

export function ExpiryCalendarWidget() {
  return (
    <ChainsCard>
      {({ chains, spotPrice }) => <ExpiryCalendar chains={chains} spotPrice={spotPrice} />}
    </ChainsCard>
  );
}

export function VolCurvesWidget() {
  return (
    <ChainsCard>
      {({ chains, spotPrice }) => <VolCurves chains={chains} spotPrice={spotPrice} />}
    </ChainsCard>
  );
}

export function OiByStrikeWidget() {
  return (
    <ChainsCard>
      {({ chains, spotPrice, underlying }) => (
        <OiByStrikeCard chains={chains} spotPrice={spotPrice} currency={underlying} />
      )}
    </ChainsCard>
  );
}

export function BreakEvenWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <div className={styles.view}>
      <BreakEvenForecast underlying={underlying} />
    </div>
  );
}

export function TimeAtPriceWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <div className={styles.view}>
      <TimeAtPrice underlying={underlying} />
    </div>
  );
}

export function DvolChartWidget() {
  return (
    <div className={styles.view}>
      <DvolChart />
    </div>
  );
}

export function DvolHeatmapWidget() {
  return (
    <div className={styles.view}>
      <DvolHeatmap />
    </div>
  );
}
