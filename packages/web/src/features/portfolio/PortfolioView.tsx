import { useMemo, useState } from 'react';

import {
  PRIVATE_ADAPTER_SPECS,
  VENUE_IDS,
  type PortfolioPnlCurve as PortfolioPnlCurveData,
  type PortfolioSource,
  PortfolioSourceSchema,
  type VenueId,
} from '@oggregator/protocol';

import { useAppStore } from '@stores/app-store';
import { VENUES } from '@lib/venue-meta';

import { PortfolioAssistantPanel } from './assistant';
import ExpiryBuckets from './ExpiryBuckets';
import PortfolioPnlCurve from './PortfolioPnlCurve';
import PortfolioVegaCurve from './PortfolioVegaCurve';
import PositionForm from './PositionForm';
import PositionsTable from './PositionsTable';
import RiskCockpit from './RiskCockpit';
import ShockHeatmap from './ShockHeatmap';
import StrategyGroupsPanel from './StrategyGroups';
import { usePortfolioMetrics, usePortfolioPositions } from './hooks/queries';
import { usePortfolioWs } from './hooks/usePortfolioWs';
import styles from './PortfolioView.module.css';

const FORWARD_OPTIONS: number[] = [0, 1, 3, 7];
const UNDERLYING_OPTIONS = ['all', 'BTC', 'ETH'] as const;
type UnderlyingOption = (typeof UNDERLYING_OPTIONS)[number];
const SOURCE_STORAGE_KEY = 'portfolioSource';
const FORWARD_STORAGE_KEY = 'portfolioForwardDays';
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
};

function loadStoredSource(): PortfolioSource {
  try {
    const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
    const parsed = PortfolioSourceSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {}
  return DEFAULT_SOURCE;
}

function loadStoredForwardDays(): number {
  try {
    const raw = Number(localStorage.getItem(FORWARD_STORAGE_KEY));
    if (FORWARD_OPTIONS.includes(raw)) return raw;
  } catch {}
  return 0;
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

interface SourceOption {
  value: PortfolioSource;
  label: string;
  ready: boolean;
  note: string;
}

const BASE_SOURCES: SourceOption[] = [
  { value: 'manual', label: 'Manual', ready: true, note: 'Hand-entered legs' },
  { value: 'paper', label: 'Paper', ready: true, note: 'Live paper trading book' },
];

function venueSourceOptions(): SourceOption[] {
  return VENUE_IDS.map((venue: VenueId) => {
    const spec = PRIVATE_ADAPTER_SPECS[venue];
    return {
      value: venue,
      label: VENUES[venue]?.label ?? venue,
      ready: spec.status === 'available',
      note:
        spec.status === 'available'
          ? `Live ${VENUES[venue]?.label ?? venue} book via private WS`
          : `Adapter ${spec.status} — keys are stored but not wired yet`,
    };
  });
}

export default function PortfolioView() {
  const underlying = useAppStore((s) => s.underlying);
  const [forwardDays, setForwardDays] = useState(loadStoredForwardDays);
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

  const sourceOptions = useMemo(() => [...BASE_SOURCES, ...venueSourceOptions()], []);
  const activeNote = sourceOptions.find((o) => o.value === source)?.note ?? '';

  const positions = positionsData?.positions ?? metricsData?.positions ?? [];
  const metrics = metricsData?.metrics ?? null;
  const isReadOnly = source !== 'manual';
  const sourceLabel =
    source === 'manual'
      ? 'Manual'
      : source === 'paper'
        ? 'paper'
        : (VENUES[source as VenueId]?.label ?? source);
  const emptyMessage = isReadOnly
    ? `No open ${sourceLabel} positions yet. They will appear here as the feed reports them.`
    : undefined;

  const onSelectSource = (nextSource: PortfolioSource) => {
    setSource(nextSource);
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, nextSource);
    } catch {}
  };

  const onSelectForwardDays = (days: number) => {
    setForwardDays(days);
    try {
      localStorage.setItem(FORWARD_STORAGE_KEY, String(days));
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
          <h2 className={styles.title}>Portfolio</h2>
          <span className={styles.subtitle}>
            Volatility, convexity and carry translated for delta-one traders
          </span>
        </div>
        <div className={styles.statusGroup}>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Source">
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
          <span
            className={styles.status}
            data-state={connectionState}
            title={lastError != null ? `${lastError.code}: ${lastError.message}` : undefined}
          >
            {connectionState} · seq {lastSeq}
            {lastError != null && ` · ${lastError.code}`}
          </span>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Underlying">
            {UNDERLYING_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={styles.toggle}
                data-active={underlyingFilter === opt || undefined}
                onClick={() => onSelectUnderlying(opt)}
              >
                {opt === 'all' ? 'All' : opt}
              </button>
            ))}
          </div>
          <div className={styles.toggleGroup} role="radiogroup" aria-label="Forward days">
            {FORWARD_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={styles.toggle}
                data-active={forwardDays === days || undefined}
                onClick={() => onSelectForwardDays(days)}
              >
                T+{days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.sourceNote}>{activeNote}</div>

      <RiskCockpit metrics={metrics} positions={positions} />

      <div className={styles.bodyGrid}>
        <div className={styles.mainCol}>
          <PortfolioPnlCurve
            curve={metrics?.pnlCurve ?? EMPTY_PNL_CURVE}
            forwardDays={forwardDays}
            mixedExpiries={new Set(positions.map((p) => p.expiry)).size > 1}
          />
          <StrategyGroupsPanel groups={metrics?.strategies ?? []} />
          <ShockHeatmap
            grid={metrics?.shockGrid ?? []}
            meta={metrics?.shockGridMeta ?? null}
            currentUnrealizedPnl={metrics?.totals.unrealizedPnlUsd ?? null}
          />
          <PortfolioVegaCurve
            byStrike={metrics?.byStrike ?? []}
            breakEven={metrics?.breakEven ?? []}
            spotUsd={metrics?.pnlCurve.currentSpotUsd ?? null}
            underlying={metrics?.pnlCurve.underlying ?? underlyingFilter}
          />
          <div className={styles.tableWrap}>
            <PositionsTable
              positions={positions}
              breakEven={metrics?.breakEven ?? []}
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
          />
        </div>
        <div className={styles.sidebar}>
          {source === 'manual' ? (
            <PositionForm defaultUnderlying={underlying} />
          ) : source === 'paper' ? (
            <div className={styles.readOnlyNote}>
              Showing live paper-trading positions. Add or close legs from the{' '}
              <strong>Paper</strong> tab.
            </div>
          ) : (
            <div className={styles.readOnlyNote}>
              Showing live <strong>{VENUES[source as VenueId]?.label ?? source}</strong> positions
              from your private WS feed. Trade on the venue directly to change the book.
            </div>
          )}
          <ExpiryBuckets rows={metrics?.byExpiry ?? []} />
        </div>
      </div>
    </div>
  );
}
