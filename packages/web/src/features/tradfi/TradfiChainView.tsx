import { EmptyState, Spinner } from '@components/ui';
import { ChainTable, ExpiryBar, StatStrip } from '@features/chain';
import { useIsMobile } from '@hooks/useIsMobile';
import { defineMessages, useT } from '@lib/i18n';
import { useEffect, useState } from 'react';
import { useTradfiChain, useTradfiSelection } from './queries';
import styles from './TradfiChainView.module.css';
import TradfiChartPanel, { type TradfiChartPanelData } from './TradfiChartPanel';
import { openTradfiChartPopout } from './tradfi-chart-popout';

const TRADFI_VENUES = ['tastytrade'];

const messages = defineMessages(
  {
    loading: 'Loading TradFi chain…',
    failed: 'Failed to load TradFi chain',
    serviceHint: 'Is the TradFi service running on :3200?',
    noOptions: 'No options data',
    noData: 'No data for {underlying} {expiry}.',
    chartLabel: '{underlying} {strike} {type} chart',
  },
  {
    loading: 'Cargando cadena TradFi…',
    failed: 'No se pudo cargar la cadena TradFi',
    serviceHint: '¿El servicio TradFi está corriendo en :3200?',
    noOptions: 'Sin datos de opciones',
    noData: 'Sin datos para {underlying} {expiry}.',
    chartLabel: 'Gráfico {underlying} {strike} {type}',
  },
);

export default function TradfiChainView() {
  const t = useT(messages);
  const isMobile = useIsMobile();
  const [modal, setModal] = useState<TradfiChartPanelData | null>(null);
  const { underlying, expiry, setExpiry, expiries, cycleUnderlying } = useTradfiSelection();
  const { data: chain, isLoading, error } = useTradfiChain(underlying, expiry);

  // Close the mobile chart modal on Escape (standard dialog behaviour).
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  // Per-strike chart: desktop opens a popout window, mobile an in-page modal.
  function openChart(target: {
    underlying: string;
    expiry: string;
    strike: number;
    type: 'call' | 'put';
  }) {
    if (isMobile) {
      setModal({ ...target, interval: '1h', range: '7d', chartMode: 'price' });
    } else {
      openTradfiChartPopout(target);
    }
  }

  return (
    <div className={styles.view}>
      <ExpiryBar
        underlying={underlying || '—'}
        spotPrice={chain?.stats.indexPriceUsd ?? undefined}
        expiries={expiries}
        selected={expiry}
        onSelect={setExpiry}
        onChangeAsset={cycleUnderlying}
      />

      {chain && (
        <StatStrip
          stats={chain.stats}
          underlying={chain.underlying}
          dte={chain.dte}
          marketStats={null}
          showRegimeIv={false}
        />
      )}

      <div className={styles.tableArea}>
        {isLoading && !chain && <Spinner size="lg" label={t('loading')} />}
        {error && !chain && (
          <EmptyState
            icon="⚠"
            title={t('failed')}
            detail={
              error instanceof Error ? error.message : t('serviceHint')
            }
          />
        )}
        {chain && chain.strikes.length === 0 && (
          <EmptyState
            icon="∅"
            title={t('noOptions')}
            detail={t('noData', { underlying, expiry })}
          />
        )}
        {chain && chain.strikes.length > 0 && (
          <ChainTable
            strikes={chain.strikes}
            atmStrike={chain.stats.atmStrike}
            indexPrice={chain.stats.indexPriceUsd}
            activeVenues={TRADFI_VENUES}
            myIv={null}
            expiry={expiry}
            underlying={underlying}
            builderMode="tradfi"
            chartOverride={openChart}
          />
        )}
      </div>

      {modal && (
        <div className={styles.modalBackdrop} onClick={() => setModal(null)} role="presentation">
          <div
            className={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('chartLabel', {
              underlying: modal.underlying,
              strike: modal.strike,
              type: modal.type.toUpperCase(),
            })}
          >
            <TradfiChartPanel
              data={modal}
              onPatch={(patch) => setModal((m) => (m ? { ...m, ...patch } : m))}
              onClose={() => setModal(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
