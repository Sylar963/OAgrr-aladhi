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

function historyNote(data: BreakEvenResponse): string {
  if (data.recordedSince == null || data.asOf - data.recordedSince < 2 * 3_600_000) {
    return 'Break-even history is recorded hourly from Deribit marks and starts filling in from now. Until then the chart shows spot and the projection.';
  }
  const since = new Date(data.recordedSince).toISOString().slice(0, 16).replace('T', ' ');
  return `Break-evens rebuilt hourly from recorded Deribit mark IVs since ${since} UTC.`;
}

function historicalNote(data: BreakEvenResponse): string | null {
  const { horizonDays, windows, lookbackDays } = data.historical;
  if (windows === 0) return null;
  const independent = Math.max(1, Math.floor(windows / horizonDays));
  return `Hist = share of ${windows} overlapping ${horizonDays}-day ${data.underlying} moves over the last ${lookbackDays} days (trend removed) that finished beyond the strike, about ${independent} independent samples. A historical frequency, not a forecast.`;
}

interface BreakEvenForecastProps {
  underlying: string;
}

export default function BreakEvenForecast({ underlying }: BreakEvenForecastProps) {
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
        <div className={analyticsStyles.cardTitle}>Break-Even Forecast</div>
        <div className={styles.empty}>
          Built from Deribit marks, so it is available for BTC and ETH only.
        </div>
      </div>
    );
  }

  const calls = data?.lines.filter((line) => line.right === 'call') ?? [];
  const puts = data?.lines.filter((line) => line.right === 'put') ?? [];
  const dte = data ? Math.max(0, (data.expiryTs - data.asOf) / DAY_MS) : null;
  const histNote = data ? historicalNote(data) : null;

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
          <div className={analyticsStyles.cardTitle}>Break-Even Forecast</div>
          <div className={styles.subtitle}>
            Deribit marks · OTM, |Δ| &lt; 0.55 · solid = recorded, dashed = projection with forward
            and IV held
          </div>
        </div>
        <label className={styles.expiryPicker}>
          <span>Expiry</span>
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
          {isLoading && <div className={styles.overlay}>Loading break-evens…</div>}
          {isError && !data && (
            <div className={styles.overlay}>No Deribit marks for this expiry right now.</div>
          )}
        </div>

        {data && (
          <div className={styles.side}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>BE</th>
                  <th title="Risk-neutral probability of finishing beyond the strike, from the mark IV">
                    N(d2)
                  </th>
                  <th title="Historical frequency of finishing beyond the strike over the same horizon">
                    Hist
                  </th>
                  <th title="Hist minus N(d2), percentage points. Descriptive, not an edge.">
                    Gap
                  </th>
                </tr>
              </thead>
              <tbody>
                {calls.map(renderRow)}
                <tr className={styles.spotRow}>
                  <td>
                    <span className={styles.swatch} style={{ background: SPOT_COLOR }} />
                    Spot
                  </td>
                  <td>{fmtLevel(data.spot)}</td>
                  <td colSpan={3}>
                    fwd {fmtLevel(data.forward)}
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
          <p>{historyNote(data)}</p>
          {histNote && <p>{histNote}</p>}
          <p>
            N(d2) comes from implied vol, which mostly extrapolates recent realized vol plus a risk
            premium. After quiet stretches it prices a narrow distribution, so far strikes can look
            remote right before a large move.
          </p>
        </div>
      )}
    </div>
  );
}
