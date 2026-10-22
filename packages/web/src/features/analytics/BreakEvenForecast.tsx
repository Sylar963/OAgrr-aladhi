import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type Time,
} from 'lightweight-charts';

import type { BreakEvenLine, BreakEvenResponse } from '@oggregator/protocol';
import { useExpiries } from '@features/chain/queries';
import { formatExpiry } from '@lib/format';
import { defineMessages, useT, type Translate } from '@lib/i18n';
import {
  defaultExpiry,
  formatProb,
  historyWithLive,
  lineColors,
  lineKey,
  probGap,
  spotProjection,
  toChartPoints,
  withAlpha,
} from './break-even-chart';
import { useBreakEven } from './queries';
import analyticsStyles from './AnalyticsView.module.css';
import styles from './BreakEvenForecast.module.css';

const SPOT_COLOR = '#E8ECEB';
const SPOT_KEY = 'spot';
const SUPPORTED_UNDERLYINGS = new Set(['BTC', 'ETH']);
const DAY_MS = 86_400_000;

const messages = defineMessages(
  {
    title: 'Break-Even Forecast',
    unsupported: 'Built from Deribit marks, so it is available for BTC and ETH only.',
    subtitle:
      'Deribit marks · OTM, |Δ| < 0.55 · solid = recorded, dashed = projection with forward and IV held',
    expiry: 'Expiry',
    loading: 'Loading break-evens…',
    noMarks: 'No Deribit marks for this expiry right now.',
    strike: 'Strike',
    be: 'BE',
    nd2Title: 'Risk-neutral probability of finishing beyond the strike, from the mark IV',
    hist: 'Hist',
    histTitle: 'Historical frequency of finishing beyond the strike over the same horizon',
    gap: 'Gap',
    gapTitle: 'Hist minus N(d2), percentage points. Descriptive, not an edge.',
    spot: 'Spot',
    fwd: 'fwd',
    historyEmpty:
      'Break-even history is recorded hourly from Deribit marks and starts filling in from now. Until then the chart shows spot and the projection.',
    historySince: 'Break-evens rebuilt hourly from recorded Deribit mark IVs since {since} UTC.',
    historicalNote:
      'Hist = share of {windows} overlapping {horizon}-day {underlying} moves over the last {lookback} days (trend removed) that finished beyond the strike, about {independent} independent samples. A historical frequency, not a forecast.',
    nd2Note:
      'N(d2) comes from implied vol, which mostly extrapolates recent realized vol plus a risk premium. After quiet stretches it prices a narrow distribution, so far strikes can look remote right before a large move.',
  },
  {
    title: 'Pronóstico de breakeven',
    unsupported: 'Se construye con marks de Deribit, así que solo está disponible para BTC y ETH.',
    subtitle:
      'Marks de Deribit · OTM, |Δ| < 0.55 · sólida = registrada, punteada = proyección con forward e IV fijos',
    expiry: 'Vencimiento',
    loading: 'Cargando breakevens…',
    noMarks: 'No hay marks de Deribit para este vencimiento ahora.',
    strike: 'Strike',
    be: 'BE',
    nd2Title: 'Probabilidad neutral al riesgo de terminar más allá del strike, a partir de la IV mark',
    hist: 'Hist',
    histTitle: 'Frecuencia histórica de terminar más allá del strike en el mismo horizonte',
    gap: 'Brecha',
    gapTitle: 'Hist menos N(d2), en puntos porcentuales. Descriptivo, no es una ventaja.',
    spot: 'Spot',
    fwd: 'fwd',
    historyEmpty:
      'El historial de breakeven se registra cada hora con marks de Deribit y empieza a llenarse desde ahora. Mientras tanto, el gráfico muestra el spot y la proyección.',
    historySince:
      'Breakevens reconstruidos cada hora con IVs mark registradas de Deribit desde {since} UTC.',
    historicalNote:
      'Hist = proporción de {windows} movimientos superpuestos de {horizon} días de {underlying} en los últimos {lookback} días (sin tendencia) que terminaron más allá del strike, unas {independent} muestras independientes. Es una frecuencia histórica, no un pronóstico.',
    nd2Note:
      'N(d2) proviene de la vol implícita, que en gran parte extrapola la vol realizada reciente más una prima de riesgo. Tras periodos tranquilos valora una distribución estrecha, así que los strikes lejanos pueden parecer remotos justo antes de un gran movimiento.',
  },
);

type T = Translate<typeof messages.en>;

const fmtLevel = (value: number) => Math.round(value).toLocaleString('en-US');

interface SeriesPair {
  color: string;
  history: ISeriesApi<'Line', Time>;
  projection: ISeriesApi<'Line', Time>;
}

function fmtGap(gap: number | null): string {
  if (gap == null) return '–';
  const sign = gap > 0 ? '+' : '';
  return `${sign}${gap.toFixed(Math.abs(gap) < 10 ? 1 : 0)}`;
}

function lineLabel(line: BreakEvenLine): string {
  return `${line.right === 'call' ? 'C' : 'P'} ${fmtLevel(line.strike)}`;
}

function historyNote(data: BreakEvenResponse, t: T): string {
  if (data.recordedSince == null || data.asOf - data.recordedSince < 2 * 3_600_000) {
    return t('historyEmpty');
  }
  const since = new Date(data.recordedSince).toISOString().slice(0, 16).replace('T', ' ');
  return t('historySince', { since });
}

function historicalNote(data: BreakEvenResponse, t: T): string | null {
  const { horizonDays, windows, lookbackDays } = data.historical;
  if (windows === 0) return null;
  const independent = Math.max(1, Math.floor(windows / horizonDays));
  return t('historicalNote', {
    windows,
    horizon: horizonDays,
    underlying: data.underlying,
    lookback: lookbackDays,
    independent,
  });
}

interface BreakEvenForecastProps {
  underlying: string;
}

export default function BreakEvenForecast({ underlying }: BreakEvenForecastProps) {
  const t = useT(messages);
  const supported = SUPPORTED_UNDERLYINGS.has(underlying);
  const { data: expiriesData } = useExpiries(underlying);
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const expiries = useMemo(() => {
    const deribit = new Set(
      expiriesData?.byVenue.find((venue) => venue.venue === 'deribit')?.expiries ?? [],
    );
    const now = Date.now();
    return (expiriesData?.timestamps ?? []).filter((entry) => {
      const ts = entry.expiryTs ?? Date.parse(`${entry.expiry}T08:00:00Z`);
      return deribit.has(entry.expiry) && ts > now;
    });
  }, [expiriesData]);

  const expiry =
    picked != null && expiries.some((entry) => entry.expiry === picked)
      ? picked
      : defaultExpiry(expiries, Date.now());
  const { data, isError, isLoading } = useBreakEven(underlying, expiry, supported);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef(new Map<string, SeriesPair>());
  const fittedRef = useRef<string | null>(null);

  const colors = useMemo(
    () => (data ? lineColors(data.lines, data.forward) : new Map<string, string>()),
    [data],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#878C8F',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: fmtLevel },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
    });
    chartRef.current = chart;
    const series = seriesRef.current;
    return () => {
      chart.remove();
      chartRef.current = null;
      series.clear();
      fittedRef.current = null;
    };
  }, [supported]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const pair of seriesRef.current.values()) {
      chart.removeSeries(pair.history);
      chart.removeSeries(pair.projection);
    }
    seriesRef.current.clear();
    if (!data) return;

    const addPair = (key: string, color: string, width: 1 | 2) => {
      const history = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      const projection = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      seriesRef.current.set(key, { color, history, projection });
      return { history, projection };
    };

    const spot = addPair(SPOT_KEY, SPOT_COLOR, 2);
    spot.history.setData(toChartPoints(data.spotHistory) as never);
    spot.projection.setData(spotProjection(data.lines, data.spot, data.asOf) as never);

    for (const line of data.lines) {
      const key = lineKey(line);
      const pair = addPair(key, colors.get(key) ?? SPOT_COLOR, 2);
      pair.history.setData(historyWithLive(line) as never);
      pair.projection.setData(toChartPoints(line.projection) as never);
    }

    const fitKey = `${data.underlying}:${data.expiry}`;
    if (fittedRef.current !== fitKey) {
      chart.timeScale().fitContent();
      fittedRef.current = fitKey;
    }
  }, [data, colors]);

  useEffect(() => {
    for (const [key, pair] of seriesRef.current) {
      const active = hovered == null || hovered === key || key === SPOT_KEY;
      const color = active ? pair.color : withAlpha(pair.color, 0.15);
      const lineWidth = hovered === key ? 3 : 2;
      pair.history.applyOptions({ color, lineWidth });
      pair.projection.applyOptions({ color, lineWidth });
    }
  }, [hovered, data]);

  if (!supported) {
    return (
      <div className={analyticsStyles.card}>
        <div className={analyticsStyles.cardTitle}>{t('title')}</div>
        <div className={styles.empty}>{t('unsupported')}</div>
      </div>
    );
  }

  const calls = data?.lines.filter((line) => line.right === 'call') ?? [];
  const puts = data?.lines.filter((line) => line.right === 'put') ?? [];
  const dte = data ? Math.max(0, (data.expiryTs - data.asOf) / DAY_MS) : null;
  const histNote = data ? historicalNote(data, t) : null;

  const renderRow = (line: BreakEvenLine) => {
    const key = lineKey(line);
    const gap = probGap(line);
    return (
      <tr
        key={key}
        className={styles.row}
        data-active={hovered === key || undefined}
        onMouseEnter={() => setHovered(key)}
        onMouseLeave={() => setHovered(null)}
      >
        <td>
          <span className={styles.swatch} style={{ background: colors.get(key) }} />
          {lineLabel(line)}
        </td>
        <td>{fmtLevel(line.breakEven)}</td>
        <td>{formatProb(line.impliedProb)}</td>
        <td>{formatProb(line.historicalProb)}</td>
        <td className={styles.gap} data-sign={gap == null ? undefined : gap > 0 ? 'pos' : 'neg'}>
          {fmtGap(gap)}
        </td>
      </tr>
    );
  };

  return (
    <div className={analyticsStyles.card}>
      <div className={styles.header}>
        <div>
          <div className={analyticsStyles.cardTitle}>{t('title')}</div>
          <div className={styles.subtitle}>{t('subtitle')}</div>
        </div>
        <label className={styles.expiryPicker}>
          <span>{t('expiry')}</span>
          <select
            value={expiry ?? ''}
            onChange={(event) => setPicked(event.target.value)}
            disabled={expiries.length === 0}
          >
            {expiries.map((entry) => (
              <option key={entry.expiry} value={entry.expiry}>
                {formatExpiry(entry.expiry)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.body}>
        <div className={styles.chartArea}>
          <div className={styles.chart} ref={containerRef} />
          {isLoading && <div className={styles.overlay}>{t('loading')}</div>}
          {isError && !data && (
            <div className={styles.overlay}>{t('noMarks')}</div>
          )}
        </div>

        {data && (
          <div className={styles.side}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('strike')}</th>
                  <th>{t('be')}</th>
                  <th title={t('nd2Title')}>N(d2)</th>
                  <th title={t('histTitle')}>{t('hist')}</th>
                  <th title={t('gapTitle')}>{t('gap')}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(renderRow)}
                <tr className={styles.spotRow}>
                  <td>
                    <span className={styles.swatch} style={{ background: SPOT_COLOR }} />
                    {t('spot')}
                  </td>
                  <td>{fmtLevel(data.spot)}</td>
                  <td colSpan={3}>
                    {t('fwd')} {fmtLevel(data.forward)}
                    {dte != null && ` · ${dte < 1 ? `${Math.round(dte * 24)}h` : `${dte.toFixed(1)}d`}`}
                  </td>
                </tr>
                {puts.map(renderRow)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && (
        <div className={styles.notes}>
          <p>{historyNote(data, t)}</p>
          {histNote && <p>{histNote}</p>}
          <p>{t('nd2Note')}</p>
        </div>
      )}
    </div>
  );
}
