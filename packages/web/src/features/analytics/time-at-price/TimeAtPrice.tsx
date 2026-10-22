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
import { defineMessages, useT, type Translate } from '@lib/i18n';
import { useTimeAtPrice } from '../queries';
import analyticsStyles from '../AnalyticsView.module.css';
import cardStyles from '../BreakEvenForecast.module.css';
import { TimeAtPricePrimitive } from './TimeAtPricePrimitive';
import styles from './TimeAtPrice.module.css';

const PATH_COLOR = '#E8ECEB';
const DAY_MS = 86_400_000;
const SUPPORTED = new Set<string>(TIME_AT_PRICE_UNDERLYINGS);
const LOOKBACK_LABELS: Record<number, 'lb90' | 'lb180' | 'lb365' | 'lb730'> = {
  90: 'lb90',
  180: 'lb180',
  365: 'lb365',
  730: 'lb730',
};

const messages = defineMessages(
  {
    title: 'Time at Price',
    unsupported: 'Built from perpetual candles, so it is available for BTC, ETH and HYPE only.',
    subtitle:
      '{underlying}-PERPETUAL hourly bars · shade = hours traded through each level · line = daily close',
    lookback: 'Lookback',
    lb90: '90D',
    lb180: '180D',
    lb365: '1Y',
    lb730: '2Y',
    lbDays: '{n}D',
    loading: 'Loading price history…',
    unavailable: 'Price history is unavailable right now.',
    price: 'Price',
    volTitle:
      'Mean trailing {n}-day Parkinson vol (annualized) of the hours spent in the bin',
    vol: 'Vol {n}d',
    time: 'Time',
    timeTitle: 'Share of hours whose mid sat in the bin',
    shade:
      'Shade = share of the {bars} hourly bars from {from} to {to} whose high–low range crossed each {bin} level.',
    shortHistory: 'The venue serves less history than the selected lookback.',
    volNote:
      "Vol = mean trailing {n}-day Parkinson (high–low) volatility, annualized, of the hours whose mid sat in each {bin} bin. Bins with little time are noisy. Spot's bin is outlined.",
  },
  {
    title: 'Tiempo en precio',
    unsupported:
      'Se construye con velas de perpetuos, así que solo está disponible para BTC, ETH y HYPE.',
    subtitle:
      'Barras horarias de {underlying}-PERPETUAL · sombra = horas negociadas en cada nivel · línea = cierre diario',
    lookback: 'Periodo',
    lb90: '90D',
    lb180: '180D',
    lb365: '1A',
    lb730: '2A',
    lbDays: '{n}D',
    loading: 'Cargando historial de precios…',
    unavailable: 'El historial de precios no está disponible ahora.',
    price: 'Precio',
    volTitle:
      'Vol Parkinson móvil media de {n} días (anualizada) de las horas pasadas en el rango',
    vol: 'Vol {n}d',
    time: 'Tiempo',
    timeTitle: 'Proporción de horas cuyo precio medio estuvo en el rango',
    shade:
      'Sombra = proporción de las {bars} barras horarias del {from} al {to} cuyo rango máx–mín cruzó cada nivel de {bin}.',
    shortHistory: 'El exchange ofrece menos historial que el periodo seleccionado.',
    volNote:
      'Vol = volatilidad Parkinson (máx–mín) móvil media de {n} días, anualizada, de las horas cuyo precio medio estuvo en cada rango de {bin}. Los rangos con poco tiempo son ruidosos. El rango del spot está resaltado.',
  },
);

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

function historyNote(data: TimeAtPriceResponse, t: Translate<typeof messages.en>): string {
  const shade = t('shade', {
    bars: data.bars.toLocaleString('en-US'),
    from: fmtDate(data.from),
    to: fmtDate(data.to),
    bin: fmtPrice(data.binSize),
  });
  const short = data.to - data.from < data.lookbackDays * DAY_MS * 0.95;
  return short ? `${shade} ${t('shortHistory')}` : shade;
}

interface TimeAtPriceProps {
  underlying: string;
}

export default function TimeAtPrice({ underlying }: TimeAtPriceProps) {
  const t = useT(messages);
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
        <div className={analyticsStyles.cardTitle}>{t('title')}</div>
        <div className={cardStyles.empty}>{t('unsupported')}</div>
      </div>
    );
  }

  return (
    <div className={analyticsStyles.card}>
      <div className={cardStyles.header}>
        <div>
          <div className={analyticsStyles.cardTitle}>{t('title')}</div>
          <div className={cardStyles.subtitle}>{t('subtitle', { underlying })}</div>
        </div>
        <label className={cardStyles.expiryPicker}>
          <span>{t('lookback')}</span>
          <select
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Number(event.target.value))}
          >
            {TIME_AT_PRICE_LOOKBACK_DAYS.map((days) => (
              <option key={days} value={days}>
                {t(LOOKBACK_LABELS[days] ?? 'lbDays', { n: days })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={cardStyles.body}>
        <div className={cardStyles.chartArea}>
          <div className={cardStyles.chart} ref={containerRef} />
          {isLoading && <div className={cardStyles.overlay}>{t('loading')}</div>}
          {isError && !data && (
            <div className={cardStyles.overlay}>{t('unavailable')}</div>
          )}
        </div>

        {data && (
          <div className={cardStyles.side}>
            <table className={cardStyles.table}>
              <thead>
                <tr>
                  <th>{t('price')}</th>
                  <th title={t('volTitle', { n: data.volWindowHours / 24 })}>
                    {t('vol', { n: data.volWindowHours / 24 })}
                  </th>
                  <th title={t('timeTitle')}>{t('time')}</th>
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
          <p>{historyNote(data, t)}</p>
          <p>
            {t('volNote', { n: data.volWindowHours / 24, bin: fmtPrice(data.volBinSize) })}
          </p>
        </div>
      )}
    </div>
  );
}
