import { useState, useEffect, useMemo, useRef } from 'react';

import { useAppStore, useMarket } from '@stores/app-store';
import { useChainQuery, useExpiries, useStats, usePrefetchChain } from './queries';
import { useOpenPalette } from '@components/layout/palette-context';
import { EmptyState, OverlayPortal, Spinner, VenuePickerButton } from '@components/ui';
import { useIsMobile } from '@hooks/useIsMobile';
import { useVolRichness } from '@hooks/useVolRichness';
import { fmtIv, fmtUsdCompact } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';

import ExpiryBar from './ExpiryBar';
import { useExpiryPositions } from './use-expiry-positions';
import { summarizeStrikePositions } from './expiry-positions';
import StatStrip from './StatStrip';
import ChainTable from './ChainTable';
import VenueSidebar from './VenueSidebar';
import MyIvInput from './MyIvInput';
import OptionCalculator from './OptionCalculator';
import EasyChainView from './easy/EasyChainView';
import styles from './ChainView.module.css';

const EASY_MODE_KEY = 'chain.easyMode';

const messages = defineMessages(
  {
    loading: 'Loading chain data…',
    failed: 'Failed to load chain',
    checkConnection: 'Check your connection and try again.',
    noData: 'No options data',
    noVenuesShort: 'No venues returned data for {underlying} {expiry}.',
    noVenuesLong:
      'No venues returned data for {underlying} {expiry}. The expiry may only be listed on venues that are currently unavailable.',
    easyModeTitle: 'Easy mode: build a trade by dragging options onto the price chart',
    easyMode: 'Easy mode',
    toggleCalc: 'Toggle option calculator',
    calc: 'Option Calculator',
  },
  {
    loading: 'Cargando datos de la cadena…',
    failed: 'No se pudo cargar la cadena',
    checkConnection: 'Revisa tu conexión e inténtalo de nuevo.',
    noData: 'Sin datos de opciones',
    noVenuesShort: 'Ningún exchange devolvió datos para {underlying} {expiry}.',
    noVenuesLong:
      'Ningún exchange devolvió datos para {underlying} {expiry}. Es posible que el vencimiento solo esté listado en exchanges que no están disponibles ahora.',
    easyModeTitle: 'Modo fácil: arma un trade arrastrando opciones al gráfico de precio',
    easyMode: 'Modo fácil',
    toggleCalc: 'Mostrar/ocultar calculadora de opciones',
    calc: 'Calculadora de opciones',
  },
);

function readEasyMode(): boolean {
  try {
    return localStorage.getItem(EASY_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function useChainData() {
  const underlying = useMarket((m) => m.underlying);
  const expiry = useMarket((m) => m.expiry);
  const activeVenues = useMarket((m) => m.activeVenues);
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);

  // Once the WS is live it delivers a snapshot on every resubscribe (tenor /
  // underlying / venue change), so the REST fetch is redundant and only races
  // the WS write into the same cache key — causing a visible double-render on
  // every tenor click. Keep REST as bootstrap / fallback when WS isn't live.
  // Until the new tenor's data arrives, the previous tenor stays rendered
  // (dimmed, non-interactive) so the stats strip and table don't unmount.
  const {
    data: chain,
    isLoading,
    error,
    isPlaceholderData,
  } = useChainQuery(underlying, expiry, activeVenues, {
    enabled: connectionState !== 'live',
    keepPreviousTenor: true,
  });
  const { data: marketStats } = useStats(underlying);
  const { data: richness } = useVolRichness(underlying);

  return {
    underlying,
    expiry,
    activeVenues,
    connectionState,
    chain,
    isLoading,
    error,
    isPlaceholderData,
    marketStats,
    richness,
  };
}

type ChainData = ReturnType<typeof useChainData>;

function isLoadingChain({ chain, isLoading, connectionState }: ChainData): boolean {
  return !chain && (isLoading || connectionState === 'live' || connectionState === 'connecting');
}

// Only auto-reset venue selection when the underlying changes — not on every
// expiry switch. Without this guard, manually toggling a venue off and then
// navigating to a different expiry overwrites the user's selection.
function useAutoSelectVenues(underlying: string): void {
  const setActiveVenues = useAppStore((s) => s.setActiveVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const expiryByVenue = expiriesData?.byVenue;
  const lastAutoSetUnderlyingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!expiryByVenue || underlying === lastAutoSetUnderlyingRef.current) return;
    const available = expiryByVenue.map((v) => v.venue);
    if (available.length > 0) {
      lastAutoSetUnderlyingRef.current = underlying;
      setActiveVenues(available);
    }
  }, [underlying, expiryByVenue, setActiveVenues]);
}

function useMyIv(): number | null {
  const myIv = useMarket((m) => m.myIv);
  const parsed = myIv !== '' ? parseFloat(myIv) / 100 : null;
  return parsed != null && !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
}

function MobileChain() {
  const t = useT(messages);
  const data = useChainData();
  const { underlying, expiry, activeVenues, chain, error, isPlaceholderData } = data;
  useAutoSelectVenues(underlying);
  const myIv = useMyIv();
  const [statsExpanded, setStatsExpanded] = useState(false);

  return (
    <div className={styles.view}>
      <div className={styles.main}>
        {/* Collapsible stats summary */}
        {chain && (
          <button
            className={styles.mobileStatsToggle}
            onClick={() => setStatsExpanded((v) => !v)}
          >
            <span className={styles.mstLabel}>
              ATM {fmtIv(chain.stats.atmIv)} · P/C {chain.stats.putCallOiRatio?.toFixed(2) ?? '—'} ·
              OI {fmtUsdCompact(chain.stats.totalOiUsd)}
            </span>
            <span className={styles.mstChevron} data-expanded={statsExpanded}>
              ›
            </span>
          </button>
        )}

        {statsExpanded && chain && (
          <StatStrip
            stats={chain.stats}
            underlying={chain.underlying}
            dte={chain.dte}
            connectionState={data.connectionState}
            marketStats={data.marketStats}
            richness={data.richness}
          />
        )}

        <div className={styles.tableArea} data-stale={isPlaceholderData} aria-busy={isPlaceholderData}>
          {isLoadingChain(data) && <Spinner size="lg" label={t('loading')} />}
          {error && !chain && (
            <EmptyState
              icon="⚠︎"
              title={t('failed')}
              detail={error instanceof Error ? error.message : t('checkConnection')}
            />
          )}
          {chain && chain.strikes.length === 0 && (
            <EmptyState
              icon="∅"
              title={t('noData')}
              detail={t('noVenuesShort', { underlying, expiry })}
            />
          )}
          {chain && chain.strikes.length > 0 && (
            <ChainTable
              strikes={chain.strikes}
              atmStrike={chain.stats.atmStrike}
              indexPrice={chain.stats.indexPriceUsd}
              activeVenues={activeVenues}
              myIv={myIv}
              expiry={chain.expiry ?? expiry}
              underlying={underlying}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ChainStatArea({ chain, connectionState, marketStats, richness, isPlaceholderData }: ChainData) {
  if (!chain) return null;
  return (
    <div className={styles.statArea} data-stale={isPlaceholderData}>
      <StatStrip
        stats={chain.stats}
        underlying={chain.underlying}
        dte={chain.dte}
        connectionState={connectionState}
        marketStats={marketStats}
        richness={richness}
      />
    </div>
  );
}

interface ChainMainProps {
  /** The stat strip and venue list are separate widgets in this layout, so the table omits them. */
  standalone?: boolean;
}

function ChainMain({ standalone = false }: ChainMainProps) {
  const t = useT(messages);
  const data = useChainData();
  const { underlying, expiry, activeVenues, chain, error, isPlaceholderData } = data;
  useAutoSelectVenues(underlying);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const expiryPositions = useExpiryPositions(underlying, activeVenues);
  const openPalette = useOpenPalette();
  const prefetchChain = usePrefetchChain(underlying, activeVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const myIv = useMyIv();
  const [calcOpen, setCalcOpen] = useState(false);
  const [easyMode, setEasyMode] = useState(readEasyMode);

  // Table props follow the rendered chain, not the selected tab, so positions,
  // ATM scroll and price-flash scope stay consistent while a placeholder shows.
  const displayExpiry = chain?.expiry ?? expiry;
  const expiryLegs = expiryPositions.get(displayExpiry)?.legs;
  const strikePositions = useMemo(() => summarizeStrikePositions(expiryLegs ?? []), [expiryLegs]);

  useEffect(() => {
    try {
      localStorage.setItem(EASY_MODE_KEY, easyMode ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this session.
    }
  }, [easyMode]);

  return (
    <>
      <div className={styles.main}>
        <ExpiryBar
          underlying={underlying}
          spotPrice={chain?.stats.forwardPriceUsd}
          spotChange={data.marketStats?.spot?.change24hPct}
          expiries={expiriesData?.expiries ?? []}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
          onPrefetch={prefetchChain}
          positions={expiryPositions}
        />

        {!standalone && <ChainStatArea {...data} />}

        <div className={styles.tableControls}>
          <span className={standalone ? undefined : styles.narrowVenues}>
            <VenuePickerButton />
          </span>
          {!easyMode && <MyIvInput />}
          <button
            type="button"
            className={styles.easyToggle}
            data-active={easyMode}
            aria-pressed={easyMode}
            onClick={() => setEasyMode((v) => !v)}
            title={t('easyModeTitle')}
          >
            <span className={styles.easyDot} />
            {t('easyMode')}
          </button>
        </div>

        <div className={styles.tableArea} data-stale={isPlaceholderData} aria-busy={isPlaceholderData}>
          {isLoadingChain(data) && <Spinner size="lg" label={t('loading')} />}
          {error && !chain && (
            <EmptyState
              icon="⚠︎"
              title={t('failed')}
              detail={error instanceof Error ? error.message : t('checkConnection')}
            />
          )}
          {chain && chain.strikes.length === 0 && (
            <EmptyState
              icon="∅"
              title={t('noData')}
              detail={t('noVenuesLong', { underlying, expiry })}
            />
          )}
          {chain && chain.strikes.length > 0 && easyMode && (
            <EasyChainView chain={chain} underlying={underlying} activeVenues={activeVenues} />
          )}
          {chain && chain.strikes.length > 0 && !easyMode && (
            <ChainTable
              strikes={chain.strikes}
              atmStrike={chain.stats.atmStrike}
              indexPrice={chain.stats.indexPriceUsd}
              activeVenues={activeVenues}
              myIv={myIv}
              expiry={displayExpiry}
              underlying={underlying}
              positions={strikePositions}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        className={styles.calcFab}
        data-active={calcOpen}
        onClick={() => setCalcOpen((v) => !v)}
        aria-label={t('toggleCalc')}
        title={t('calc')}
      >
        ⌥
      </button>
      {calcOpen && (
        <OverlayPortal>
          <OptionCalculator
            defaultUnderlying={underlying}
            defaultExpiry={expiry}
            defaultSpot={chain?.stats.indexPriceUsd}
            onClose={() => setCalcOpen(false)}
          />
        </OverlayPortal>
      )}
    </>
  );
}

function ChainVenues({ fill }: { fill?: boolean }) {
  const activeVenues = useMarket((m) => m.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const failedVenues = useAppStore((s) => s.feedStatus.failedVenues);
  return (
    <VenueSidebar
      activeVenues={activeVenues}
      onToggle={toggleVenue}
      failedVenues={failedVenues}
      fill={fill}
    />
  );
}

export function ChainTableWidget() {
  return (
    <div className={styles.view}>
      <ChainMain standalone />
    </div>
  );
}

export function ChainStatsWidget() {
  const data = useChainData();
  return (
    <div className={styles.statsCard}>
      {isLoadingChain(data) && <Spinner size="md" />}
      <ChainStatArea {...data} />
    </div>
  );
}

export function ChainVenuesWidget() {
  return <ChainVenues fill />;
}

export default function ChainView() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileChain />;
  return (
    <div className={styles.view}>
      <div className={styles.sidebarSlot}>
        <ChainVenues />
      </div>
      <ChainMain />
    </div>
  );
}
