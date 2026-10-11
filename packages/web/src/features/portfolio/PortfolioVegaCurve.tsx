import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import type { BreakEvenIvRow, PositionLeg, VegaByStrikeRow } from '@oggregator/protocol';

import GreekProfileChart, { type ProfileLine } from './GreekProfileChart';
import { buildProfileLegs, buildSpotProfile, buildVolShockProfile } from './greek-profile';
import { buildStrikeRiskBuckets, type StrikeRiskMode } from './strike-risk';
import styles from './PortfolioVegaCurve.module.css';

function hasUsefulGreeks(rows: VegaByStrikeRow[]): boolean {
  return rows.some(
    (row) =>
      row.delta !== 0 ||
      row.vega !== 0 ||
      row.gamma !== 0 ||
      row.theta !== 0 ||
      row.vanna !== 0 ||
      row.volga !== 0,
  );
}

function hasUsefulBreakEven(rows: BreakEvenIvRow[]): boolean {
  return rows.some((row) => row.currentIv != null || row.breakEvenIv != null);
}

function sameLegSignature(left: VegaByStrikeRow[], right: VegaByStrikeRow[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      other != null &&
      row.expiry === other.expiry &&
      row.strike === other.strike &&
      row.optionRight === other.optionRight
    );
  });
}

interface ModeMeta {
  tab: string;
  greek: string;
  question: string;
  scenario: string;
  axis: string;
  profileAxis: string;
  lesson: string;
}

type ChartView = 'curve' | 'strikes';

interface Props {
  positions: PositionLeg[];
  byStrike: VegaByStrikeRow[];
  breakEven: BreakEvenIvRow[];
  spotUsd: number | null;
  underlying: string | null;
}

const MODES: StrikeRiskMode[] = ['delta', 'vega', 'gamma', 'theta', 'vanna', 'volga'];
const COLORS: Record<StrikeRiskMode, string> = {
  delta: '#50d2c1',
  vega: '#a78bfa',
  gamma: '#f59e0b',
  theta: '#f472b6',
  vanna: '#60a5fa',
  volga: '#f0c76a',
};
const LOSS_COLOR = '#ef6177';

const MODE_META: Record<StrikeRiskMode, ModeMeta> = {
  delta: {
    tab: 'Direction',
    greek: 'Delta Δ',
    question: 'What is my position worth if spot moves?',
    scenario: 'Spot +1%',
    axis: 'estimated P&L for a +1% spot move',
    profileAxis: 'Net delta at each spot price: the perp position your options behave like',
    lesson: 'Delta is your options book expressed as a perp position right now.',
  },
  vega: {
    tab: 'IV',
    greek: 'Vega ν',
    question: 'What happens if implied volatility rises?',
    scenario: 'IV +1 point',
    axis: 'estimated P&L for a +1 vol-point IV move',
    profileAxis: 'Dollars gained per +1 vol point of IV, at each spot price',
    lesson: 'A vol point means 60% IV moving to 61%, not a 1% relative change.',
  },
  gamma: {
    tab: 'Big moves',
    greek: 'Gamma Γ',
    question: 'Does a large spot move help or hurt?',
    scenario: 'Spot ±5%',
    axis: 'curvature P&L for a ±5% spot move',
    profileAxis: 'Delta change for a 1% spot move, at each spot price',
    lesson:
      'Gamma is the extra curvature beyond your current delta. It has the same sign up or down.',
  },
  theta: {
    tab: 'Time decay',
    greek: 'Theta Θ',
    question: 'Am I paying or collecting time decay?',
    scenario: '24 hours pass',
    axis: 'estimated P&L after 24 hours with spot and IV unchanged',
    profileAxis: 'Dollars of daily decay at each spot price',
    lesson:
      'Theta is the rent on convexity: long options pay it daily, short options collect it. Positive theta usually means short gamma.',
  },
  vanna: {
    tab: 'Hedge drift',
    greek: 'Vanna',
    question: 'How does an IV move change my perp hedge?',
    scenario: 'IV +5 points',
    axis: 'change in underlying delta after IV rises 5 points',
    profileAxis: 'Delta change per +1 vol point of IV, at each spot price',
    lesson:
      'Vanna does not directly show P&L; it shows how much your directional hedge can drift as IV changes.',
  },
  volga: {
    tab: 'Vol convexity',
    greek: 'Volga',
    question: 'Does a large IV move add hidden curvature?',
    scenario: 'IV ±5 points',
    axis: 'second-order P&L for a ±5 vol-point IV move',
    profileAxis:
      'P&L for a parallel IV shift: full repricing against the vega-only line. The gap is volga.',
    lesson: 'Volga is to volatility what gamma is to spot: the second-order effect after vega.',
  },
};

const WIDTH = 760;
const HEIGHT = 250;
const PADDING = { top: 24, right: 20, bottom: 38, left: 72 };

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function fmtNumber(value: number, digits = 4): string {
  const abs = Math.abs(value);
  if (abs >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 10) return trimTrailingZeros(value.toFixed(1));
  if (abs >= 1) return trimTrailingZeros(value.toFixed(2));
  if (abs === 0) return '0';
  const fixed = value.toFixed(digits);
  if (Number(fixed) === 0) return value.toPrecision(2);
  return trimTrailingZeros(fixed);
}

function fmtSignedNumber(value: number, digits = 4): string {
  return `${value > 0 ? '+' : ''}${fmtNumber(value, digits)}`;
}

function fmtUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = usdDigits(abs);
  return `${value >= 0 ? '+' : '-'}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function usdDigits(abs: number): number {
  return abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
}

function fmtAxisUsd(value: number, digits: number): string {
  if (value === 0) return '$0';
  return `${value > 0 ? '+' : '-'}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function fmtStrike(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function stepDigits(step: number): number {
  if (!(step > 0)) return 0;
  const magnitude = Math.floor(Math.log10(step));
  const fractionalMantissa = !Number.isInteger(Number((step / 10 ** magnitude).toFixed(6)));
  return Math.max(0, Math.min(8, -magnitude + (fractionalMantissa ? 1 : 0)));
}

function isUsdProfile(mode: StrikeRiskMode): boolean {
  return mode === 'vega' || mode === 'theta' || mode === 'volga';
}

function profileTick(mode: StrikeRiskMode, value: number, step: number): string {
  const digits = stepDigits(step);
  if (isUsdProfile(mode)) return fmtAxisUsd(value, digits);
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function profileValue(mode: StrikeRiskMode, value: number, underlying: string): string {
  switch (mode) {
    case 'delta':
      return `${fmtSignedNumber(value)} ${underlying}`;
    case 'gamma':
      return `${fmtSignedNumber(value)} Δ / 1%`;
    case 'vega':
      return `${fmtUsd(value)} / vol pt`;
    case 'theta':
      return `${fmtUsd(value)} / day`;
    case 'vanna':
      return `${fmtSignedNumber(value, 6)} Δ / vol pt`;
    case 'volga':
      return fmtUsd(value);
  }
}

function fmtVolShift(value: number): string {
  return value === 0 ? 'IV now' : `IV ${value > 0 ? '+' : ''}${fmtNumber(value)} pts`;
}

function fmtIv(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function scenarioDisplay(
  mode: StrikeRiskMode,
  value: number,
  underlying: string,
  spotUsd: number | null,
): string {
  if (spotUsd == null && mode === 'delta') {
    return `${fmtSignedNumber(value)} ${underlying} Δ`;
  }
  if (spotUsd == null && mode === 'gamma') {
    return `${fmtSignedNumber(value, 6)} Δ / $1`;
  }
  return mode === 'vanna' ? `${fmtSignedNumber(value)} ${underlying} Δ` : fmtUsd(value);
}

function rawDisplay(
  mode: StrikeRiskMode,
  value: number,
  underlying: string,
  spotUsd: number | null,
): string {
  switch (mode) {
    case 'delta':
      return `${fmtSignedNumber(value)} ${underlying}`;
    case 'vega':
      return `${fmtUsd(value)} / vol point`;
    case 'theta':
      return `${fmtUsd(value)} / day`;
    case 'gamma':
      // Raw gamma per $1 is ~1e-7 on BTC; per 1% spot move is the readable unit.
      return spotUsd == null
        ? `${fmtSignedNumber(value, 6)} Δ / $1`
        : `${fmtSignedNumber(value * spotUsd * 0.01)} ${underlying} Δ / 1% spot`;
    case 'vanna':
      return `${fmtSignedNumber(value, 6)} Δ / vol point`;
    case 'volga':
      return `${fmtUsd(value)} / vol point²`;
  }
}

function posture(mode: StrikeRiskMode, value: number): string {
  if (Math.abs(value) < 1e-12) return 'FLAT';
  if (mode === 'delta') return value > 0 ? 'LONG DELTA' : 'SHORT DELTA';
  if (mode === 'vega') return value > 0 ? 'LONG VOL' : 'SHORT VOL';
  if (mode === 'gamma') return value > 0 ? 'LONG CONVEXITY' : 'SHORT CONVEXITY';
  if (mode === 'theta') return value > 0 ? 'COLLECTING THETA' : 'PAYING THETA';
  if (mode === 'vanna') return value > 0 ? 'HEDGE GROWS WITH IV' : 'HEDGE SHRINKS WITH IV';
  return value > 0 ? 'LONG VOL CONVEXITY' : 'SHORT VOL CONVEXITY';
}

function actionText(mode: StrikeRiskMode, rawValue: number, underlying: string): string {
  if (mode === 'delta' && underlying === 'underlying') {
    return 'Select BTC or ETH to calculate the perp hedge.';
  }
  if (Math.abs(rawValue) < 1e-12) return 'No action needed for this Greek.';
  if (mode === 'delta') {
    const side = rawValue > 0 ? 'SHORT' : 'LONG';
    return `${side} ${fmtNumber(Math.abs(rawValue))} ${underlying}-PERP`;
  }
  if (mode === 'gamma') return 'Recheck and rebalance delta after spot moves.';
  if (mode === 'theta') {
    return rawValue > 0
      ? 'Decay pays you; watch the short gamma that funds it.'
      : 'You need realized moves to out-earn this daily decay.';
  }
  if (mode === 'vanna') return 'Recheck the perp hedge after a material IV move.';
  return 'A perp cannot hedge this; offset it with options.';
}

function actionLabel(mode: StrikeRiskMode): string {
  return mode === 'delta' ? 'Perp hedge to flatten' : 'Practical action';
}

export default function PortfolioVegaCurve({
  positions,
  byStrike,
  breakEven,
  spotUsd,
  underlying,
}: Props) {
  const [mode, setMode] = useState<StrikeRiskMode>('delta');
  const [view, setView] = useState<ChartView>('curve');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [stickyByStrike, setStickyByStrike] = useState<VegaByStrikeRow[] | null>(null);
  const [stickyBreakEven, setStickyBreakEven] = useState<BreakEvenIvRow[] | null>(null);
  const meta = MODE_META[mode];
  const asset = underlying == null || underlying === 'all' ? 'underlying' : underlying;

  useEffect(() => {
    if (byStrike.length === 0) {
      setStickyByStrike(null);
      return;
    }
    if (stickyByStrike != null && !sameLegSignature(byStrike, stickyByStrike)) {
      setStickyByStrike(null);
      return;
    }
    if (hasUsefulGreeks(byStrike)) setStickyByStrike(byStrike);
  }, [byStrike, stickyByStrike]);

  useEffect(() => {
    if (breakEven.length === 0) {
      setStickyBreakEven(null);
      return;
    }
    if (hasUsefulBreakEven(breakEven)) setStickyBreakEven(breakEven);
  }, [breakEven]);

  const displayByStrike =
    byStrike.length > 0 && (hasUsefulGreeks(byStrike) || stickyByStrike == null)
      ? byStrike
      : (stickyByStrike ?? byStrike);
  const displayBreakEven =
    breakEven.length > 0 && (hasUsefulBreakEven(breakEven) || stickyBreakEven == null)
      ? breakEven
      : (stickyBreakEven ?? breakEven);
  const isStale = displayByStrike !== byStrike || displayBreakEven !== breakEven;

  const expiries = useMemo(
    () => Array.from(new Set(displayByStrike.map((row) => row.expiry))).sort(),
    [displayByStrike],
  );
  const activeExpiry = expiry != null && expiries.includes(expiry) ? expiry : (expiries[0] ?? null);
  const buckets = useMemo(
    () => buildStrikeRiskBuckets(displayByStrike, activeExpiry, mode, spotUsd),
    [activeExpiry, displayByStrike, mode, spotUsd],
  );
  const totalRaw = buckets.reduce((sum, bucket) => sum + bucket.rawValue, 0);
  const totalScenario = buckets.reduce((sum, bucket) => sum + bucket.scenarioValue, 0);
  const defaultStrike =
    buckets.reduce<(typeof buckets)[number] | null>(
      (largest, bucket) =>
        largest == null || Math.abs(bucket.scenarioValue) > Math.abs(largest.scenarioValue)
          ? bucket
          : largest,
      null,
    )?.strike ?? null;
  const activeStrike = buckets.some((bucket) => bucket.strike === selectedStrike)
    ? selectedStrike
    : defaultStrike;
  const activeBucket = buckets.find((bucket) => bucket.strike === activeStrike) ?? null;
  const grossScenario = buckets.reduce((sum, bucket) => sum + Math.abs(bucket.scenarioValue), 0);
  const concentration =
    activeBucket == null || grossScenario === 0
      ? 0
      : (Math.abs(activeBucket.scenarioValue) / grossScenario) * 100;

  const chart = useMemo(() => {
    if (buckets.length === 0) return null;
    const maxAbs = Math.max(...buckets.map((bucket) => Math.abs(bucket.scenarioValue)), 0.000001);
    const yExtent = maxAbs * 1.2;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const strikes = buckets.map((bucket) => bucket.strike);
    const spot = spotUsd != null && Number.isFinite(spotUsd) && spotUsd > 0 ? spotUsd : null;
    const lo = Math.min(...strikes, spot ?? Infinity);
    const hi = Math.max(...strikes, spot ?? -Infinity);
    const pad = Math.max((hi - lo) * 0.1, ((hi + lo) / 2) * 0.03);
    const domainLo = lo - pad;
    const domainHi = hi + pad;
    const toX = (price: number) =>
      PADDING.left + ((price - domainLo) / (domainHi - domainLo)) * innerW;
    const xs = strikes.map(toX);
    let minGap = Infinity;
    for (let i = 1; i < xs.length; i += 1) minGap = Math.min(minGap, xs[i]! - xs[i - 1]!);
    const barWidth = Math.max(3, Math.min(24, minGap * 0.7));
    const hitEdges = xs.map((x, i) => ({
      left: i === 0 ? PADDING.left : (xs[i - 1]! + x) / 2,
      right: i === xs.length - 1 ? WIDTH - PADDING.right : (x + xs[i + 1]!) / 2,
    }));
    const zeroY = PADDING.top + innerH / 2;
    const toY = (value: number) => zeroY - (value / yExtent) * (innerH / 2);
    return { barWidth, hitEdges, maxAbs, spot, toX, toY, xs, zeroY };
  }, [buckets, spotUsd]);

  const visibleStrikeLabels = useMemo(() => {
    const visible = new Set<number>();
    if (chart == null) return visible;
    const minLabelGap = 52;
    const activeIndex = buckets.findIndex((bucket) => bucket.strike === activeStrike);
    const activeX = activeIndex >= 0 ? chart.xs[activeIndex]! : null;
    let lastX = -Infinity;
    buckets.forEach((bucket, index) => {
      const x = chart.xs[index]!;
      if (index === activeIndex) {
        visible.add(bucket.strike);
        return;
      }
      if (activeX != null && Math.abs(x - activeX) < minLabelGap) return;
      if (x - lastX < minLabelGap) return;
      visible.add(bucket.strike);
      lastX = x;
    });
    return visible;
  }, [activeStrike, buckets, chart]);
  const yTickDigits = chart == null ? 2 : usdDigits(chart.maxAbs);

  const profileLegs = useMemo(
    () => buildProfileLegs(positions, displayBreakEven, activeExpiry),
    [activeExpiry, displayBreakEven, positions],
  );
  const mixedUnderlyings =
    new Set(
      positions.filter((leg) => leg.expiry === activeExpiry).map((leg) => leg.underlying),
    ).size > 1;
  const curveUnavailableReason =
    spotUsd == null || !(spotUsd > 0)
      ? 'Live spot is missing, so the curve cannot be drawn.'
      : mixedUnderlyings
        ? 'Select one underlying to draw its curve.'
        : profileLegs.legs.length === 0
          ? 'No leg in this expiry has a live IV to reprice with.'
          : null;
  const activeView: ChartView = curveUnavailableReason == null ? view : 'strikes';

  const profile = useMemo(() => {
    if (curveUnavailableReason != null || spotUsd == null) return null;
    const nowMs = Date.now();
    if (mode === 'volga') {
      const shock = buildVolShockProfile(profileLegs.legs, spotUsd, nowMs);
      const lines: ProfileLine[] = [
        { label: 'Full reprice', values: shock.fullPnlUsd, emphasis: 1 },
        { label: 'Vega only', values: shock.vegaOnlyPnlUsd, emphasis: 0.5, dashed: true },
      ];
      return { xs: shock.shiftsVolPts, lines };
    }
    const spot = buildSpotProfile(profileLegs.legs, mode, spotUsd, nowMs);
    const lines: ProfileLine[] = spot.series.map((series, index) => ({
      label: series.label,
      values: series.values,
      emphasis: index === 0 ? 1 : index === 1 ? 0.55 : 0.32,
      dashed: index > 0,
    }));
    return { xs: spot.prices, lines };
  }, [curveUnavailableReason, mode, profileLegs, spotUsd]);

  const activeBreakEvenRows = useMemo(() => {
    if (activeExpiry == null || activeStrike == null) return [];
    return displayBreakEven
      .filter((row) => row.expiry === activeExpiry && row.strike === activeStrike)
      .sort((left, right) => left.optionRight.localeCompare(right.optionRight));
  }, [activeExpiry, activeStrike, displayBreakEven]);

  return (
    <section className={styles.wrap} style={{ '--risk-color': COLORS[mode] } as CSSProperties}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.kicker}>Options → perp translator</span>
          <h3 className={styles.title}>Where does my risk live?</h3>
          <span className={styles.subtitle}>{meta.question}</span>
        </div>
        <div className={styles.controls}>
          <div className={styles.toggles} aria-label="Risk lens">
            {MODES.map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={styles.toggle}
                aria-pressed={mode === nextMode}
                onClick={() => setMode(nextMode)}
              >
                <span>{MODE_META[nextMode].tab}</span>
                <small>{MODE_META[nextMode].greek}</small>
              </button>
            ))}
          </div>
          {expiries.length > 0 && (
            <select
              value={activeExpiry ?? ''}
              onChange={(event) => setExpiry(event.target.value)}
              className={styles.select}
              aria-label="Expiry"
            >
              {expiries.map((exp) => (
                <option key={exp} value={exp}>
                  {exp}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className={styles.empty}>
          <strong>No strike risk to translate yet</strong>
          <span>
            Add an option position or wait for live marks. This panel will convert its Greeks into
            scenario P&amp;L and hedge actions.
          </span>
        </div>
      ) : (
        <>
          <div className={styles.readout}>
            <div
              className={styles.readoutPrimary}
              data-sign={totalRaw >= 0 ? 'positive' : 'negative'}
            >
              <span className={styles.readoutLabel}>{posture(mode, totalRaw)}</span>
              <strong>{rawDisplay(mode, totalRaw, asset, spotUsd)}</strong>
              <small>
                Raw {meta.greek} across {activeExpiry}
              </small>
            </div>
            <div className={styles.readoutCell}>
              <span className={styles.readoutLabel}>
                {spotUsd == null && (mode === 'delta' || mode === 'gamma')
                  ? 'Raw exposure · live spot missing'
                  : `If ${meta.scenario.toLowerCase()}`}
              </span>
              <strong data-sign={totalScenario >= 0 ? 'positive' : 'negative'}>
                {scenarioDisplay(mode, totalScenario, asset, spotUsd)}
              </strong>
              <small>Greek estimate, holding other inputs fixed</small>
            </div>
            <div className={styles.readoutCell}>
              <span className={styles.readoutLabel}>{actionLabel(mode)}</span>
              <strong className={styles.action}>{actionText(mode, totalRaw, asset)}</strong>
              <small>
                {mode === 'delta'
                  ? 'Equivalent opposite delta, before fees and slippage'
                  : mode === 'theta'
                    ? 'Decay accelerates into expiry; this is today’s rate'
                    : 'Use the scenario grid above for combined shocks'}
              </small>
            </div>
          </div>

          <div className={styles.lesson}>
            <span className={styles.lessonGreek}>{meta.greek}</span>
            <span>{meta.lesson}</span>
            {spotUsd == null && (mode === 'delta' || mode === 'gamma') && (
              <span className={styles.warning}>
                Live spot missing, so the chart is showing the raw Greek.
              </span>
            )}
            {isStale && (
              <span className={styles.warning}>Marks stale—showing the last usable snapshot.</span>
            )}
          </div>

          <div className={styles.chartHeader}>
            {activeView === 'curve' ? (
              <div>
                <span className={styles.chartTitle}>
                  {mode === 'volga' ? 'P&L across IV shocks' : 'Risk profile across spot'}
                </span>
                <span className={styles.chartAxis}>{meta.profileAxis}</span>
                <span className={styles.chartAxis}>
                  Black-76, each leg keeps its live IV (sticky strike)
                  {profileLegs.excluded > 0 &&
                    ` · ${profileLegs.excluded} leg${profileLegs.excluded === 1 ? '' : 's'} without IV left out`}
                </span>
              </div>
            ) : (
              <div>
                <span className={styles.chartTitle}>Risk concentration by strike</span>
                <span className={styles.chartAxis}>
                  Bars show{' '}
                  {spotUsd == null && (mode === 'delta' || mode === 'gamma')
                    ? `raw ${meta.greek}`
                    : meta.axis}
                </span>
              </div>
            )}
            <div className={styles.chartControls}>
              <div className={styles.legend}>
                {activeView === 'curve' && profile != null ? (
                  profile.lines.map((line) => (
                    <span key={line.label}>
                      <i
                        className={styles.lineSwatch}
                        data-dashed={line.dashed || undefined}
                        style={{ opacity: line.emphasis }}
                      />
                      {line.label}
                    </span>
                  ))
                ) : (
                  <>
                    <span>
                      <i className={styles.gainSwatch} />
                      gains
                    </span>
                    <span>
                      <i className={styles.lossSwatch} />
                      loses
                    </span>
                  </>
                )}
              </div>
              <div className={styles.viewToggle} aria-label="Chart view">
                <button
                  type="button"
                  aria-pressed={activeView === 'curve'}
                  disabled={curveUnavailableReason != null}
                  title={curveUnavailableReason ?? undefined}
                  onClick={() => setView('curve')}
                >
                  Curve
                </button>
                <button
                  type="button"
                  aria-pressed={activeView === 'strikes'}
                  onClick={() => setView('strikes')}
                >
                  By strike
                </button>
              </div>
            </div>
          </div>

          <div
            className={styles.chartWrap}
            data-single={(activeView === 'strikes' && buckets.length === 1) || undefined}
          >
            {activeView === 'curve' && profile != null && (
              <GreekProfileChart
                xs={profile.xs}
                lines={profile.lines}
                color={COLORS[mode]}
                lossColor={LOSS_COLOR}
                anchorX={mode === 'volga' ? 0 : spotUsd}
                anchorLabel={
                  mode === 'volga' || spotUsd == null
                    ? 'CURRENT IV'
                    : `SPOT ${fmtStrike(Math.round(spotUsd))}`
                }
                markers={
                  mode === 'volga'
                    ? []
                    : buckets.map((bucket) => ({
                        strike: bucket.strike,
                        positive: bucket.scenarioValue >= 0,
                      }))
                }
                activeStrike={activeStrike}
                onSelectStrike={setSelectedStrike}
                formatX={mode === 'volga' ? fmtVolShift : (value) => fmtStrike(Math.round(value))}
                formatTick={(value, step) => profileTick(mode, value, step)}
                formatValue={(value) => profileValue(mode, value, asset)}
                stale={isStale}
              />
            )}
            {activeView === 'strikes' && chart != null && (
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className={`${styles.svg} ${isStale ? styles.svgStale : ''}`}
              >
                <rect
                  x={PADDING.left}
                  y={PADDING.top}
                  width={WIDTH - PADDING.left - PADDING.right}
                  height={chart.zeroY - PADDING.top}
                  fill="rgba(80, 210, 193, 0.025)"
                />
                <rect
                  x={PADDING.left}
                  y={chart.zeroY}
                  width={WIDTH - PADDING.left - PADDING.right}
                  height={HEIGHT - PADDING.bottom - chart.zeroY}
                  fill="rgba(239, 97, 119, 0.025)"
                />
                {[chart.maxAbs, 0, -chart.maxAbs].map((tick) => {
                  const y = chart.toY(tick);
                  return (
                    <g key={tick}>
                      <line
                        x1={PADDING.left}
                        x2={WIDTH - PADDING.right}
                        y1={y}
                        y2={y}
                        stroke={tick === 0 ? '#44504d' : '#1b2321'}
                        strokeWidth={1}
                        strokeDasharray={tick === 0 ? '4 4' : undefined}
                      />
                      <text
                        x={PADDING.left - 9}
                        y={y + 3}
                        textAnchor="end"
                        fontSize={10}
                        fill="#74807d"
                      >
                        {mode === 'vanna' ||
                        (spotUsd == null && (mode === 'delta' || mode === 'gamma'))
                          ? scenarioDisplay(mode, tick, asset, spotUsd)
                          : fmtAxisUsd(tick, yTickDigits)}
                      </text>
                    </g>
                  );
                })}
                {chart.spot != null && (
                  <g pointerEvents="none">
                    <line
                      x1={chart.toX(chart.spot)}
                      x2={chart.toX(chart.spot)}
                      y1={PADDING.top - 6}
                      y2={HEIGHT - PADDING.bottom}
                      stroke="#9aa8a4"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                    <text
                      x={chart.toX(chart.spot)}
                      y={PADDING.top - 10}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#9aa8a4"
                    >
                      SPOT {fmtStrike(Math.round(chart.spot))}
                    </text>
                  </g>
                )}
                {buckets.map((bucket, index) => {
                  const x = chart.xs[index]!;
                  const edges = chart.hitEdges[index]!;
                  const valueY = chart.toY(bucket.scenarioValue);
                  const y = Math.min(valueY, chart.zeroY);
                  const height = Math.max(2, Math.abs(chart.zeroY - valueY));
                  const selected = activeStrike === bucket.strike;
                  const highlightWidth = chart.barWidth + 10;
                  return (
                    <g
                      key={bucket.strike}
                      className={styles.barGroup}
                      onMouseEnter={() => setSelectedStrike(bucket.strike)}
                      onClick={() => setSelectedStrike(bucket.strike)}
                    >
                      <title>{`Strike ${fmtStrike(bucket.strike)} · ${scenarioDisplay(mode, bucket.scenarioValue, asset, spotUsd)}`}</title>
                      <rect
                        x={edges.left}
                        y={PADDING.top}
                        width={Math.max(0, edges.right - edges.left)}
                        height={HEIGHT - PADDING.top - PADDING.bottom}
                        fill="transparent"
                      />
                      {selected && (
                        <rect
                          x={x - highlightWidth / 2}
                          y={PADDING.top}
                          width={highlightWidth}
                          height={HEIGHT - PADDING.top - PADDING.bottom}
                          rx={3}
                          fill="rgba(255, 255, 255, 0.04)"
                        />
                      )}
                      <rect
                        x={x - chart.barWidth / 2}
                        y={y}
                        width={chart.barWidth}
                        height={height}
                        rx={2}
                        fill={bucket.scenarioValue >= 0 ? COLORS[mode] : LOSS_COLOR}
                        opacity={selected ? 1 : 0.68}
                        stroke={selected ? '#eef5f3' : 'none'}
                        strokeWidth={selected ? 1 : 0}
                      />
                      <line
                        x1={x}
                        x2={x}
                        y1={HEIGHT - PADDING.bottom}
                        y2={HEIGHT - PADDING.bottom + 4}
                        stroke="#44504d"
                      />
                      {visibleStrikeLabels.has(bucket.strike) && (
                        <text
                          x={x}
                          y={HEIGHT - PADDING.bottom + 18}
                          textAnchor="middle"
                          fontSize={10}
                          fill={selected ? '#dbe5e2' : '#74807d'}
                        >
                          {fmtStrike(bucket.strike)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
            {activeView === 'strikes' && buckets.length === 1 && (
              <span className={styles.singleNote}>
                One strike only—showing its exposure as a bucket; there is no curve to infer yet.
              </span>
            )}
          </div>

          {activeBucket != null && (
            <div className={styles.inspector}>
              <div className={styles.inspectorSummary}>
                <span className={styles.inspectorEyebrow}>Selected risk bucket</span>
                <strong>{fmtStrike(activeBucket.strike)} strike</strong>
                <span>
                  {scenarioDisplay(mode, activeBucket.scenarioValue, asset, spotUsd)}{' '}
                  {mode === 'theta'
                    ? 'over the next 24 hours'
                    : `under ${meta.scenario.toLowerCase()}`}
                </span>
              </div>
              <div className={styles.inspectorStat}>
                <span>Share of gross risk</span>
                <strong>{concentration.toFixed(0)}%</strong>
              </div>
              <div className={styles.inspectorStat}>
                <span>Raw {meta.greek}</span>
                <strong>{rawDisplay(mode, activeBucket.rawValue, asset, spotUsd)}</strong>
              </div>
              <div className={styles.inspectorStat}>
                <span>Open contracts</span>
                <strong>{fmtNumber(activeBucket.contracts, 2)}</strong>
              </div>
            </div>
          )}

          {activeStrike != null && (
            <div className={styles.breakEvenRow}>
              <span className={styles.breakEvenLabel}>
                IV checkpoints at {fmtStrike(activeStrike)}
              </span>
              {activeBreakEvenRows.length === 0 ? (
                <span className={styles.breakEvenEmpty}>
                  No entry/live IV comparison for this strike.
                </span>
              ) : (
                activeBreakEvenRows.map((row) => (
                  <span key={row.legId} className={styles.breakEvenChip}>
                    <strong>{row.optionRight === 'call' ? 'CALL' : 'PUT'}</strong>
                    <span>live {fmtIv(row.currentIv)}</span>
                    <span>entry BE {fmtIv(row.breakEvenIv)}</span>
                    <span data-sign={(row.ivCushionPct ?? 0) >= 0 ? 'positive' : 'negative'}>
                      cushion {fmtPct(row.ivCushionPct)}
                    </span>
                  </span>
                ))
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
