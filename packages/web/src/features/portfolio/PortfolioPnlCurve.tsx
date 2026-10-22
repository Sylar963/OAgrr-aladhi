import { useEffect, useId, useMemo, useState, type PointerEvent } from 'react';

import type {
  EquityHistoryVenue,
  PortfolioPnlCurve as PortfolioPnlCurveData,
  VenueMarginResponse,
} from '@oggregator/protocol';
import { formatExpiry } from '@lib/format';
import { defineMessages, useT, type Translate } from '@lib/i18n';

import BreakevenTaChart, { TA_UNDERLYINGS, type TaUnderlying } from './BreakevenTaChart';
import EquityHistoryChart from './EquityHistoryChart';
import { marginCallPnl, marginCallPrices } from './margin-call';
import styles from './PortfolioPnlCurve.module.css';

interface Props {
  curve: PortfolioPnlCurveData;
  forwardDays: number;
  mixedExpiries?: boolean;
  onOpenBuilder?: () => void;
  builderDisabledReason?: string | undefined;
  equityVenue?: EquityHistoryVenue | null;
  margin?: VenueMarginResponse | null;
}

const WIDTH = 720;
const HEIGHT = 280;
const PADDING = { top: 34, right: 16, bottom: 44, left: 64 };
const TOOLTIP_WIDTH = 150;
const MARGIN_CALL_COLOR = '#fb923c';
const MODE_STORAGE_KEY = 'portfolioPnlCurveMode';
type CurveMode = 'payoff' | 'ta' | 'equity';

const messages = defineMessages(
  {
    lossMixedExpiry: 'expiry-window low',
    lossSamePrice: 'same-price scenario low',
    lossExpiry: 'expiry curve low',
    emptyNone: 'Add positions to see the payoff curve.',
    emptyMixed: 'The payoff curve needs a single underlying book.',
    emptyMarks: 'Live marks are missing for one or more legs, so the curve is unavailable.',
    emptyFallback: 'No P/L curve available.',
    title: 'Portfolio P&L curve',
    subtitleTa: 'x-axis: time • y-axis: underlying price with structure break-evens',
    subtitleEquity: 'x-axis: time • y-axis: venue account equity (USD)',
    subtitlePayoff: 'x-axis: underlying price • y-axis: portfolio P&L',
    curveView: 'Curve view',
    payoff: 'Payoff',
    taV2: 'TA V2',
    equity: 'Equity',
    now: 'Now',
    expiry: 'Expiry',
    openBuilder: 'Open in Builder V2 →',
    builderHint:
      'Explore price paths using your entry prices. Replaces current Builder legs; excludes realized P&L and fees.',
    underlying: 'underlying {v}',
    spot: 'spot {v}',
    maxGain: 'max gain {v}',
    upsideUnbounded: 'Upside unbounded after {date}',
    imTitle: 'Thalex account-wide initial margin requirement',
    freeMarginTitle: 'Thalex account margin minus initial margin',
    freeMargin: 'free margin {v}',
    imBreachTitle: 'Now-curve prices where account margin reaches IM, holding IM fixed',
    imBreach: 'IM breach',
    noneInRange: 'none in range',
    stale: 'stale · waiting for live marks',
    mixedExpiries:
      'Multiple expiries: the expiry curve assumes the same settlement price at every date. Its low point is not a portfolio-wide maximum-loss or margin guarantee. Review each expiry separately.',
    imBreachLine: 'IM breach ≈ {v}',
    hint: 'Hover to read P&L at any price. Break-even markers are based on the expiry curve; shading shows expiry gain and loss.',
    hintMargin:
      " IM is Thalex's account-wide initial margin, covering every underlying. The IM breach line holds IM fixed as price moves, so treat it as approximate.",
    freeMarginRow: 'Free margin',
  },
  {
    lossMixedExpiry: 'mínimo de la ventana de vencimientos',
    lossSamePrice: 'mínimo del escenario a mismo precio',
    lossExpiry: 'mínimo de la curva al vencimiento',
    emptyNone: 'Agrega posiciones para ver la curva de payoff.',
    emptyMixed: 'La curva de payoff necesita un libro de un solo subyacente.',
    emptyMarks: 'Faltan marks en vivo para uno o más legs, así que la curva no está disponible.',
    emptyFallback: 'No hay curva de P/L disponible.',
    title: 'Curva de P&L del portafolio',
    subtitleTa: 'eje x: tiempo • eje y: precio del subyacente con breakevens de la estructura',
    subtitleEquity: 'eje x: tiempo • eje y: equity de la cuenta del exchange (USD)',
    subtitlePayoff: 'eje x: precio del subyacente • eje y: P&L del portafolio',
    curveView: 'Vista de la curva',
    payoff: 'Payoff',
    taV2: 'TA V2',
    equity: 'Equity',
    now: 'Ahora',
    expiry: 'Vencimiento',
    openBuilder: 'Abrir en Builder V2 →',
    builderHint:
      'Explora trayectorias de precio con tus precios de entrada. Reemplaza los legs actuales del Builder; excluye P&L realizado y comisiones.',
    underlying: 'subyacente {v}',
    spot: 'spot {v}',
    maxGain: 'ganancia máx. {v}',
    upsideUnbounded: 'Alza ilimitada después de {date}',
    imTitle: 'Requerimiento de margen inicial de toda la cuenta de Thalex',
    freeMarginTitle: 'Margen de la cuenta de Thalex menos el margen inicial',
    freeMargin: 'margen libre {v}',
    imBreachTitle:
      'Precios de la curva actual donde el margen de la cuenta llega al IM, manteniendo el IM fijo',
    imBreach: 'Ruptura de IM',
    noneInRange: 'ninguna en el rango',
    stale: 'desactualizado · esperando marks en vivo',
    mixedExpiries:
      'Varios vencimientos: la curva al vencimiento asume el mismo precio de liquidación en cada fecha. Su punto mínimo no es una garantía de pérdida máxima ni de margen para todo el portafolio. Revisa cada vencimiento por separado.',
    imBreachLine: 'Ruptura de IM ≈ {v}',
    hint: 'Pasa el cursor para leer el P&L a cualquier precio. Los marcadores de breakeven se basan en la curva al vencimiento; el sombreado muestra ganancia y pérdida al vencimiento.',
    hintMargin:
      ' El IM es el margen inicial de toda la cuenta de Thalex, que cubre todos los subyacentes. La línea de ruptura de IM mantiene el IM fijo mientras se mueve el precio, así que tómala como aproximada.',
    freeMarginRow: 'Margen libre',
  },
);

type T = Translate<typeof messages.en>;

function loadMode(): CurveMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'ta' || stored === 'equity') return stored;
  } catch {}
  return 'payoff';
}

function isTaUnderlying(value: string | null): value is TaUnderlying {
  return value != null && (TA_UNDERLYINGS as readonly string[]).includes(value);
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '$0';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}$${Math.abs(rounded).toLocaleString()}`;
}

function fmtMoney(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString()}`;
}

function fmtPct(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(digits)}%`;
}

function niceStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function ticksWithin(min: number, max: number, step: number): number[] {
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
  }
  return ticks;
}

function nearestPoint(
  points: PortfolioPnlCurveData['points'],
  price: number,
): PortfolioPnlCurveData['points'][number] | null {
  let best: PortfolioPnlCurveData['points'][number] | null = null;
  for (const point of points) {
    if (best == null || Math.abs(point.underlyingPriceUsd - price) < Math.abs(best.underlyingPriceUsd - price)) {
      best = point;
    }
  }
  return best;
}

function labelAnchor(x: number): 'start' | 'middle' | 'end' {
  if (x < PADDING.left + 40) return 'start';
  if (x > WIDTH - PADDING.right - 40) return 'end';
  return 'middle';
}

function linePath(
  points: PortfolioPnlCurveData['points'],
  toX: (value: number) => number,
  toY: (value: number) => number,
  pickY: (point: PortfolioPnlCurveData['points'][number]) => number | null,
): string {
  const commands: string[] = [];
  for (const point of points) {
    const y = pickY(point);
    if (y == null || !Number.isFinite(y)) continue;
    commands.push(`${commands.length === 0 ? 'M' : 'L'} ${toX(point.underlyingPriceUsd)} ${toY(y)}`);
  }
  return commands.join(' ');
}

function emptyMessage(status: PortfolioPnlCurveData['status'], t: T): string {
  if (status === 'empty') return t('emptyNone');
  if (status === 'mixed_underlyings') return t('emptyMixed');
  if (status === 'missing_marks') return t('emptyMarks');
  return t('emptyFallback');
}

export default function PortfolioPnlCurve({ curve, forwardDays, mixedExpiries = false, onOpenBuilder, builderDisabledReason, equityVenue = null, margin = null }: Props) {
  const t = useT(messages);
  const [stickyCurve, setStickyCurve] = useState<PortfolioPnlCurveData | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const [storedMode, setMode] = useState<CurveMode>(loadMode);
  const mode: CurveMode = storedMode === 'equity' && equityVenue == null ? 'payoff' : storedMode;
  const [taUnderlying, setTaUnderlying] = useState<TaUnderlying | null>(null);
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useEffect(() => {
    if (curve.status === 'ok' && curve.points.length > 0) {
      setStickyCurve(curve);
    } else if (curve.status === 'empty' || curve.status === 'mixed_underlyings') {
      setStickyCurve(null);
    } else if (stickyCurve != null && stickyCurve.underlying !== curve.underlying) {
      setStickyCurve(null);
    }
  }, [curve, stickyCurve]);

  const displayCurve =
    curve.status === 'ok' && curve.points.length > 0
      ? curve
      : stickyCurve != null && stickyCurve.underlying === curve.underlying
        ? stickyCurve
        : curve;
  const isStale = displayCurve !== curve;
  const firstUnboundedIndex = displayCurve.riskWindows.findIndex((window) => window.upsideUnbounded);
  const upsideUnboundedAfter =
    firstUnboundedIndex > 0 ? (displayCurve.riskWindows[firstUnboundedIndex]?.from ?? null) : null;
  const lossLabel =
    displayCurve.expiryBasis === 'mixed_expiry'
      ? t('lossMixedExpiry')
      : mixedExpiries
        ? t('lossSamePrice')
        : t('lossExpiry');

  const marginCall = useMemo(() => {
    const spotUsd = displayCurve.currentSpotUsd;
    if (margin == null || spotUsd == null || displayCurve.status !== 'ok') return null;
    const level = marginCallPnl(displayCurve.points, spotUsd, margin.remainingMarginUsd);
    if (level == null) return null;
    return { level, ...marginCallPrices(displayCurve.points, spotUsd, level) };
  }, [displayCurve, margin]);

  const chart = useMemo(() => {
    if (displayCurve.status !== 'ok' || displayCurve.points.length === 0) return null;
    const xMin = displayCurve.points[0]?.underlyingPriceUsd ?? 0;
    const xMax = displayCurve.points[displayCurve.points.length - 1]?.underlyingPriceUsd ?? 1;
    const values = displayCurve.points.flatMap((point) => [
      point.nowPnlUsd,
      point.expiryPnlUsd,
      point.forwardPnlUsd ?? point.nowPnlUsd,
      0,
    ]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const yPadding = Math.max(25, (maxValue - minValue) * 0.06);
    const yStep = niceStep(maxValue - minValue + yPadding * 2, 4);
    const yMin = Math.floor((minValue - yPadding) / yStep) * yStep;
    const yMax = Math.ceil((maxValue + yPadding) / yStep) * yStep;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const toX = (value: number) => PADDING.left + ((value - xMin) / xSpan) * innerW;
    const toY = (value: number) => PADDING.top + (1 - (value - yMin) / ySpan) * innerH;
    const expiryPath = linePath(displayCurve.points, toX, toY, (point) => point.expiryPnlUsd);
    const zeroY = toY(0);

    return {
      toX,
      toY,
      yMin,
      yMax,
      fromX: (svgX: number) => xMin + ((svgX - PADDING.left) / innerW) * xSpan,
      zeroY,
      xTicks: ticksWithin(xMin, xMax, niceStep(xSpan, 6)),
      yTicks: ticksWithin(yMin, yMax, yStep),
      nowPath: linePath(displayCurve.points, toX, toY, (point) => point.nowPnlUsd),
      expiryPath,
      expiryAreaPath: `${expiryPath} L ${toX(xMax)} ${zeroY} L ${toX(xMin)} ${zeroY} Z`,
      forwardPath:
        forwardDays > 0
          ? linePath(displayCurve.points, toX, toY, (point) => point.forwardPnlUsd)
          : '',
    };
  }, [displayCurve, forwardDays]);

  const spot = displayCurve.currentSpotUsd;
  const hovered = chart != null && hoverPrice != null ? nearestPoint(displayCurve.points, hoverPrice) : null;

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (chart == null) return;
    const matrix = event.currentTarget.getScreenCTM?.();
    if (matrix == null) return;
    const inverse = matrix.inverse();
    const svgX = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e;
    if (svgX < PADDING.left || svgX > WIDTH - PADDING.right) {
      setHoverPrice(null);
      return;
    }
    setHoverPrice(chart.fromX(svgX));
  };

  const selectMode = (next: CurveMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {}
  };

  const header = (
    <div className={styles.header}>
      <div className={styles.titleBlock}>
        <span className={styles.title}>{t('title')}</span>
        <span className={styles.subtitle}>
          {mode === 'ta'
            ? t('subtitleTa')
            : mode === 'equity'
              ? t('subtitleEquity')
              : t('subtitlePayoff')}
        </span>
      </div>
      <div className={styles.headerRight}>
        <div className={styles.modeToggle} role="radiogroup" aria-label={t('curveView')}>
          <button type="button" role="radio" aria-checked={mode === 'payoff'} className={styles.modeButton} data-active={mode === 'payoff' || undefined} onClick={() => selectMode('payoff')}>
            {t('payoff')}
          </button>
          <button type="button" role="radio" aria-checked={mode === 'ta'} className={styles.modeButton} data-active={mode === 'ta' || undefined} onClick={() => selectMode('ta')}>
            {t('taV2')}
          </button>
          {equityVenue != null && (
            <button type="button" role="radio" aria-checked={mode === 'equity'} className={styles.modeButton} data-active={mode === 'equity' || undefined} onClick={() => selectMode('equity')}>
              {t('equity')}
            </button>
          )}
        </div>
        {mode === 'payoff' && (
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={styles.nowSwatch} />{t('now')}</span>
            {forwardDays > 0 && <span className={styles.legendItem}><span className={styles.forwardSwatch} />T+{forwardDays}d</span>}
            <span className={styles.legendItem}><span className={styles.expirySwatch} />{t('expiry')}</span>
          </div>
        )}
      </div>
    </div>
  );

  if (mode === 'equity' && equityVenue != null) {
    return (
      <div className={styles.wrap}>
        {header}
        <EquityHistoryChart venue={equityVenue} />
      </div>
    );
  }

  if (mode === 'ta') {
    return (
      <div className={styles.wrap}>
        {header}
        <BreakevenTaChart
          underlying={taUnderlying ?? (isTaUnderlying(displayCurve.underlying) ? displayCurve.underlying : 'BTC')}
          onUnderlyingChange={setTaUnderlying}
          portfolioUnderlying={displayCurve.underlying}
          portfolioBreakEvensUsd={displayCurve.breakEvenPricesUsd}
        />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {header}

      {onOpenBuilder && (
        <div className={styles.builderRow}>
          <button
            type="button"
            className={styles.builderButton}
            onClick={onOpenBuilder}
            disabled={builderDisabledReason != null}
            aria-describedby="portfolio-builder-hint"
          >
            {t('openBuilder')}
          </button>
          <span id="portfolio-builder-hint" className={styles.subtitle}>
            {builderDisabledReason ?? t('builderHint')}
          </span>
        </div>
      )}

      <div className={styles.metaRow}>
        <span className={styles.metricPill}>{t('underlying', { v: displayCurve.underlying ?? '—' })}</span>
        <span className={styles.metricPill}>{t('spot', { v: fmtPrice(displayCurve.currentSpotUsd) })}</span>
        <span className={styles.metricPill}>
          BE {displayCurve.breakEvenPricesUsd.length === 0 ? '—' : displayCurve.breakEvenPricesUsd.map((value) => fmtPrice(value)).join(' / ')}
        </span>
        {displayCurve.maxProfitUsd != null && <span className={styles.metricPill}>{t('maxGain', { v: fmtUsd(displayCurve.maxProfitUsd) })}</span>}
        {upsideUnboundedAfter != null ? (
          <span className={styles.metricPill}>{t('upsideUnbounded', { date: formatExpiry(upsideUnboundedAfter) })}</span>
        ) : (
          displayCurve.maxLossUsd != null && <span className={styles.metricPill}>{lossLabel} {fmtUsd(displayCurve.maxLossUsd)}</span>
        )}
        {margin != null && (
          <>
            <span className={styles.metricPill} title={t('imTitle')}>
              IM {fmtMoney(margin.initialMarginUsd)}
            </span>
            <span
              className={margin.remainingMarginUsd > 0 ? styles.metricPill : styles.stalePill}
              title={t('freeMarginTitle')}
            >
              {t('freeMargin', { v: fmtMoney(margin.remainingMarginUsd) })}
            </span>
            {marginCall != null && margin.remainingMarginUsd > 0 && (
              <span className={styles.metricPill} title={t('imBreachTitle')}>
                {t('imBreach')}{' '}
                {marginCall.below == null && marginCall.above == null
                  ? t('noneInRange')
                  : `≈ ${[marginCall.below, marginCall.above].filter((value) => value != null).map((value) => fmtPrice(value)).join(' / ')}`}
              </span>
            )}
          </>
        )}
        {isStale && <span className={styles.stalePill}>{t('stale')}</span>}
      </div>

      <div className={styles.chartWrap}>
        {mixedExpiries && <p className={styles.subtitle}>{t('mixedExpiries')}</p>}
        {chart == null ? (
          <div className={styles.empty}>{emptyMessage(curve.status, t)}</div>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className={`${styles.svg} ${isStale ? styles.svgStale : ''}`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverPrice(null)}
          >
            <defs>
              <clipPath id={`${clipId}-gain`}>
                <rect x={0} y={0} width={WIDTH} height={chart.zeroY} />
              </clipPath>
              <clipPath id={`${clipId}-loss`}>
                <rect x={0} y={chart.zeroY} width={WIDTH} height={HEIGHT - chart.zeroY} />
              </clipPath>
            </defs>
            {chart.yTicks.map((value) => {
              const y = chart.toY(value);
              return (
                <g key={`y-${value}`}>
                  <line
                    x1={PADDING.left}
                    x2={WIDTH - PADDING.right}
                    y1={y}
                    y2={y}
                    stroke="#1a1f2b"
                    strokeWidth={1}
                  />
                  <text x={PADDING.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#7c8798">
                    {fmtUsd(value)}
                  </text>
                </g>
              );
            })}
            {chart.xTicks.map((value) => {
              const x = chart.toX(value);
              return (
                <g key={`x-${value}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#10151e"
                    strokeWidth={1}
                  />
                  <text x={x} y={HEIGHT - PADDING.bottom + 16} textAnchor="middle" fontSize={10} fill="#7c8798">
                    {fmtPrice(value)}
                  </text>
                  {spot != null && (
                    <text x={x} y={HEIGHT - PADDING.bottom + 30} textAnchor="middle" fontSize={9} fill="#4b5563">
                      {fmtPct((value / spot - 1) * 100, 0)}
                    </text>
                  )}
                </g>
              );
            })}
            <path d={chart.expiryAreaPath} fill="rgba(74, 222, 128, 0.12)" clipPath={`url(#${clipId}-gain)`} />
            <path d={chart.expiryAreaPath} fill="rgba(248, 113, 113, 0.14)" clipPath={`url(#${clipId}-loss)`} />
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={chart.zeroY}
              y2={chart.zeroY}
              stroke="#475569"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {displayCurve.breakEvenPricesUsd.map((value) => {
              const x = chart.toX(value);
              return (
                <g key={`be-${value}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#fbbf24"
                    strokeWidth={1}
                    strokeDasharray="3 5"
                    opacity={0.95}
                  />
                  <text x={x} y={PADDING.top - 5} textAnchor={labelAnchor(x)} fontSize={9} fill="#fbbf24">
                    BE {fmtPrice(value)}
                  </text>
                </g>
              );
            })}
            {spot != null && (
              <g>
                <line
                  x1={chart.toX(spot)}
                  x2={chart.toX(spot)}
                  y1={PADDING.top}
                  y2={HEIGHT - PADDING.bottom}
                  stroke="#f8fafc"
                  strokeWidth={1}
                  strokeDasharray="6 4"
                />
                <text
                  x={chart.toX(spot)}
                  y={PADDING.top - 19}
                  textAnchor={labelAnchor(chart.toX(spot))}
                  fontSize={9}
                  fill="#f8fafc"
                >
                  {t('spot', { v: fmtPrice(spot) })}
                </text>
              </g>
            )}
            {marginCall != null && marginCall.level >= chart.yMin && marginCall.level <= chart.yMax && (
              <g data-testid="im-breach-line">
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={chart.toY(marginCall.level)}
                  y2={chart.toY(marginCall.level)}
                  stroke={MARGIN_CALL_COLOR}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
                <text
                  x={WIDTH - PADDING.right - 4}
                  y={chart.toY(marginCall.level) - 4}
                  textAnchor="end"
                  fontSize={9}
                  fill={MARGIN_CALL_COLOR}
                >
                  {t('imBreachLine', { v: fmtUsd(marginCall.level) })}
                </text>
              </g>
            )}
            {chart.forwardPath && (
              <path
                d={chart.forwardPath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2}
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <path
              d={chart.nowPath}
              fill="none"
              stroke="#a78bfa"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={chart.expiryPath}
              fill="none"
              stroke="#4ade80"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clipId}-gain)`}
            />
            <path
              d={chart.expiryPath}
              fill="none"
              stroke="#f87171"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clipId}-loss)`}
            />
            {hovered != null && (
              <HoverReadout
                point={hovered}
                spot={spot}
                forwardDays={forwardDays}
                marginCallLevel={marginCall?.level ?? null}
                toX={chart.toX}
                toY={chart.toY}
              />
            )}
          </svg>
        )}
      </div>

      <div className={styles.hint}>
        {t('hint')}
        {margin != null && t('hintMargin')}
      </div>
    </div>
  );
}

interface HoverReadoutProps {
  point: PortfolioPnlCurveData['points'][number];
  spot: number | null;
  forwardDays: number;
  marginCallLevel: number | null;
  toX: (value: number) => number;
  toY: (value: number) => number;
}

function HoverReadout({ point, spot, forwardDays, marginCallLevel, toX, toY }: HoverReadoutProps) {
  const t = useT(messages);
  const x = toX(point.underlyingPriceUsd);
  const rows: Array<{ label: string; value: number; color: string }> = [
    { label: t('now'), value: point.nowPnlUsd, color: '#a78bfa' },
  ];
  if (forwardDays > 0 && point.forwardPnlUsd != null) {
    rows.push({ label: `T+${forwardDays}d`, value: point.forwardPnlUsd, color: '#38bdf8' });
  }
  rows.push({ label: t('expiry'), value: point.expiryPnlUsd, color: point.expiryPnlUsd < 0 ? '#f87171' : '#4ade80' });
  const readoutRows: Array<{ label: string; value: string; color: string }> = rows.map((row) => ({
    label: row.label,
    value: fmtUsd(row.value),
    color: row.color,
  }));
  if (marginCallLevel != null) {
    readoutRows.push({
      label: t('freeMarginRow'),
      value: fmtMoney(point.nowPnlUsd - marginCallLevel),
      color: MARGIN_CALL_COLOR,
    });
  }

  const boxHeight = 24 + readoutRows.length * 14;
  const boxX = x + 10 + TOOLTIP_WIDTH > WIDTH - PADDING.right ? x - 10 - TOOLTIP_WIDTH : x + 10;
  const boxY = PADDING.top + 4;

  return (
    <g pointerEvents="none" data-testid="pnl-hover">
      <line x1={x} x2={x} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="#94a3b8" strokeWidth={1} opacity={0.6} />
      {rows.map((row) => (
        <circle key={row.label} cx={x} cy={toY(row.value)} r={3.5} fill={row.color} stroke="#0b0f17" strokeWidth={1.5} />
      ))}
      <rect
        x={boxX}
        y={boxY}
        width={TOOLTIP_WIDTH}
        height={boxHeight}
        rx={4}
        fill="rgba(11, 15, 23, 0.94)"
        stroke="#243041"
      />
      <text x={boxX + 8} y={boxY + 15} fontSize={10} fill="#f8fafc">
        {fmtPrice(point.underlyingPriceUsd)}
      </text>
      {spot != null && (
        <text x={boxX + TOOLTIP_WIDTH - 8} y={boxY + 15} fontSize={10} fill="#94a3b8" textAnchor="end">
          {fmtPct((point.underlyingPriceUsd / spot - 1) * 100, 1)}
        </text>
      )}
      {readoutRows.map((row, index) => (
        <g key={row.label}>
          <text x={boxX + 8} y={boxY + 31 + index * 14} fontSize={10} fill={row.color}>
            {row.label}
          </text>
          <text x={boxX + TOOLTIP_WIDTH - 8} y={boxY + 31 + index * 14} fontSize={10} fill="#e2e8f0" textAnchor="end">
            {row.value}
          </text>
        </g>
      ))}
    </g>
  );
}
