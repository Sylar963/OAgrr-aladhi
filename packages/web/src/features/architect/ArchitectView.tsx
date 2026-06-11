import { useMemo, useState, useCallback, useEffect } from 'react';

import { useAppStore } from '@stores/app-store';
import { AssetPickerButton, DropdownPicker, VenuePickerButton } from '@components/ui';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import { useChainWs } from '@hooks/useChainWs';
import { fmtUsd, formatExpiry, dteDays } from '@lib/format';
import { VENUE_LIST, VENUES } from '@lib/venue-meta';
import { useStrategyStore } from './strategy-store';
import {
  computePayoff,
  computeMetrics,
  computeScenarioPayoff,
  detectStrategy,
  type Leg,
} from './payoff';
import { deriveTenorColumns } from './ladder-geometry';
import { repriceLeg } from './reprice';
import { STRATEGY_PARAM_KEYS, buildShareUrl, decodeStrategy } from './share';
import PayoffChart from './PayoffChart';
import PayoffChartV2, { pickCandleSpec } from './PayoffChartV2';
import PayoffChartV3 from './PayoffChartV3';
import SnapshotBanner from './SnapshotBanner';
import {
  hasUsableSpotCandles,
  isSpotCandleCurrency,
  useChainsForExpiries,
  useSpotCandles,
  type SpotCandlesResponse,
} from './queries';
import VenueSlideover from './VenueSlideover';
import type { StrategyRouting } from '@features/builder/round-trip';
import { legsToOrderRequest, useCreateTrade } from '@features/trading';
import { useAppStore as _useAppStoreForTabSwitch } from '@stores/app-store';
import StrategyTemplates, {
  buildTemplateVariant,
  clearActiveTemplateDrag,
  findTemplateVariant,
} from './StrategyTemplates';
import LegInput from './LegInput';
import styles from './Architect.module.css';

// ── Inline-editable leg row ──────────────────────────────────────────────────

interface LegRowProps {
  leg: Leg;
  allStrikes: number[];
  onRemove: () => void;
  onUpdate: (id: string, patch: Partial<Leg>) => void;
}

const BEST_ROUTE_VALUE = '__best-route__';

function resolveBuilderExpiry(preferredExpiry: string, expiries: string[]): string {
  if (preferredExpiry && expiries.includes(preferredExpiry)) return preferredExpiry;

  const viableExpiry = expiries.find((entry) => dteDays(entry) >= 3);
  return viableExpiry ?? expiries[1] ?? expiries[0] ?? '';
}

function LegRow({ leg, allStrikes, onRemove, onUpdate }: LegRowProps) {
  const [editing, setEditing] = useState(false);

  function stepStrike(delta: number) {
    const sorted = [...allStrikes].sort((a, b) => a - b);
    const idx = sorted.indexOf(leg.strike);
    if (idx < 0) return;
    const next = sorted[idx + delta];
    if (next != null) onUpdate(leg.id, { strike: next });
  }

  function toggleDirection() {
    onUpdate(leg.id, { direction: leg.direction === 'buy' ? 'sell' : 'buy' });
  }

  function toggleType() {
    onUpdate(leg.id, { type: leg.type === 'call' ? 'put' : 'call' });
  }

  if (editing) {
    return (
      <div className={styles.legRowEditing}>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Strike</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(-1)}>
            −
          </button>
          <span className={styles.legStepVal}>{leg.strike.toLocaleString()}</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(1)}>
            +
          </button>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Expiry</span>
          <span className={styles.legStepVal}>{formatExpiry(leg.expiry)}</span>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>Side</span>
          <button
            className={styles.legStepBtn}
            onClick={toggleDirection}
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {leg.direction === 'buy' ? 'BUY' : 'SELL'}
          </button>
          <button
            className={styles.legStepBtn}
            onClick={toggleType}
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {leg.type === 'call' ? 'CALL' : 'PUT'}
          </button>
          <div className={styles.legEditActions}>
            <button className={styles.legEditSave} onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.legRow} data-direction={leg.direction}>
      <span className={styles.legDirection} data-direction={leg.direction}>
        {leg.direction === 'buy' ? 'BUY' : 'SELL'}
      </span>
      <span className={styles.legQty}>{leg.quantity}×</span>
      <span className={styles.legStrike}>{leg.strike.toLocaleString()}</span>
      <span className={styles.legType} data-type={leg.type}>
        {leg.type === 'call' ? 'C' : 'P'}
      </span>
      <span className={styles.legExpiry}>{formatExpiry(leg.expiry)}</span>
      <span className={styles.legPrice}>{fmtUsd(leg.entryPrice)}</span>
      <button className={styles.legEditBtn} onClick={() => setEditing(true)} title="Edit leg">
        ✎
      </button>
      <button className={styles.legRemove} onClick={onRemove} title="Remove leg">
        ×
      </button>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function ArchitectView() {
  const underlying = useAppStore((s) => s.underlying);
  const globalExpiry = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: expiriesData } = useExpiries(underlying);
  const allExpiries = useMemo(() => expiriesData?.expiries ?? [], [expiriesData]);
  const [builderExpiry, setBuilderExpiry] = useState('');

  useEffect(() => {
    const nextExpiry = resolveBuilderExpiry(builderExpiry || globalExpiry, allExpiries);
    if (nextExpiry && nextExpiry !== builderExpiry) {
      setBuilderExpiry(nextExpiry);
    }
  }, [allExpiries, builderExpiry, globalExpiry, underlying]);

  const { connectionState: builderFeedState } = useChainWs({
    underlying,
    expiry: builderExpiry,
    venues: activeVenues,
    enabled: Boolean(builderExpiry),
  });
  const { data: chain } = useChainQuery(underlying, builderExpiry, activeVenues, {
    enabled: builderFeedState !== 'live',
  });

  const legs = useStrategyStore((s) => s.legs);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const removeLeg = useStrategyStore((s) => s.removeLeg);
  const updateLeg = useStrategyStore((s) => s.updateLeg);
  const addLeg = useStrategyStore((s) => s.addLeg);
  const strategyUnderlying = useStrategyStore((s) => s.underlying);

  useEffect(() => {
    if (strategyUnderlying && strategyUnderlying !== underlying && legs.length > 0) {
      clearLegs();
    }
  }, [clearLegs, legs.length, strategyUnderlying, underlying]);

  const [showVenues, setShowVenues] = useState(false);
  const [ivShift, setIvShift] = useState(0);
  const [dteShift, setDteShift] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [paperStatus, setPaperStatus] = useState<string | null>(null);
  const [routeVenue, setRouteVenue] = useState(BEST_ROUTE_VALUE);
  const [variant, setVariant] = useState<'v1' | 'v2' | 'v3'>('v1');
  const [lastGoodSpotCandles, setLastGoodSpotCandles] = useState<{
    data: SpotCandlesResponse;
    dataUpdatedAt: number;
  } | null>(null);

  const setActiveTab = _useAppStoreForTabSwitch((s) => s.setActiveTab);
  const createTrade = useCreateTrade();

  useEffect(() => {
    if (routeVenue !== BEST_ROUTE_VALUE && !activeVenues.includes(routeVenue)) {
      setRouteVenue(BEST_ROUTE_VALUE);
    }
  }, [activeVenues, routeVenue]);

  const pricingVenues = useMemo(
    () => (routeVenue === BEST_ROUTE_VALUE ? activeVenues : [routeVenue]),
    [routeVenue, activeVenues],
  );

  // ── Tenor axis (V3 lego ladder) ──────────────────────────────────────────
  // Legs can live on different expiries; the ladder shows them as columns.
  const legExpiries = useMemo(
    () => Array.from(new Set(legs.map((l) => l.expiry).filter(Boolean))),
    [legs],
  );
  const tenorColumns = useMemo(
    () => deriveTenorColumns(allExpiries, legExpiries, builderExpiry),
    [allExpiries, legExpiries, builderExpiry],
  );
  // Chains beyond the live builder expiry: every leg's own tenor (pricing
  // correctness in all variants) plus, while V3 is up, the visible columns
  // (so a block dropped on any column reprices instantly). REST-only — the
  // WS subscription stays on builderExpiry.
  const extraExpiries = useMemo(() => {
    const wanted = new Set(legExpiries);
    if (variant === 'v3') for (const tenor of tenorColumns) wanted.add(tenor);
    wanted.delete(builderExpiry);
    return [...wanted].filter((e) => allExpiries.includes(e));
  }, [legExpiries, tenorColumns, builderExpiry, variant, allExpiries]);
  const extraChains = useChainsForExpiries(underlying, extraExpiries, activeVenues);
  const chainFor = useCallback(
    (expiry: string) => (expiry === builderExpiry ? chain ?? null : extraChains[expiry] ?? null),
    [builderExpiry, chain, extraChains],
  );

  const unroutableLegs = useMemo(() => {
    if (routeVenue === BEST_ROUTE_VALUE || legs.length === 0) return [];
    return legs.filter((leg) => {
      const tenorChain = chainFor(leg.expiry || builderExpiry);
      if (!tenorChain) return false; // chain still loading — don't flag yet
      return (
        repriceLeg(
          tenorChain,
          [routeVenue],
          {
            type: leg.type,
            direction: leg.direction,
            strike: leg.strike,
            expiry: leg.expiry || builderExpiry,
            quantity: leg.quantity,
          },
          { exactStrike: true },
        ) == null
      );
    });
  }, [routeVenue, legs, chainFor, builderExpiry]);

  const routeOptions = useMemo(
    () => [
      {
        value: BEST_ROUTE_VALUE,
        label: 'Best route',
        meta:
          activeVenues.length === 1
            ? VENUES[activeVenues[0] ?? '']?.label ?? '1 venue'
            : `${activeVenues.length} venues`,
      },
      ...VENUE_LIST.filter((venue) => activeVenues.includes(venue.id)).map((venue) => ({
        value: venue.id,
        label: venue.label,
        meta: 'Only',
      })),
    ],
    [activeVenues],
  );

  async function handleSendToPaper(routing?: StrategyRouting) {
    if (pricedLegs.length === 0) return;
    setPaperStatus(null);
    try {
      const req = legsToOrderRequest(pricedLegs, underlying, pricingVenues, routing);
      const strategyName = detectStrategy(pricedLegs);
      const result = await createTrade.mutateAsync({
        label: strategyName,
        strategyName,
        order: req,
      });
      const filledVenues = Array.from(new Set(result.fills.map((fill) => fill.venue)));
      const fillSummary =
        filledVenues.length === 1
          ? VENUES[filledVenues[0] ?? '']?.label ?? filledVenues[0]
          : `${filledVenues.length} venues`;
      setPaperStatus(`Filled on ${fillSummary} - switching to Paper tab`);
      setShowVenues(false);
      setTimeout(() => setActiveTab('trading'), 400);
    } catch (err) {
      setPaperStatus(err instanceof Error ? err.message : 'Paper order failed');
    }
  }

  useEffect(() => {
    setBuilderError(null);
  }, [activeVenues, builderExpiry, underlying]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const decoded = decodeStrategy(params);
    if (!decoded) return;

    clearLegs();
    for (const leg of decoded.legs) addLeg(leg, decoded.underlying);
    setBuilderExpiry(decoded.legs[0]?.expiry ?? '');

    for (const k of STRATEGY_PARAM_KEYS) params.delete(k);
    const clean = params.toString();
    window.history.replaceState({}, '', clean ? `?${clean}` : window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const spotPrice = chain?.stats.forwardPriceUsd ?? chain?.stats.indexPriceUsd ?? 0;
  const availableStrikes = useMemo(() => chain?.strikes.map((s) => s.strike) ?? [], [chain]);

  const repriceStrategyLeg = useCallback(
    (leg: Leg, patch: Partial<Leg> = {}, exactStrike = false) => {
      // Each leg prices against its OWN tenor's chain — legs can live on
      // different expiries now that the ladder has a tenor axis. A missing
      // chain (still loading) returns null so the stored pricing holds.
      const targetExpiry = patch.expiry ?? leg.expiry ?? builderExpiry;
      const tenorChain = chainFor(targetExpiry);
      if (!tenorChain || !targetExpiry) return null;

      return repriceLeg(
        tenorChain,
        pricingVenues,
        {
          type: patch.type ?? leg.type,
          direction: patch.direction ?? leg.direction,
          strike: patch.strike ?? leg.strike,
          expiry: targetExpiry,
          quantity: patch.quantity ?? leg.quantity,
        },
        { exactStrike },
      );
    },
    [pricingVenues, builderExpiry, chainFor],
  );

  const handleLegUpdate = useCallback(
    (legId: string, patch: Partial<Leg>) => {
      const leg = legs.find((entry) => entry.id === legId);
      if (!leg) return;

      const repriced = repriceStrategyLeg(leg, patch, patch.strike != null);
      if (!repriced) return;

      updateLeg(legId, repriced);
    },
    [legs, repriceStrategyLeg, updateLeg],
  );

  const handleLegStrikeDrag = useCallback(
    (legId: string, newStrike: number) => {
      handleLegUpdate(legId, { strike: newStrike });
    },
    [handleLegUpdate],
  );

  const handleLegTenorDrag = useCallback(
    (legId: string, newExpiry: string, strike: number) => {
      const leg = legs.find((entry) => entry.id === legId);
      if (!leg) return;
      // Strike grids differ across tenors — snap to the target tenor's nearest
      // strike (exactStrike: false) while repricing on its chain.
      const repriced = repriceStrategyLeg(leg, { expiry: newExpiry, strike }, false);
      if (!repriced) return;
      updateLeg(legId, repriced);
    },
    [legs, repriceStrategyLeg, updateLeg],
  );

  const handleAddLegAtStrike = useCallback(
    (
      strike: number,
      type: 'call' | 'put',
      direction: 'buy' | 'sell',
      quantity: number,
      expiry?: string,
    ) => {
      const targetExpiry = expiry ?? builderExpiry;
      const tenorChain = chainFor(targetExpiry);
      if (!tenorChain || !targetExpiry) return;
      const repriced = repriceLeg(
        tenorChain,
        pricingVenues,
        { type, direction, strike, expiry: targetExpiry, quantity },
        { exactStrike: false },
      );
      if (!repriced) return;
      addLeg(repriced, underlying);
    },
    [chainFor, pricingVenues, builderExpiry, addLeg, underlying],
  );

  const handleRemoveLeg = useCallback((legId: string) => removeLeg(legId), [removeLeg]);

  const pricedLegs = useMemo(
    () =>
      legs.map((leg) => {
        const repriced = repriceStrategyLeg(leg);
        return repriced ? { ...leg, ...repriced } : leg;
      }),
    [legs, repriceStrategyLeg],
  );

  const payoffPoints = useMemo(() => computePayoff(pricedLegs, spotPrice), [pricedLegs, spotPrice]);
  const metrics = useMemo(
    () => (pricedLegs.length > 0 ? computeMetrics(pricedLegs, spotPrice) : null),
    [pricedLegs, spotPrice],
  );
  const strategyName = useMemo(() => detectStrategy(pricedLegs), [pricedLegs]);

  const baseDte = useMemo(() => {
    if (pricedLegs.length === 0) return 30;
    return dteDays(pricedLegs[0]!.expiry);
  }, [pricedLegs]);

  const scenarioIvPoints = useMemo(() => {
    if (pricedLegs.length === 0 || ivShift === 0) return undefined;
    return computeScenarioPayoff(pricedLegs, spotPrice, ivShift / 100, 0, baseDte);
  }, [pricedLegs, spotPrice, ivShift, baseDte]);

  const scenarioDtePoints = useMemo(() => {
    if (pricedLegs.length === 0 || dteShift === 0) return undefined;
    return computeScenarioPayoff(pricedLegs, spotPrice, 0, dteShift, baseDte);
  }, [pricedLegs, spotPrice, dteShift, baseDte]);

  const hasScenarios = ivShift !== 0 || dteShift !== 0;

  const candleSpec = useMemo(() => pickCandleSpec(pricedLegs), [pricedLegs]);
  const candleAvailable = isSpotCandleCurrency(underlying);
  const {
    data: spotCandlesData,
    dataUpdatedAt: spotCandlesUpdatedAt,
    isLoading: spotCandlesLoading,
    isFetching: spotCandlesFetching,
    isPlaceholderData: spotCandlesIsPlaceholderData,
    isError: spotCandlesIsError,
    error: spotCandlesError,
    refetch: refetchSpotCandles,
  } = useSpotCandles(
    underlying,
    candleSpec.resolutionSec,
    candleSpec.buckets,
    candleSpec.refetchIntervalMs,
  );
  const spotCandlesEmpty = spotCandlesData != null && spotCandlesData.candles.length === 0;
  const spotCandlesFailureMessage =
    spotCandlesEmpty
      ? 'upstream returned empty data'
      : spotCandlesError instanceof Error
        ? spotCandlesError.message
        : null;

  useEffect(() => {
    if (hasUsableSpotCandles(spotCandlesData)) {
      setLastGoodSpotCandles({ data: spotCandlesData, dataUpdatedAt: spotCandlesUpdatedAt });
    }
  }, [spotCandlesData, spotCandlesUpdatedAt]);

  useEffect(() => {
    setLastGoodSpotCandles(null);
  }, [underlying]);

  const visibleSpotCandles = hasUsableSpotCandles(spotCandlesData)
    ? spotCandlesData
    : lastGoodSpotCandles?.data ?? null;
  const visibleSpotCandlesUpdatedAt = hasUsableSpotCandles(spotCandlesData)
    ? spotCandlesUpdatedAt
    : lastGoodSpotCandles?.dataUpdatedAt ?? 0;
  const hasVisibleSpotCandles = hasUsableSpotCandles(visibleSpotCandles);
  const spotCandlesUnavailable = spotCandlesIsError || (spotCandlesEmpty && !spotCandlesFetching);

  function handleCopyUrl() {
    const url = buildShareUrl(pricedLegs, underlying);
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const dragged = findTemplateVariant(
      e.dataTransfer.getData('application/x-oggregator-strategy') ||
        e.dataTransfer.getData('text/plain'),
    );
    clearActiveTemplateDrag();
    if (!dragged) return;

    const result = buildTemplateVariant(
      chain ?? null,
      builderExpiry,
      dragged.template,
      dragged.variant,
    );
    if (!result.ok) {
      setBuilderError(result.error.message);
      return;
    }

    setBuilderError(null);
    // Drop appends — drags are how the user composes a custom multi-leg
    // strategy (e.g. straddle + put spread). Click-to-apply on the card
    // still replaces, since that gesture means "use this template".
    for (const leg of result.legs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.view}>
      <div className={styles.mainArea}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Builder</span>
            <AssetPickerButton />
            <VenuePickerButton />
          </div>
        </div>

        <StrategyTemplates
          chain={chain ?? null}
          expiry={builderExpiry}
          underlying={underlying}
          errorMessage={builderError}
          onErrorMessageChange={setBuilderError}
        />

        <div className={styles.splitBody}>
          <div className={styles.controlsCol}>
            <LegInput chain={chain ?? null} expiry={builderExpiry} onExpiryChange={setBuilderExpiry} />

            {legs.length > 0 && (
              <div className={styles.legsSection}>
                <div className={styles.legsSectionHeader}>
                  <span className={styles.strategyName}>{strategyName}</span>
                  <button className={styles.clearBtn} onClick={clearLegs}>
                    Clear
                  </button>
                </div>

                <div className={styles.legsList}>
                  {legs.map((leg) => (
                    <LegRow
                      key={leg.id}
                      leg={leg}
                      allStrikes={availableStrikes}
                      onRemove={() => removeLeg(leg.id)}
                      onUpdate={handleLegUpdate}
                    />
                  ))}
                </div>
              </div>
            )}

            {legs.length > 0 && (
              <button className={styles.compareBtn} onClick={() => setShowVenues(true)}>
                Compare Venues
              </button>
            )}

            {legs.length > 0 && (
              <div className={styles.paperTradeControls}>
                <span className={styles.paperTradeLabel}>Route</span>
                <DropdownPicker
                  options={routeOptions}
                  value={routeVenue}
                  onChange={setRouteVenue}
                />
                {unroutableLegs.length > 0 && (
                  <div className={styles.routeUnroutable}>
                    {unroutableLegs.length === legs.length
                      ? `No legs have a quote on ${VENUES[routeVenue]?.label ?? routeVenue}.`
                      : `${unroutableLegs.length} of ${legs.length} legs have no quote on ${VENUES[routeVenue]?.label ?? routeVenue}.`}{' '}
                    Pick another venue or switch to Best route.
                  </div>
                )}
              </div>
            )}

            {legs.length > 0 && (
              <button
                className={styles.compareBtn}
                onClick={() => handleSendToPaper()}
                disabled={createTrade.isPending}
                style={{ marginTop: 8 }}
              >
                {createTrade.isPending ? 'Sending…' : 'Send to paper'}
              </button>
            )}

            {paperStatus && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                {paperStatus}
              </div>
            )}

            {legs.length === 0 && (
              <div className={styles.emptyLegs}>
                Pick a template, add custom legs, or drag strikes on the chart.
              </div>
            )}
          </div>

          <div className={styles.chartCol}>
            <div
              className={`${styles.chartPanel} ${dragOver ? styles.chartPanelDragOver : ''}`}
              data-variant={variant}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {/* V3 stays mounted when empty: its ladder is the empty state
                  (click a rung to place the first leg). V1/V2 keep the ghost. */}
              {legs.length === 0 && variant !== 'v3' ? (
                <div className={styles.chartEmpty}>
                  <svg
                    className={styles.ghostChart}
                    viewBox="0 0 200 100"
                    preserveAspectRatio="none"
                  >
                    {[20, 40, 60, 80].map((y) => (
                      <line
                        key={`h${y}`}
                        x1="0"
                        y1={y}
                        x2="200"
                        y2={y}
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        opacity="0.4"
                      />
                    ))}
                    {[40, 80, 120, 160].map((x) => (
                      <line
                        key={`v${x}`}
                        x1={x}
                        y1="0"
                        x2={x}
                        y2="100"
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        opacity="0.4"
                      />
                    ))}
                    <line
                      x1="0"
                      y1="50"
                      x2="200"
                      y2="50"
                      stroke="var(--text-dim)"
                      strokeWidth="0.8"
                      strokeDasharray="4 3"
                      opacity="0.3"
                    />
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 140 35 L 200 35"
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeWidth="1.5"
                      opacity="0.12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 100 50 L 60 50 L 0 50 Z"
                      fill="var(--color-loss)"
                      opacity="0.03"
                    />
                    <path
                      d="M 100 50 L 140 35 L 200 35 L 200 50 L 100 50 Z"
                      fill="var(--color-profit)"
                      opacity="0.03"
                    />
                  </svg>
                  <div className={styles.chartDropHint}>
                    <span className={styles.chartDropIcon}>{dragOver ? '+' : '↕'}</span>
                    <span className={styles.chartDropText}>
                      {dragOver
                        ? 'Drop to apply strategy'
                        : 'Drag a strategy here, or select from the templates above'}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.chartTitleRow}>
                    <div className={styles.chartTitleBlock}>
                      <div className={styles.chartTitle}>
                        {variant === 'v1'
                          ? 'P&L at Expiry'
                          : variant === 'v2'
                            ? 'Live Spot vs Break-even Zones'
                            : 'Lego Ladder'}
                      </div>
                      {variant === 'v2' && (
                        <div className={styles.chartTitleMeta}>
                          {candleSpec.rangeLabel} window · {candleSpec.intervalLabel} candles · tenor-led
                        </div>
                      )}
                    </div>
                    <div className={styles.variantToggle}>
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v1'}
                        data-variant="v1"
                        onClick={() => setVariant('v1')}
                      >
                        V1
                      </button>
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v2'}
                        data-variant="v2"
                        onClick={() => setVariant('v2')}
                      >
                        V2
                      </button>
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v3'}
                        data-variant="v3"
                        onClick={() => setVariant('v3')}
                      >
                        V3
                      </button>
                    </div>
                  </div>

                  {variant === 'v1' ? (
                    <>
                      <PayoffChart
                        points={payoffPoints}
                        breakevens={metrics?.breakevens ?? []}
                        spotPrice={spotPrice}
                        legs={pricedLegs}
                        maxProfit={metrics?.maxProfit ?? null}
                        maxLoss={metrics?.maxLoss ?? null}
                        strikes={availableStrikes}
                        onLegStrikeDrag={handleLegStrikeDrag}
                        scenarioIvPoints={scenarioIvPoints}
                        scenarioDtePoints={scenarioDtePoints}
                      />
                      {hasScenarios && (
                        <div className={styles.scenarioLegend}>
                          <span className={styles.legendItem}>
                            <span className={`${styles.legendDot} ${styles.legendDotBase}`} />
                            <span className={styles.legendLabel}>At expiry</span>
                          </span>
                          {ivShift !== 0 && (
                            <span className={styles.legendItem}>
                              <span className={`${styles.legendDot} ${styles.legendDotIv}`} />
                              <span className={styles.legendLabel}>
                                IV {ivShift > 0 ? '+' : ''}
                                {ivShift}%
                              </span>
                            </span>
                          )}
                          {dteShift !== 0 && (
                            <span className={styles.legendItem}>
                              <span className={`${styles.legendDot} ${styles.legendDotDte}`} />
                              <span className={styles.legendLabel}>
                                {dteShift > 0 ? '+' : ''}
                                {dteShift}d DTE
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : variant === 'v2' ? (
                    <>
                      {candleAvailable && (
                        <SnapshotBanner
                          dataUpdatedAt={visibleSpotCandlesUpdatedAt}
                          hasData={hasVisibleSpotCandles}
                          isFetching={spotCandlesFetching}
                          windowLabel={candleSpec.rangeLabel}
                          intervalLabel={candleSpec.intervalLabel}
                          isSwitchingWindow={spotCandlesIsPlaceholderData && hasVisibleSpotCandles}
                          isError={spotCandlesUnavailable}
                          errorMessage={spotCandlesFailureMessage}
                          isEmpty={spotCandlesEmpty && !hasVisibleSpotCandles}
                          onRetry={() => {
                            void refetchSpotCandles();
                          }}
                        />
                      )}
                      <PayoffChartV2
                        candles={visibleSpotCandles?.candles ?? []}
                        breakevens={metrics?.breakevens ?? []}
                        spotPrice={spotPrice}
                        legs={pricedLegs}
                        resolutionSec={candleSpec.resolutionSec}
                        loading={spotCandlesLoading && candleAvailable}
                        available={candleAvailable}
                        onSwitchToV1={() => setVariant('v1')}
                      />
                    </>
                  ) : (
                    <PayoffChartV3
                      points={payoffPoints}
                      breakevens={metrics?.breakevens ?? []}
                      spotPrice={spotPrice}
                      legs={pricedLegs}
                      netDebit={metrics?.netDebit ?? 0}
                      strikes={availableStrikes}
                      tenors={tenorColumns}
                      activeTenor={builderExpiry}
                      onLegStrikeDrag={handleLegStrikeDrag}
                      onLegTenorDrag={handleLegTenorDrag}
                      onAddLegAtStrike={handleAddLegAtStrike}
                      onRemoveLeg={handleRemoveLeg}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className={styles.rightCol}>
            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Metrics</span>
              <div className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>
                    {metrics
                      ? metrics.netDebit < 0
                        ? 'Debit'
                        : metrics.netDebit > 0
                          ? 'Credit'
                          : 'Net'
                      : 'Net'}
                  </span>
                  <span
                    className={styles.metricCardVal}
                    data-positive={metrics ? metrics.netDebit > 0 : undefined}
                    data-negative={metrics ? metrics.netDebit < 0 : undefined}
                  >
                    {metrics ? fmtUsd(Math.abs(metrics.netDebit)) : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Max Profit</span>
                  <span
                    className={styles.metricCardVal}
                    data-positive={metrics ? 'true' : undefined}
                  >
                    {metrics ? (metrics.maxProfit != null ? fmtUsd(metrics.maxProfit) : '∞') : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Max Loss</span>
                  <span
                    className={styles.metricCardVal}
                    data-negative={metrics ? 'true' : undefined}
                  >
                    {metrics ? (metrics.maxLoss != null ? fmtUsd(metrics.maxLoss) : '∞') : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>Breakeven</span>
                  <span className={styles.metricCardVal}>
                    {metrics && metrics.breakevens.length > 0
                      ? metrics.breakevens.map((b) => fmtUsd(b)).join(', ')
                      : '–'}
                  </span>
                </div>
              </div>
            </div>

            <div
              className={styles.rightSection}
              data-partial={metrics ? metrics.greeksMissingLegs > 0 : undefined}
            >
              <span className={styles.rightSectionTitle}>Greeks</span>
              <div className={styles.greeksGrid}>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Δ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netDelta?.toFixed(3) ?? '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Γ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netGamma?.toFixed(5) ?? '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Θ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netTheta != null ? fmtUsd(metrics.netTheta) : '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>V</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netVega != null ? fmtUsd(metrics.netVega) : '–'}
                  </span>
                </div>
              </div>
              {metrics && metrics.greeksMissingLegs > 0 && (
                <span className={styles.greeksPartial}>
                  {legs.length - metrics.greeksMissingLegs}/{legs.length} legs reporting
                </span>
              )}
            </div>

            <div className={styles.rightSection}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span className={styles.rightSectionTitle}>Scenarios</span>
                {hasScenarios && (
                  <button
                    className={styles.sliderReset}
                    onClick={() => {
                      setIvShift(0);
                      setDteShift(0);
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>IV</span>
                <div className={styles.sliderWrap}>
                  <input
                    type="range"
                    className={styles.sliderInput}
                    data-kind="iv"
                    min={-30}
                    max={30}
                    step={1}
                    value={ivShift}
                    onChange={(e) => setIvShift(Number(e.target.value))}
                    disabled={legs.length === 0}
                  />
                </div>
                <span className={styles.sliderValue}>
                  {ivShift > 0 ? '+' : ''}
                  {ivShift}%
                </span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>DTE</span>
                <div className={styles.sliderWrap}>
                  <input
                    type="range"
                    className={styles.sliderInput}
                    data-kind="dte"
                    min={-Math.min(baseDte, 60)}
                    max={60}
                    step={1}
                    value={dteShift}
                    onChange={(e) => setDteShift(Number(e.target.value))}
                    disabled={legs.length === 0}
                  />
                </div>
                <span className={styles.sliderValue}>
                  {dteShift > 0 ? '+' : ''}
                  {dteShift}d
                </span>
              </div>
            </div>

            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>Share</span>
              <div className={styles.shareBar}>
                <span className={styles.shareUrl}>
                  {pricedLegs.length > 0
                    ? buildShareUrl(pricedLegs, underlying)
                    : 'Build a strategy to share'}
                </span>
                {pricedLegs.length > 0 &&
                  (copied ? (
                    <span className={styles.shareCopied}>Copied</span>
                  ) : (
                    <button className={styles.shareBtn} onClick={handleCopyUrl}>
                      Copy
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showVenues && (
        <>
          <div className={styles.backdrop} onClick={() => setShowVenues(false)} />
          <VenueSlideover
            legs={pricedLegs}
            chain={chain ?? null}
            activeVenues={activeVenues}
            onClose={() => setShowVenues(false)}
            onSendToPaper={(routing) => handleSendToPaper(routing)}
            isSending={createTrade.isPending}
          />
        </>
      )}
    </div>
  );
}
