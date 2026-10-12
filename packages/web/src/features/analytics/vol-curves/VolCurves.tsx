import { useMemo, useState } from 'react';

import type { EnrichedChainResponse } from '@shared/enriched';
import InfoTip from '@components/ui/InfoTip';
import analyticsStyles from '../AnalyticsView.module.css';
import {
  SHORT_DATED_DTE,
  buildCurves,
  defaultFocus,
  defaultXDomain,
  isDefaultVisible,
  medianSpreadVol,
  type SmileCurve,
  type XAxisMode,
} from './model';
import VolCurvesChart from './VolCurvesChart';
import styles from './VolCurves.module.css';

interface VolCurvesProps {
  chains: EnrichedChainResponse[];
  // Parent passes a per-expiry forward as `spotPrice`; we keep it as a fallback
  // but prefer chain.stats.indexPriceUsd (true spot) when available.
  spotPrice: number | null;
}

// undefined = automatic (expiry nearest 30 DTE), null = no focus.
type FocusState = string | null | undefined;

function fmtVol(v: number | null): string {
  return v == null ? '–' : `${(v * 100).toFixed(1)}%`;
}

function fmtVolPts(v: number | null, signed = false): string {
  if (v == null) return '–';
  const pts = v * 100;
  return `${signed && pts > 0 ? '+' : ''}${pts.toFixed(1)}`;
}

export default function VolCurves({ chains, spotPrice }: VolCurvesProps) {
  const [mode, setMode] = useState<XAxisMode>('strike');
  const [visibility, setVisibility] = useState<Map<string, boolean>>(new Map());
  const [focus, setFocus] = useState<FocusState>(undefined);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showVenues, setShowVenues] = useState(false);
  const [zoom, setZoom] = useState<[number, number] | null>(null);

  const indexSpot = useMemo(
    () => chains.find((c) => c.stats.indexPriceUsd != null)?.stats.indexPriceUsd ?? spotPrice,
    [chains, spotPrice],
  );

  const curves = useMemo(() => buildCurves(chains, indexSpot, Date.now()), [chains, indexSpot]);

  const isVisible = (c: SmileCurve) => visibility.get(c.expiry) ?? isDefaultVisible(c);
  const visibleCurves = curves.filter(isVisible);

  const pinnedExpiry =
    focus === undefined
      ? defaultFocus(visibleCurves)
      : focus != null && visibleCurves.some((c) => c.expiry === focus)
        ? focus
        : null;
  const focusExpiry = hovered ?? pinnedExpiry;
  const focused = curves.find((c) => c.expiry === focusExpiry) ?? null;
  const chartCurves =
    focused != null && !visibleCurves.includes(focused) ? [...visibleCurves, focused] : visibleCurves;

  const defaultDomain = defaultXDomain(mode, visibleCurves, indexSpot);
  const xBounds = useMemo<[number, number] | null>(() => {
    if (mode === 'delta') return [0, 1];
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of curves) {
      for (const p of c.points) {
        lo = Math.min(lo, p.strike);
        hi = Math.max(hi, p.strike);
      }
    }
    return lo < hi ? [lo, hi] : null;
  }, [mode, curves]);

  const xDomain = zoom ?? defaultDomain;

  if (curves.length === 0) return null;

  const pinned = curves.find((c) => c.expiry === pinnedExpiry) ?? null;
  const crossedCount = pinned?.points.filter((p) => p.crossed).length ?? 0;
  const shortDatedHidden = curves.some((c) => !isDefaultVisible(c) && !isVisible(c));

  const toggleVisible = (c: SmileCurve) => {
    setVisibility((prev) => new Map(prev).set(c.expiry, !isVisible(c)));
  };

  const toggleFocus = (c: SmileCurve) => {
    if (!isVisible(c)) setVisibility((prev) => new Map(prev).set(c.expiry, true));
    setFocus(pinnedExpiry === c.expiry ? null : c.expiry);
  };

  const changeMode = (next: XAxisMode) => {
    setMode(next);
    setZoom(null);
  };

  return (
    <div className={analyticsStyles.card}>
      <div className={styles.header}>
        <div>
          <div className={analyticsStyles.cardTitle}>
            <span>
              Implied Volatility Curves
              <ReadingGuide indexSpot={indexSpot} />
            </span>
          </div>
          <div className={analyticsStyles.cardSubtitle}>
            OTM-blended mark IV per strike · best bid/ask across venues on the focused expiry
          </div>
        </div>
        <div className={styles.controls}>
          <div className={analyticsStyles.oiToggle} role="group" aria-label="X axis">
            <button
              type="button"
              className={analyticsStyles.oiToggleBtn}
              data-active={mode === 'strike' || undefined}
              onClick={() => changeMode('strike')}
            >
              Strike
            </button>
            <button
              type="button"
              className={analyticsStyles.oiToggleBtn}
              data-active={mode === 'delta' || undefined}
              onClick={() => changeMode('delta')}
            >
              Delta
            </button>
          </div>
          <div className={analyticsStyles.oiToggle}>
            <button
              type="button"
              className={analyticsStyles.oiToggleBtn}
              data-active={showVenues || undefined}
              aria-pressed={showVenues}
              onClick={() => setShowVenues((v) => !v)}
            >
              Venues
            </button>
          </div>
          {zoom != null && (
            <button type="button" className={styles.resetBtn} onClick={() => setZoom(null)}>
              Reset zoom
            </button>
          )}
        </div>
      </div>

      <div className={analyticsStyles.curveHint}>
        Click an expiry to focus · click its swatch to hide/show · scroll to zoom, drag to pan,
        double-click to reset
        {shortDatedHidden ? ` · <${SHORT_DATED_DTE}d expiries hidden by default` : ''}
      </div>

      <div className={analyticsStyles.curveLegend}>
        {curves.map((curve) => {
          const visible = isVisible(curve);
          const isPinned = curve.expiry === pinnedExpiry;
          return (
            <span
              key={curve.expiry}
              className={styles.chip}
              data-visible={visible || undefined}
              data-focused={isPinned || undefined}
              onMouseEnter={() => setHovered(curve.expiry)}
              onMouseLeave={() => setHovered(null)}
            >
              <button
                type="button"
                className={styles.chipSwatch}
                aria-label={`${visible ? 'Hide' : 'Show'} ${curve.label}`}
                aria-pressed={visible}
                onClick={() => toggleVisible(curve)}
              >
                <span style={{ background: curve.color }} />
              </button>
              <button
                type="button"
                className={styles.chipLabel}
                aria-pressed={isPinned}
                title={`${curve.dte}d to expiry`}
                onClick={() => toggleFocus(curve)}
              >
                {curve.label}
              </button>
            </span>
          );
        })}
      </div>

      {pinned && (
        <div className={styles.focusBar}>
          <span style={{ color: pinned.color }}>{pinned.label}</span>
          <span className={styles.focusStat}>{pinned.dte}d</span>
          <span className={styles.focusStat}>
            ATM <b>{fmtVol(pinned.atmIv)}</b>
          </span>
          <span className={styles.focusStat} title="25Δ risk reversal: call IV − put IV">
            25Δ RR <b>{fmtVolPts(pinned.rr25, true)}</b>
          </span>
          <span className={styles.focusStat} title="Median best-ask minus best-bid IV across strikes">
            Median spread <b>{fmtVolPts(medianSpreadVol(pinned.points))} vol</b>
          </span>
          {crossedCount > 0 && (
            <span className={styles.focusCrossed}>
              {crossedCount} crossed {crossedCount === 1 ? 'strike' : 'strikes'}
            </span>
          )}
        </div>
      )}

      <div className={analyticsStyles.curveChartArea}>
        {xDomain != null && xBounds != null && (
          <VolCurvesChart
            curves={chartCurves}
            focused={focused}
            mode={mode}
            xDomain={xDomain}
            xBounds={xBounds}
            onXDomainChange={setZoom}
            showVenues={showVenues}
            indexSpot={indexSpot}
          />
        )}
      </div>
    </div>
  );
}

function ReadingGuide({ indexSpot }: { indexSpot: number | null }) {
  return (
    <InfoTip label="How to read these curves" title="Reading the IV curves" align="start">
      <p>
        Each line is one expiry&apos;s <strong>volatility smile</strong>: implied volatility (Y) vs.
        strike or delta (X). Per strike we blend the <strong>OTM side</strong> only — puts below the
        forward, calls above — because OTM options are what actually trade and price the wings.
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>Quote filter:</strong> a venue contributes only if it has a real market (genuine
        bid/ask AND OI &gt; 0 or bid ≠ ask) and IV sits in the 5%–500% sanity band. Single wing marks
        more than 2× the local median beyond ±15% of the forward are dropped (Black-Scholes
        degeneracy as option price → 0).
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>Focused expiry:</strong> defaults to the expiry nearest 30 days. Every strike gets a
        vertical bar from the <strong style={{ color: 'var(--color-profit)' }}>best bid IV</strong>{' '}
        (highest across venues) to the{' '}
        <strong style={{ color: 'var(--color-loss)' }}>best ask IV</strong> (lowest across venues) on
        the OTM contract. Bar length is the executable spread in vol points; bar opacity scales with
        open interest. A short bar means the mark is well anchored; a long bar means the curve there
        is mostly the venue&apos;s model.
      </p>
      <p style={{ marginTop: 6 }}>
        <strong style={{ color: 'var(--color-warning)' }}>Crossed</strong> strikes have one
        venue&apos;s best bid above another venue&apos;s best ask. That is before fees, size limits
        and settlement-currency differences, so treat it as a lead to check, not a guaranteed edge.
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>Delta axis:</strong> plots each expiry by Black-76 forward delta (from its mark IV),
        so 25Δ puts and calls line up across tenors and skew is comparable between short and long
        expiries. On the strike axis, short-dated smiles always look steeper.
      </p>
      <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        <li>
          <strong>Dip</strong> near the dashed line = ATM IV for that expiry
          {indexSpot != null ? ` (spot $${(indexSpot / 1000).toFixed(1)}k)` : ''}.
        </li>
        <li>
          <strong>Left wing higher than right</strong> = put skew (downside fear), normal in BTC/ETH.
        </li>
        <li>
          <strong>Color = tenor</strong>: light cyan = near-dated, deep navy = long-dated. Near above
          far = backwardation (event risk priced in).
        </li>
        <li>
          Expiries under {SHORT_DATED_DTE} days are hidden by default — their annualised IV is noisy
          and would flatten the other curves. Click the swatch to show them.
        </li>
      </ul>
    </InfoTip>
  );
}
