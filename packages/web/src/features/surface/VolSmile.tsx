import { useRef, useEffect, useMemo, useState } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';

import { useUnderlyings, useExpiries } from '@features/chain';
import { useTradfiExpiries } from '@features/tradfi';
import { DropdownPicker } from '@components/ui';
import { defineMessages, useT } from '@lib/i18n';
import { getTokenLogo } from '@lib/token-meta';
import { VENUE_IDS, VENUE_LIST } from '@lib/venue-meta';
import { formatExpiry, dteDays } from '@lib/format';
import {
  extractSmile,
  deltaTickLabel,
  smileChainFromRows,
  type SmileChain,
  type XAxisMode,
} from './smile-utils';
import { useAllExpiriesSmile, useSurface } from './queries';
import { type SurfaceMarket, TRADFI_SURFACE_VENUES, useSurfaceUnderlying } from './surface-market';
import styles from './VolSmile.module.css';

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

const CHART_OPTIONS = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid as const, color: 'transparent' },
    textColor: '#555B5E',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
  grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
  rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
  crosshair: {
    horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
    vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333', labelVisible: false },
  },
  handleScale: { mouseWheel: true, pinch: true },
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
} as const;

const messages = defineMessages(
  { title: 'Vol Smile', average: 'Average', all: 'All' },
  { title: 'Smile de vol', average: 'Promedio', all: 'Todos' },
);

const IV_FORMAT = { type: 'custom' as const, formatter: (p: number) => `${p.toFixed(1)}%` };

function useVolSmileChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  chains: SmileChain[],
  hiddenExpiries: Set<string>,
  activeVenues: string[],
  xAxisMode: XAxisMode,
  expiries: string[],
  viewKey: string,
) {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const fittedKeyRef = useRef<string | null>(null);
  const hiddenKey = [...hiddenExpiries].sort().join(',');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const tickFmt = xAxisMode === 'delta'
      ? (v: number) => deltaTickLabel(v)
      : (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));
    const chart = createChart(container, {
      ...CHART_OPTIONS,
      timeScale: { borderColor: '#1F2937', tickMarkFormatter: tickFmt },
    });
    chartRef.current = chart;
    fittedKeyRef.current = null;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
  }, [containerRef, xAxisMode]);

  // Refreshes swap series on the live chart instead of rebuilding it, so polling doesn't
  // flash the panel or reset the user's zoom; the view is refit only when it changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of seriesRef.current) chart.removeSeries(series);
    seriesRef.current = [];

    const colors = new Map(expiries.map((e, i) => [e, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!]));
    for (const chain of chains) {
      if (hiddenExpiries.has(chain.expiry)) continue;
      const points = extractSmile(chain.strikes, activeVenues, chain.referencePrice, xAxisMode);
      if (points.length < 3) continue;

      const series = chart.addSeries(LineSeries, {
        color: colors.get(chain.expiry) ?? '#555B5E',
        lineWidth: 2,
        priceFormat: IV_FORMAT,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(points.map((p) => ({ time: p.strike as unknown as number, value: p.iv })) as never);
      seriesRef.current.push(series);
    }

    const fitKey = `${viewKey}|${xAxisMode}|${hiddenKey}`;
    if (seriesRef.current.length > 0 && fittedKeyRef.current !== fitKey) {
      chart.timeScale().fitContent();
      fittedKeyRef.current = fitKey;
    }
  }, [chains, hiddenKey, activeVenues, xAxisMode, expiries, viewKey]);
}

interface Props {
  defaultUnderlying?: string;
  market?: SurfaceMarket;
}

export default function VolSmile({ defaultUnderlying = 'BTC', market = 'crypto' }: Props) {
  const t = useT(messages);
  const tradfi = market === 'tradfi';
  const { underlying: localUnderlying, setUnderlying: setLocalUnderlying } =
    useSurfaceUnderlying(market, defaultUnderlying);
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>('strike');
  const [selectedVenue, setSelectedVenue] = useState('deribit');

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data: cryptoExpiries } = useExpiries(tradfi ? '' : localUnderlying);
  const { data: tradfiExpiries } = useTradfiExpiries(tradfi ? localUnderlying : '');
  const expiries = (tradfi ? tradfiExpiries : cryptoExpiries)?.expiries ?? [];

  const { data: cryptoChains } = useAllExpiriesSmile(localUnderlying, !tradfi);
  // TradFi smiles ride on the surface snapshot: one request, and always consistent with it.
  const { data: tradfiSurface } = useSurface(
    tradfi ? localUnderlying : '',
    TRADFI_SURFACE_VENUES,
    'tradfi',
  );
  const chains = useMemo<SmileChain[]>(
    () =>
      tradfi
        ? (tradfiSurface?.smiles ?? []).map((smile) =>
            smileChainFromRows(smile, TRADFI_SURFACE_VENUES[0]!),
          )
        : (cryptoChains ?? []).map((chain) => ({
            expiry: chain.expiry,
            referencePrice: chain.stats.forwardPriceUsd,
            strikes: chain.strikes,
          })),
    [tradfi, tradfiSurface, cryptoChains],
  );
  const smileVenues = useMemo(
    () =>
      tradfi ? TRADFI_SURFACE_VENUES : selectedVenue === 'average' ? VENUE_IDS : [selectedVenue],
    [tradfi, selectedVenue],
  );

  // Only Deribit/OKX/Thalex carry BTC+ETH; SOL/DOGE/AAVE/LIT/etc. live on
  // bybit/coincall/binance/derive/gateio. Without this, picking e.g. SOL while
  // the venue dropdown is still on Deribit (the default) filters the smile
  // points down to zero and the chart silently goes blank.
  const venuesForUnderlying = useMemo(() => {
    const byVenue = underlyingsData?.byVenue;
    if (!byVenue) return null;
    return new Set(
      byVenue
        .filter((bv) => bv.underlyings.includes(localUnderlying))
        .map((bv) => bv.venue),
    );
  }, [underlyingsData, localUnderlying]);

  useEffect(() => {
    if (
      selectedVenue !== 'average' &&
      venuesForUnderlying != null &&
      venuesForUnderlying.size > 0 &&
      !venuesForUnderlying.has(selectedVenue)
    ) {
      setSelectedVenue('average');
    }
  }, [selectedVenue, venuesForUnderlying]);

  const expiryColors = new Map(expiries.map((e, i) => [e, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!]));

  const containerRef = useRef<HTMLDivElement>(null);

  useVolSmileChart(
    containerRef,
    chains,
    hiddenExpiries,
    smileVenues,
    xAxisMode,
    expiries,
    `${localUnderlying}|${smileVenues.join(',')}`,
  );

  const toggleExpiry = (exp: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  };

  const toggleAll = () => {
    if (hiddenExpiries.size === 0) {
      setHiddenExpiries(new Set(expiries));
    } else {
      setHiddenExpiries(new Set());
    }
  };

  const logo = getTokenLogo(localUnderlying);

  const venueOptions = [
    { value: 'average', label: t('average') },
    ...VENUE_LIST.filter((v) => venuesForUnderlying == null || venuesForUnderlying.has(v.id)).map(
      (v) => ({ value: v.id, label: v.label }),
    ),
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>{t('title')}</span>
        {setLocalUnderlying && (
          <DropdownPicker
            size="sm"
            value={localUnderlying}
            onChange={(v: string) => { setLocalUnderlying(v); setHiddenExpiries(new Set()); }}
            icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
            options={underlyings.map((u) => ({ value: u, label: u }))}
          />
        )}
        {!tradfi && (
          <DropdownPicker
            size="sm"
            value={selectedVenue}
            onChange={setSelectedVenue}
            options={venueOptions}
          />
        )}
        <div className={styles.xAxisToggle}>
          <button
            type="button"
            className={styles.toggleBtn}
            data-active={xAxisMode === 'delta' || undefined}
            onClick={() => setXAxisMode('delta')}
          >
            Delta
          </button>
          <button
            type="button"
            className={styles.toggleBtn}
            data-active={xAxisMode === 'strike' || undefined}
            onClick={() => setXAxisMode('strike')}
          >
            Strike
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.sidebar}>
          <button
            type="button"
            className={styles.expiryBtn}
            data-active={hiddenExpiries.size === 0 || undefined}
            onClick={toggleAll}
          >
            <span className={styles.expiryLine} style={{ background: '#888' }} />
            <span className={styles.expiryLabel}>{t('all')}</span>
          </button>
          {expiries.map((exp) => {
            const active = !hiddenExpiries.has(exp);
            const color = expiryColors.get(exp) ?? '#555B5E';
            const dte = dteDays(exp);
            return (
              <button
                key={exp}
                type="button"
                className={styles.expiryBtn}
                data-active={active || undefined}
                onClick={() => toggleExpiry(exp)}
              >
                <span className={styles.expiryLine} style={{ background: color }} />
                <span className={styles.expiryLabel}>{formatExpiry(exp)}</span>
                <span className={styles.expiryDte}>{dte}d</span>
              </button>
            );
          })}
        </div>
        <div className={styles.chartArea}>
          <div className={styles.chartWrap} ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
