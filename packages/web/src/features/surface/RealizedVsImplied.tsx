import { useMemo, useRef, useEffect, useState } from 'react';
import {
  createChart,
  AreaSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  ColorType,
} from 'lightweight-charts';

import { DropdownPicker } from '@components/ui';
import { defineMessages, useT } from '@lib/i18n';
import { getTokenLogo } from '@lib/token-meta';
import { useDvolHistory } from '@features/dvol';
import { useTradfiSelection } from '@features/tradfi';
import type { TradfiVolHistoryResponse } from '@oggregator/protocol';
import { useTradfiVolHistory } from './queries';
import type { SurfaceMarket } from './surface-market';
import styles from './RealizedVsImplied.module.css';

const CURRENCIES = ['BTC', 'ETH'] as const;
const IV_COLOR = '#50D2C1';
const HV_COLOR = '#F7A600';

const messages = defineMessages(
  {
    title: 'Realized vs Implied Volatility',
    hvWindow: 'HV {n}d (Realized)',
    hv: 'HV (Realized)',
  },
  {
    title: 'Volatilidad realizada vs implícita',
    hvWindow: 'HV {n}d (realizada)',
    hv: 'HV (realizada)',
  },
);

/** IV and HV lines in vol points; the DVOL response already has this shape. */
interface RvIvSeries {
  candles: Array<{ timestamp: number; close: number }>;
  hv: Array<{ timestamp: number; value: number }>;
}

function tradfiSeries(history: TradfiVolHistoryResponse | undefined): RvIvSeries | undefined {
  if (!history) return undefined;
  return {
    candles: history.series.flatMap((p) => (p.iv == null ? [] : [{ timestamp: p.ts, close: p.iv * 100 }])),
    hv: history.series.flatMap((p) => (p.rv == null ? [] : [{ timestamp: p.ts, value: p.rv * 100 }])),
  };
}

function useRvIvChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  data: RvIvSeries | undefined,
) {
  const chartRef = useRef<IChartApi | null>(null);
  const ivRef = useRef<ISeriesApi<'Area'> | null>(null);
  const hvRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.1, bottom: 0.05 } },
      timeScale: { borderColor: '#1F2937', timeVisible: false },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    const priceFmt = { type: 'custom' as const, formatter: (p: number) => `${p.toFixed(1)}%` };

    ivRef.current = chart.addSeries(AreaSeries, {
      lineColor: IV_COLOR,
      topColor: 'rgba(80, 210, 193, 0.28)',
      bottomColor: 'rgba(80, 210, 193, 0.02)',
      lineWidth: 2,
      priceFormat: priceFmt,
    });

    hvRef.current = chart.addSeries(LineSeries, {
      color: HV_COLOR,
      lineWidth: 2,
      lineStyle: 0,
      priceFormat: priceFmt,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      ivRef.current = null;
      hvRef.current = null;
    };
  }, [containerRef]);

  useEffect(() => {
    if (!ivRef.current || !hvRef.current) return;

    const dedup = (items: Array<{ time: number; value: number }>) => {
      const seen = new Set<number>();
      return items.filter((p) => {
        if (seen.has(p.time)) return false;
        seen.add(p.time);
        return true;
      }).sort((a, b) => a.time - b.time);
    };

    if (data?.candles.length) {
      const ivData = dedup(data.candles.map((c) => ({ time: Math.floor(c.timestamp / 1000), value: c.close })));
      ivRef.current.setData(ivData as never);
    } else {
      ivRef.current.setData([]);
    }

    if (data?.hv?.length) {
      const hvData = dedup(data.hv.map((p) => ({ time: Math.floor(p.timestamp / 1000), value: p.value })));
      hvRef.current.setData(hvData as never);
    } else {
      hvRef.current.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [data]);
}

interface Props {
  defaultUnderlying?: string;
  market?: SurfaceMarket;
}

export default function RealizedVsImplied({ defaultUnderlying = 'BTC', market = 'crypto' }: Props) {
  const t = useT(messages);
  const tradfi = market === 'tradfi';
  const initial = CURRENCIES.includes(defaultUnderlying as (typeof CURRENCIES)[number])
    ? defaultUnderlying
    : 'BTC';
  const [currency, setCurrency] = useState(initial);
  const { data: dvol } = useDvolHistory(tradfi ? '' : currency);
  const { underlying: tradfiUnderlying } = useTradfiSelection(tradfi);
  const { data: history } = useTradfiVolHistory(tradfi ? tradfiUnderlying : '');
  const tradfiData = useMemo(() => tradfiSeries(history), [history]);

  const containerRef = useRef<HTMLDivElement>(null);
  useRvIvChart(containerRef, tradfi ? tradfiData : dvol);

  const logo = getTokenLogo(currency);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>{t('title')}</span>
        {tradfi ? (
          <span className={styles.title}>{tradfiUnderlying}</span>
        ) : (
          <DropdownPicker
            size="sm"
            value={currency}
            onChange={setCurrency}
            icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        )}
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: IV_COLOR }} />
            IV ({tradfi ? (history?.ivSource ?? 'IVx') : 'DVOL'})
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: HV_COLOR }} />
            {tradfi ? t('hvWindow', { n: history?.rvWindowDays ?? 21 }) : t('hv')}
          </span>
        </div>
      </div>

      <div className={styles.chartArea}>
        <div className={styles.chartWrap} ref={containerRef} />
      </div>
    </div>
  );
}
