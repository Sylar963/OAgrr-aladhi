import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  LineType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import {
  TIME_AT_PRICE_LOOKBACK_DAYS,
  TIME_AT_PRICE_UNDERLYINGS,
  type TimeAtPriceResponse,
} from '@oggregator/protocol';
import { useTimeAtPrice } from '../queries';
import analyticsStyles from '../AnalyticsView.module.css';
import cardStyles from '../BreakEvenForecast.module.css';
import { TimeAtPricePrimitive } from './TimeAtPricePrimitive';
import styles from './TimeAtPrice.module.css';

const PATH_COLOR = '#E8ECEB';
const DAY_MS = 86_400_000;
const SUPPORTED = new Set<string>(TIME_AT_PRICE_UNDERLYINGS);
const LOOKBACK_LABELS: Record<number, string> = { 90: '90D', 180: '180D', 365: '1Y', 730: '2Y' };

function fmtPrice(value: number): string {
  if (value >= 1000) return Math.round(value).toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtCompact(value: number): string {
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return Number(value.toFixed(2)).toString();
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function historyNote(data: TimeAtPriceResponse): string {
  const shade = `Shade = share of the ${data.bars.toLocaleString('en-US')} hourly bars from ${fmtDate(data.from)} to ${fmtDate(data.to)} whose high–low range crossed each ${fmtPrice(data.binSize)} level.`;
  const short = data.to - data.from < data.lookbackDays * DAY_MS * 0.95;
  return short ? `${shade} The venue serves less history than the selected lookback.` : shade;
}

interface TimeAtPriceProps {
  underlying: string;
}

export default function TimeAtPrice({ underlying }: TimeAtPriceProps) {
  const supported = SUPPORTED.has(underlying);
  const [lookbackDays, setLookbackDays] = useState<number>(730);
  const [hovered, setHovered] = useState<number | null>(null);
  const { data, isError, isLoading } = useTimeAtPrice(underlying, lookbackDays, supported);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const primitiveRef = useRef<TimeAtPricePrimitive | null>(null);

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
      grid: { vertLines: { color: '#161616' }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.02, bottom: 0.02 } },
      timeScale: { borderColor: '#1F2937', timeVisible: false },
      localization: { priceFormatter: fmtPrice },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
    });
    const series = chart.addSeries(LineSeries, {
      color: PATH_COLOR,
      lineWidth: 1,
      lineType: LineType.WithSteps,
      priceLineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
    });
    const primitive = new TimeAtPricePrimitive();
    series.attachPrimitive(primitive);
    chartRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
    };
  }, [supported]);

  useEffect(() => {
    const series = seriesRef.current;
    const primitive = primitiveRef.current;
    if (!series || !primitive) return;
    if (!data) {
      series.setData([]);
      primitive.setLevels([], 0);
      return;
    }
    series.setData(
      data.dailyCloses.map((point) => ({
        time: Math.floor(point.ts / 1000) as UTCTimestamp,
        value: point.close,
      })),
    );
    primitive.setLevels(data.levels, data.binSize);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    if (!data) return;
    primitiveRef.current?.setHighlight(
      hovered == null ? null : { from: hovered, to: hovered + data.volBinSize },
    );
  }, [hovered, data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const total = data.volByLevel.reduce((sum, bin) => sum + bin.bars, 0);
    const maxVol = data.volByLevel.reduce((max, bin) => Math.max(max, bin.vol), 0);
    return [...data.volByLevel].reverse().map((bin) => ({
      ...bin,
      share: total > 0 ? bin.bars / total : 0,
      barWidth: maxVol > 0 ? bin.vol / maxVol : 0,
      containsSpot: data.spot >= bin.price && data.spot < bin.price + data.volBinSize,
    }));
  }, [data]);

  if (!supported) {
    return (
      <div className={analyticsStyles.card}>
        <div className={analyticsStyles.cardTitle}>Time at Price</div>
        <div className={cardStyles.empty}>
          Built from perpetual candles, so it is available for BTC, ETH and HYPE only.
        </div>
      </div>
    );
  }

  return (
    <div className={analyticsStyles.card}>
      <div className={cardStyles.header}>
        <div>
          <div className={analyticsStyles.cardTitle}>Time at Price</div>
          <div className={cardStyles.subtitle}>
            {underlying}-PERPETUAL hourly bars · shade = hours traded through each level · line =
            daily close
          </div>
        </div>
        <label className={cardStyles.expiryPicker}>
          <span>Lookback</span>
          <select
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Number(event.target.value))}
          >
            {TIME_AT_PRICE_LOOKBACK_DAYS.map((days) => (
              <option key={days} value={days}>
                {LOOKBACK_LABELS[days] ?? `${days}D`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={cardStyles.body}>
        <div className={cardStyles.chartArea}>
          <div className={cardStyles.chart} ref={containerRef} />
          {isLoading && <div className={cardStyles.overlay}>Loading price history…</div>}
          {isError && !data && (
            <div className={cardStyles.overlay}>Price history is unavailable right now.</div>
          )}
        </div>

        {data && (
          <div className={cardStyles.side}>
            <table className={cardStyles.table}>
              <thead>
                <tr>
                  <th>Price</th>
                  <th
                    title={`Mean trailing ${data.volWindowHours / 24}-day Parkinson vol (annualized) of the hours spent in the bin`}
                  >
                    Vol {data.volWindowHours / 24}d
                  </th>
                  <th title="Share of hours whose mid sat in the bin">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.price}
                    className={
                      row.containsSpot ? `${cardStyles.row} ${styles.spotRow}` : cardStyles.row
                    }
                    data-active={hovered === row.price || undefined}
                    onMouseEnter={() => setHovered(row.price)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <td className={styles.priceCell}>
                      {fmtCompact(row.price)}–{fmtCompact(row.price + data.volBinSize)}
                    </td>
                    <td>
                      <span className={styles.volCell}>
                        <span className={styles.volTrack}>
                          <span
                            className={styles.volBar}
                            style={{ width: `${(row.barWidth * 100).toFixed(1)}%` }}
                          />
                        </span>
                        {(row.vol * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td>{(row.share * 100).toFixed(row.share < 0.1 ? 1 : 0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && (
        <div className={cardStyles.notes}>
          <p>{historyNote(data)}</p>
          <p>
            Vol = mean trailing {data.volWindowHours / 24}-day Parkinson (high–low) volatility,
            annualized, of the hours whose mid sat in each {fmtPrice(data.volBinSize)} bin. Bins
            with little time are noisy. Spot&apos;s bin is outlined.
          </p>
        </div>
      )}
    </div>
  );
}
