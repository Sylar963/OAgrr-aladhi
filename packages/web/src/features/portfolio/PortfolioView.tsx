import { useMemo, useRef, useState } from 'react';

import {
  PRIVATE_ADAPTER_SPECS,
  VENUE_IDS,
  type PortfolioPnlCurve as PortfolioPnlCurveData,
  type PortfolioSource,
  PortfolioSourceSchema,
  type VenueId,
} from '@oggregator/protocol';

import { useAppStore } from '@stores/app-store';
import {
  portfolioToBuilderHedges,
  portfolioToBuilderLegs,
  useStrategyStore,
} from '@features/architect';
import { FlipBanner } from '@features/thesis';
import { defineMessages, useT, type Translate } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';

import { PortfolioAssistantPanel } from './assistant';
import ExpiryBuckets from './ExpiryBuckets';
import PortfolioPnlCurve from './PortfolioPnlCurve';
import PortfolioVegaCurve from './PortfolioVegaCurve';
import PositionForm from './PositionForm';
import PositionsTable from './PositionsTable';
import RiskCockpit from './RiskCockpit';
import ShockHeatmap from './ShockHeatmap';
import MarketMovement from './MarketMovement';
import StrategyGroupsPanel from './StrategyGroups';
import { isEquityHistoryVenue } from './api';
import { usePortfolioMetrics, usePortfolioPositions, useVenueMargin } from './hooks/queries';
import { usePortfolioWs } from './hooks/usePortfolioWs';
import styles from './PortfolioView.module.css';
import ThalexNetworkBadge from './ThalexNetworkBadge';

const FORWARD_DAYS = 7;
const UNDERLYING_OPTIONS = ['all', 'BTC', 'ETH'] as const;
type UnderlyingOption = (typeof UNDERLYING_OPTIONS)[number];
const SOURCE_STORAGE_KEY = 'portfolioSource';
const UNDERLYING_STORAGE_KEY = 'portfolioUnderlying';
const DEFAULT_SOURCE: PortfolioSource = 'manual';
const EMPTY_PNL_CURVE: PortfolioPnlCurveData = {
  status: 'empty',
  underlying: null,
  currentSpotUsd: null,
  breakEvenPricesUsd: [],
  maxProfitUsd: null,
  maxLossUsd: null,
  upsideBounded: false,
  downsideBounded: false,
  points: [],
  expiryBasis: 'common_expiry',
  riskWindows: [],
};

function loadStoredSource(): PortfolioSource {
  try {
    const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
    const parsed = PortfolioSourceSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {}
  return DEFAULT_SOURCE;
}

function loadStoredUnderlying(): UnderlyingOption {
  try {
    const raw = localStorage.getItem(UNDERLYING_STORAGE_KEY);
    if (raw != null && (UNDERLYING_OPTIONS as readonly string[]).includes(raw)) {
      return raw as UnderlyingOption;
    }
  } catch {}
  return 'all';
}

const messages = defineMessages(
  {
    manual: 'Manual',
    paper: 'Paper',
    manualNote: 'Hand-entered legs',
    paperNote: 'Live paper trading book',
    venueLiveNote: 'Live {venue} book via private WS',
    venuePendingNote: 'Adapter {status} — keys are stored but not wired yet',
    builderEmpty: 'Add option positions to explore them in Builder V2.',
    builderPickUnderlying: 'Select one underlying above to open its positions in Builder V2.',
    paperSourceLabel: 'paper',
    emptyReadOnly:
      'No open {source} positions yet. They will appear here as the feed reports them.',
    title: 'Portfolio',
    subtitle: 'Volatility, convexity and carry translated for delta-one traders',
    source: 'Source',
    underlying: 'Underlying',
    forwardDays: 'Forward days',
    all: 'All',
    state_closed: 'closed',
    state_connecting: 'connecting',
    state_open: 'open',
    state_retrying: 'retrying',
    paperNoteBefore: 'Showing live paper-trading positions. Add or close legs from the',
    paperNoteAfter: ' tab.',
    venueNoteBefore: 'Showing live',
    venueNoteAfter:
      'positions from your private WS feed. Trade on the venue directly to change the book.',
  },
  {
    manual: 'Manual',
    paper: 'Paper',
    manualNote: 'Legs ingresados a mano',
    paperNote: 'Libro de paper trading en vivo',
    venueLiveNote: 'Libro de {venue} en vivo vía WS privado',
    venuePendingNote: 'Adaptador {status} — las claves están guardadas pero aún no conectadas',
    builderEmpty: 'Agrega posiciones de opciones para explorarlas en Builder V2.',
    builderPickUnderlying:
      'Selecciona un subyacente arriba para abrir sus posiciones en Builder V2.',
    paperSourceLabel: 'paper',
    emptyReadOnly:
      'Aún no hay posiciones abiertas de {source}. Aparecerán aquí cuando el feed las reporte.',
    title: 'Portafolio',
    subtitle: 'Volatilidad, convexidad y carry traducidos para traders delta-one',
    source: 'Fuente',
    underlying: 'Subyacente',
    forwardDays: 'Días hacia adelante',
    all: 'Todos',
    state_closed: 'cerrado',
    state_connecting: 'conectando',
    state_open: 'abierto',
    state_retrying: 'reintentando',
    paperNoteBefore:
      'Mostrando posiciones de paper trading en vivo. Agrega o cierra legs desde la pestaña',
    paperNoteAfter: '.',
    venueNoteBefore: 'Mostrando posiciones en vivo de',
    venueNoteAfter:
      'desde tu feed WS privado. Opera directamente en el exchange para cambiar el libro.',
  },
);

type T = Translate<typeof messages.en>;

interface SourceOption {
  value: PortfolioSource;
  label: string;
  ready: boolean;
  note: string;
}

function baseSources(t: T): SourceOption[] {
  return [
    { value: 'manual', label: t('manual'), ready: true, note: t('manualNote') },
    { value: 'paper', label: t('paper'), ready: true, note: t('paperNote') },
  ];
}

function venueSourceOptions(t: T): SourceOption[] {
  return VENUE_IDS.map((venue: VenueId) => {
    const spec = PRIVATE_ADAPTER_SPECS[venue];
    return {
      value: venue,
      label: VENUES[venue]?.label ?? venue,
      ready: spec.status === 'available',
      note:
        spec.status === 'available'
          ? t('venueLiveNote', { venue: VENUES[venue]?.label ?? venue })
          : t('venuePendingNote', { status: spec.status }),
    };
  });
}

export default function PortfolioView() {
  const t = useT(messages);
  const underlying = useAppStore((s) => s.underlying);
  const forwardDays = FORWARD_DAYS;
  const [source, setSource] = useState<PortfolioSource>(loadStoredSource);
  const [underlyingFilter, setUnderlyingFilter] = useState<UnderlyingOption>(loadStoredUnderlying);
  const underlyingParam = underlyingFilter === 'all' ? undefined : underlyingFilter;
  const { connectionState, lastSeq, lastError } = usePortfolioWs(source, underlyingParam);
  const wsLive = connectionState === 'open' && lastSeq > 0;
  const positionsOpts =
    underlyingParam == null ? { wsLive } : { wsLive, underlying: underlyingParam };
  const metricsOpts =
    underlyingParam == null ? { wsLive } : { wsLive, underlying: underlyingParam };
  const { data: positionsData } = usePortfolioPositions(source, positionsOpts);
  const { data: metricsData } = usePortfolioMetrics(forwardDays, source, metricsOpts);
  const { data: venueMargin } = useVenueMargin(source === 'thalex' ? 'thalex' : null);

  const sourceOptions = useMemo(() => [...baseSources(t), ...venueSourceOptions(t)], [t]);
  const activeNote = sourceOptions.find((o) => o.value === source)?.note ?? '';

  const positions = positionsData?.positions ?? metricsData?.positions ?? [];
  const metrics = metricsData?.metrics ?? null;
  const positionsRef = useRef<HTMLDivElement>(null);
  const scenarioRef = useRef<HTMLDivElement>(null);
  const [highlightedLegIds, setHighlightedLegIds] = useState<string[]>([]);
  const navigateAssistantResult = (action: 'positions' | 'scenario', legIds: string[]) => {
    setHighlightedLegIds(action === 'positions' ? legIds : []);
    const target = action === 'positions' ? positionsRef.current : scenarioRef.current;
    target?.scrollIntoView({ block: 'start', behavior: 'auto' });
    target?.focus({ preventScroll: true });
  };
  const builderLegs = portfolioToBuilderLegs(positions, metrics?.breakEven);
  const builderDisabledReason =
    positions.length === 0
      ? t('builderEmpty')
      : builderLegs.length === 0
        ? t('builderPickUnderlying')
        : undefined;
  const openInBuilder = () => {
    const first = positions[0];
    if (!first || builderLegs.length === 0) return;
    const hedges = portfolioToBuilderHedges(metrics?.linearPositions ?? [], first.underlying);
    useStrategyStore.getState().replaceLegs(builderLegs, first.underlying, hedges);
    const app = useAppStore.getState();
    app.setAssetMode('crypto');
    app.setUnderlying(first.underlying);
    app.setExpiry([...builderLegs].sort((a, b) => a.expiry.localeCompare(b.expiry))[0]!.expiry);
    app.setBuilderVariant('v2');
    app.setActiveTab('architect');
  };
  const isReadOnly = source !== 'manual';
  const sourceLabel =
    source === 'manual'
      ? t('manual')
      : source === 'paper'
        ? t('paperSourceLabel')
        : (VENUES[source as VenueId]?.label ?? source);
  const emptyMessage = isReadOnly ? t('emptyReadOnly', { source: sourceLabel }) : undefined;

  const onSelectSource = (nextSource: PortfolioSource) => {
    setSource(nextSource);
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, nextSource);
    } catch {}
  };

  const onSelectUnderlying = (next: UnderlyingOption) => {
    setUnderlyingFilter(next);
    try {
      localStorage.setItem(UNDERLYING_STORAGE_KEY, next);
    } catch {}
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{t('title')}</h2>
          <span className={styles.subtitle}>{t('subtitle')}</span>
        </div>
        <div className={styles.statusGroup}>
          <div className={styles.toggleGroup} role="radiogroup" aria-label={t('source')}>
            {sourceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={styles.toggle}
                data-active={source === opt.value || undefined}
                data-disabled={!opt.ready || undefined}
                disabled={!opt.ready}
                title={opt.note}
                onClick={() => onSelectSource(opt.value)}
              >
                {opt.label}
                {!opt.ready && <span className={styles.todoTag}>TODO</span>}
              </button>
            ))}
          </div>
          {source === 'thalex' && <ThalexNetworkBadge />}
          <span
            className={styles.status}
            data-state={connectionState}
            title={lastError != null ? `${lastError.code}: ${lastError.message}` : undefined}
          >
            {t(`state_${connectionState}`)} · seq {lastSeq}
            {lastError != null && ` · ${lastError.code}`}
          </span>
          <div className={styles.toggleGroup} role="radiogroup" aria-label={t('underlying')}>
            {UNDERLYING_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={styles.toggle}
                data-active={underlyingFilter === opt || undefined}
                onClick={() => onSelectUnderlying(opt)}
              >
                {opt === 'all' ? t('all') : opt}
              </button>
            ))}
          </div>
          <div className={styles.toggleGroup} aria-label={t('forwardDays')}>
            <span className={styles.toggle} data-active data-static>
              T+{forwardDays}d
            </span>
          </div>
        </div>
      </div>

      <div className={styles.sourceNote}>{activeNote}</div>

      <FlipBanner underlying={underlyingFilter === 'all' ? null : underlyingFilter} />

      <RiskCockpit metrics={metrics} positions={positions} />

      <div className={styles.bodyGrid}>
        <div className={styles.mainCol}>
          <div ref={scenarioRef} tabIndex={-1} className={styles.assistantTarget}>
            <PortfolioPnlCurve
              curve={metrics?.pnlCurve ?? EMPTY_PNL_CURVE}
              forwardDays={forwardDays}
              onOpenBuilder={openInBuilder}
              builderDisabledReason={builderDisabledReason}
              mixedExpiries={new Set(positions.map((p) => p.expiry)).size > 1}
              equityVenue={isEquityHistoryVenue(source) ? source : null}
              margin={source === 'thalex' ? (venueMargin ?? null) : null}
              strategies={metrics?.strategies}
              positions={positions}
              totals={metrics?.totals ?? null}
              linearPositions={metrics?.linearPositions ?? []}
            />
          </div>
          <StrategyGroupsPanel
            groups={metrics?.strategies ?? []}
            closeNow={metrics?.closeNow ?? null}
          />
          <ShockHeatmap
            grid={metrics?.shockGrid ?? []}
            meta={metrics?.shockGridMeta ?? null}
            entryGrid={metrics?.entryShockGrid ?? []}
            entryDrift={metrics?.entryDrift ?? null}
            attribution={metrics?.pnlAttribution ?? null}
            currentUnrealizedPnl={metrics?.totals.unrealizedPnlUsd ?? null}
          />
          <MarketMovement positions={positions} />
          <PortfolioVegaCurve
            positions={positions}
            byStrike={metrics?.byStrike ?? []}
            breakEven={metrics?.breakEven ?? []}
            spotUsd={metrics?.pnlCurve.currentSpotUsd ?? null}
            underlying={metrics?.pnlCurve.underlying ?? underlyingFilter}
          />
          <div
            ref={positionsRef}
            tabIndex={-1}
            className={`${styles.tableWrap} ${styles.assistantTarget}`}
          >
            <PositionsTable
              highlightedLegIds={highlightedLegIds}
              positions={positions}
              breakEven={metrics?.breakEven ?? []}
              {...(metrics?.closeNow != null && { closeNow: metrics.closeNow.legs })}
              readOnly={isReadOnly}
              {...(emptyMessage != null && { emptyMessage })}
            />
          </div>
        </div>
        <div className={styles.assistantSlot}>
          <PortfolioAssistantPanel
            source={source}
            underlying={underlyingParam ?? null}
            forwardDays={forwardDays}
            generatedAt={metrics?.generatedAt ?? null}
            metrics={metrics}
            positions={positions}
            onNavigate={navigateAssistantResult}
          />
        </div>
        <div className={styles.sidebar}>
          {source === 'manual' ? (
            <PositionForm defaultUnderlying={underlying} />
          ) : source === 'paper' ? (
            <div className={styles.readOnlyNote}>
              {t('paperNoteBefore')} <strong>{t('paper')}</strong>
              {t('paperNoteAfter')}
            </div>
          ) : (
            <div className={styles.readOnlyNote}>
              {t('venueNoteBefore')} <strong>{VENUES[source as VenueId]?.label ?? source}</strong>{' '}
              {t('venueNoteAfter')}
            </div>
          )}
          <ExpiryBuckets rows={metrics?.byExpiry ?? []} />
        </div>
      </div>
    </div>
  );
}
