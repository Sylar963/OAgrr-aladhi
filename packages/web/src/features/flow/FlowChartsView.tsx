import { AssetPickerButton, EmptyState, Spinner } from '@components/ui';
import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUE_IDS, VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type MouseEventHandler,
  type Time,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type TradeBubble, TradeBubblePrimitive, tierForNotional } from './chart-bubble-primitive';
import { useInstrumentList, useInstrumentTrades } from './chart-queries';
import { getCustomRangeFromBounds } from './DateRangePicker';
import styles from './FlowChartsView.module.css';
import { HistoryControls, type HistoryPreset } from './HistoryControls';
import { InstrumentPicker } from './InstrumentPicker';
import type { HistoryRange, TradeEvent } from './queries';
import { useFlowHistorySummary } from './queries';
import { mergeInstrumentTrades, useInstrumentTradesLive } from './use-instrument-trades-live';
import { flowMessages } from './i18n';

const messages = defineMessages(
  {
    needsStorage: 'Charts require trade history storage',
    needsStorageDetail: 'TRADE_STORE_URL is not configured on the server.',
    loadingInstruments: 'Loading instruments…',
    noInstruments: 'No traded instruments for {venue} in this range',
    noInstrumentsDetail: 'Try a wider window or a different venue.',
    pickInstrument: 'Pick an instrument',
    pickInstrumentDetail: 'Use the picker above to choose an option contract.',
    trades: 'Trades',
    notional: 'Notional',
    last: 'Last',
    lastIv: 'Last IV',
    buySell: 'Buy/Sell',
    noInstrumentTrades: 'No trades for this instrument in range',
    noInstrumentTradesDetail: 'Try a wider time range.',
    time: 'Time',
    side: 'Side',
    size: 'Size',
    price: 'Price',
    premium: 'Premium',
    buy: 'Buy',
    sell: 'Sell',
    blockOutline: 'Block (outline)',
  },
  {
    needsStorage: 'Los gráficos requieren almacenamiento del historial de trades',
    needsStorageDetail: 'TRADE_STORE_URL no está configurado en el servidor.',
    loadingInstruments: 'Cargando instrumentos…',
    noInstruments: 'No hay instrumentos operados en {venue} en este rango',
    noInstrumentsDetail: 'Prueba un período más amplio u otro exchange.',
    pickInstrument: 'Elige un instrumento',
    pickInstrumentDetail: 'Usa el selector de arriba para elegir un contrato de opción.',
    trades: 'Trades',
    notional: 'Nocional',
    last: 'Último',
    lastIv: 'Última IV',
    buySell: 'Compra/Venta',
    noInstrumentTrades: 'No hay trades de este instrumento en el rango',
    noInstrumentTradesDetail: 'Prueba un rango de tiempo más amplio.',
    time: 'Hora',
    side: 'Lado',
    size: 'Tamaño',
    price: 'Precio',
    premium: 'Prima',
    buy: 'Compra',
    sell: 'Venta',
    blockOutline: 'Block (contorno)',
  },
);

function optionTypeFromInstrument(instrument: string): 'C' | 'P' | null {
  const match = instrument.match(/-([CP])(?:-|$)/);
  if (!match) return null;
  return match[1] as 'C' | 'P';
}

// Per-contract option premium in USD. Deribit/OKX quote premium in base
// currency (BTC/ETH) — multiply by the index price to get USD. Linear venues
// quote premium in the settle currency already.
function optionPremiumUsd(trade: TradeEvent): number | null {
  const isInverse = trade.venue === 'deribit' || trade.venue === 'okx';
  if (!isInverse) {
    return Number.isFinite(trade.price) && trade.price > 0 ? trade.price : null;
  }
  const ref = trade.referencePriceUsd;
  if (ref == null || !Number.isFinite(ref) || ref <= 0) return null;
  const value = trade.price * ref;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function tradeToBubble(trade: TradeEvent): TradeBubble | null {
  const optionType = optionTypeFromInstrument(trade.instrument);
  if (!optionType) return null;
  const priceUsd = optionPremiumUsd(trade);
  if (priceUsd == null) return null;
  const notional = trade.notionalUsd ?? trade.premiumUsd ?? 0;
  return {
    timeSec: Math.floor(trade.timestamp / 1000),
    price: priceUsd,
    side: trade.side,
    optionType,
    tier: tierForNotional(notional),
    isBlock: trade.isBlock,
    tradeUid: trade.tradeUid,
  };
}

interface FlowChartsViewProps {
  historyPreset: HistoryPreset;
  historyRange: HistoryRange;
  onPresetChange: (preset: HistoryPreset) => void;
  onRangeChange: (range: HistoryRange) => void;
}

export default function FlowChartsView({
  historyPreset,
  historyRange,
  onPresetChange,
  onRangeChange,
}: FlowChartsViewProps) {
  const t = useT(messages);
  const tf = useT(flowMessages);
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const [selectedVenue, setSelectedVenue] = useState<string>(() => activeVenues[0] ?? 'deribit');
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);

  useEffect(() => {
    if (!activeVenues.includes(selectedVenue)) {
      setSelectedVenue(activeVenues[0] ?? 'deribit');
    }
  }, [activeVenues, selectedVenue]);

  const instrumentsQuery = useInstrumentList({
    underlying,
    venue: selectedVenue,
    range: historyRange,
    limit: 100,
  });

  const tradesQuery = useInstrumentTrades(
    {
      underlying,
      venue: selectedVenue,
      instrument: selectedInstrument ?? '',
      range: historyRange,
      limit: 500,
    },
    Boolean(selectedInstrument),
  );
  const liveTrades = useInstrumentTradesLive(
    {
      underlying,
      venue: selectedVenue,
      instrument: selectedInstrument ?? '',
    },
    Boolean(selectedInstrument) && historyPreset !== 'yesterday' && historyPreset !== 'custom',
  );

  const historyBounds = useFlowHistorySummary(
    underlying,
    [selectedVenue],
    { start: null, end: null },
    true,
  );
  const historySummary = useFlowHistorySummary(underlying, [selectedVenue], historyRange, true);

  useEffect(() => {
    if (historyPreset !== 'custom') return;
    if (historyRange.start && historyRange.end) return;
    const next = getCustomRangeFromBounds(historyBounds.data);
    if (next.start && next.end) onRangeChange(next);
  }, [historyBounds.data, historyPreset, historyRange.end, historyRange.start, onRangeChange]);

  useEffect(() => {
    const instruments = instrumentsQuery.data?.instruments ?? [];
    if (!instruments.length) {
      setSelectedInstrument(null);
      return;
    }
    if (!selectedInstrument || !instruments.some((row) => row.instrument === selectedInstrument)) {
      setSelectedInstrument(instruments[0]?.instrument ?? null);
    }
  }, [instrumentsQuery.data, selectedInstrument]);

  const [hoverTrade, setHoverTrade] = useState<TradeEvent | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const [chartContainer, setChartContainer] = useState<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const primitiveRef = useRef<TradeBubblePrimitive | null>(null);
  const tradeIndexRef = useRef<Map<string, TradeEvent>>(new Map());
  const fittedDataKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chartContainer) return;

    const chart = createChart(chartContainer, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0A0A0A' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1A1A1A' },
        horzLines: { color: '#1A1A1A' },
      },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true },
    });

    const series = chart.addSeries(LineSeries, {
      color: '#7A8085',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const primitive = new TradeBubblePrimitive();
    series.attachPrimitive(primitive);

    chartApiRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;

    const handleCrosshair: MouseEventHandler<Time> = (param) => {
      const point = param.point;
      if (!point || !primitiveRef.current) {
        setHoverTrade(null);
        setHoverPos(null);
        return;
      }
      const bubble = primitiveRef.current.findBubbleAt(point.x, point.y);
      if (!bubble) {
        setHoverTrade(null);
        setHoverPos(null);
        return;
      }
      const trade = tradeIndexRef.current.get(bubble.tradeUid);
      if (!trade) {
        setHoverTrade(null);
        setHoverPos(null);
        return;
      }
      setHoverTrade(trade);
      setHoverPos({ x: point.x, y: point.y });
    };

    chart.subscribeCrosshairMove(handleCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
    };
  }, [chartContainer]);

  const trades = useMemo(
    () => mergeInstrumentTrades(tradesQuery.data?.trades ?? [], liveTrades.trades),
    [liveTrades.trades, tradesQuery.data?.trades],
  );
  const chartDataKey = `${underlying}\u0000${selectedVenue}\u0000${selectedInstrument ?? ''}\u0000${historyRange.start ?? ''}\u0000${historyRange.end ?? ''}`;
  const bubbles = useMemo(
    () =>
      trades.flatMap((trade) => {
        const bubble = tradeToBubble(trade);
        return bubble ? [bubble] : [];
      }),
    [trades],
  );

  useEffect(() => {
    if (!seriesRef.current || !primitiveRef.current) return;

    tradeIndexRef.current = new Map(trades.map((t) => [t.tradeUid, t]));

    const seen = new Set<number>();
    const linePoints = bubbles
      .slice()
      .sort((a, b) => a.timeSec - b.timeSec)
      .filter((b) => {
        if (seen.has(b.timeSec)) return false;
        seen.add(b.timeSec);
        return true;
      })
      .map((b) => ({ time: b.timeSec as number, value: b.price }));

    seriesRef.current.setData(linePoints as never);
    primitiveRef.current.update(bubbles);
    if (bubbles.length > 0 && fittedDataKeyRef.current !== chartDataKey) {
      chartApiRef.current?.timeScale().fitContent();
      fittedDataKeyRef.current = chartDataKey;
    }
  }, [bubbles, chartDataKey, trades, chartContainer]);

  const stats = useMemo(() => {
    if (!trades.length) return null;
    let buyNotional = 0;
    let sellNotional = 0;
    let calls = 0;
    let puts = 0;
    let totalNotional = 0;
    for (const trade of trades) {
      const notional = trade.notionalUsd ?? trade.premiumUsd ?? 0;
      totalNotional += notional;
      if (trade.side === 'buy') buyNotional += notional;
      else sellNotional += notional;
      const type = optionTypeFromInstrument(trade.instrument);
      if (type === 'C') calls += 1;
      if (type === 'P') puts += 1;
    }
    const lastTrade = trades[0];
    return {
      count: trades.length,
      totalNotional,
      buyPct: totalNotional > 0 ? (buyNotional / totalNotional) * 100 : 0,
      sellPct: totalNotional > 0 ? (sellNotional / totalNotional) * 100 : 0,
      calls,
      puts,
      lastPrice: lastTrade ? optionPremiumUsd(lastTrade) : null,
      lastIv: lastTrade?.iv ?? null,
    };
  }, [trades]);

  const instrumentsAvailable = instrumentsQuery.data?.available !== false;
  const instruments = instrumentsQuery.data?.instruments ?? [];

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <AssetPickerButton />
        <div className={styles.venuePicker}>
          {VENUE_IDS.filter((id) => activeVenues.includes(id)).map((id) => (
            <button
              key={id}
              type="button"
              className={styles.venueBtn}
              data-active={id === selectedVenue}
              onClick={() => setSelectedVenue(id)}
              title={VENUES[id]?.label}
            >
              {VENUES[id]?.shortLabel ?? id}
            </button>
          ))}
        </div>
        <InstrumentPicker
          instruments={instruments}
          selected={selectedInstrument}
          onSelect={setSelectedInstrument}
          loading={instrumentsQuery.isLoading}
        />
        <HistoryControls
          preset={historyPreset}
          range={historyRange}
          summary={historySummary.data}
          bounds={historyBounds.data}
          activeVenues={[selectedVenue]}
          page={1}
          hasPreviousPage={false}
          hasNextPage={false}
          isPageLoading={tradesQuery.isFetching}
          isSummaryLoading={historySummary.isLoading}
          onPresetChange={onPresetChange}
          onRangeChange={onRangeChange}
          onPreviousPage={() => {}}
          onNextPage={() => {}}
        />
      </div>

      {!instrumentsAvailable ? (
        <EmptyState
          title={t('needsStorage')}
          detail={t('needsStorageDetail')}
        />
      ) : instrumentsQuery.isLoading ? (
        <Spinner size="lg" label={t('loadingInstruments')} />
      ) : instruments.length === 0 ? (
        <EmptyState
          title={t('noInstruments', { venue: VENUES[selectedVenue]?.label ?? selectedVenue })}
          detail={t('noInstrumentsDetail')}
        />
      ) : !selectedInstrument ? (
        <EmptyState
          title={t('pickInstrument')}
          detail={t('pickInstrumentDetail')}
        />
      ) : (
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <span className={styles.chartTitle}>{selectedInstrument}</span>
            {stats ? (
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t('trades')}</span>
                  <span className={styles.statValue}>{stats.count}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t('notional')}</span>
                  <span className={styles.statValue}>
                    ${Math.round(stats.totalNotional).toLocaleString()}
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t('last')}</span>
                  <span className={styles.statValue}>
                    {stats.lastPrice != null
                      ? `$${stats.lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : '–'}
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t('lastIv')}</span>
                  <span className={styles.statValue}>
                    {stats.lastIv != null ? fmtIv(stats.lastIv) : '–'}
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t('buySell')}</span>
                  <span className={styles.statValue}>
                    {stats.buyPct.toFixed(0)}% / {stats.sellPct.toFixed(0)}%
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>C/P</span>
                  <span className={styles.statValue}>
                    {stats.calls} / {stats.puts}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartWrap} ref={setChartContainer} />
            {tradesQuery.isLoading ? (
              <div className={styles.chartOverlay}>
                <Spinner size="lg" />
              </div>
            ) : null}
            {!tradesQuery.isLoading && trades.length === 0 ? (
              <div className={styles.chartOverlay}>
                <EmptyState
                  title={t('noInstrumentTrades')}
                  detail={t('noInstrumentTradesDetail')}
                />
              </div>
            ) : null}
            {hoverTrade && hoverPos ? (
              <div
                className={styles.tooltip}
                style={{ left: hoverPos.x + 12, top: hoverPos.y + 12 }}
                role="status"
              >
                <div className={styles.tooltipRow}>
                  <span className={styles.tooltipLabel}>{t('time')}</span>
                  <span className={styles.tooltipValue}>
                    {new Date(hoverTrade.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
                  </span>
                </div>
                <div className={styles.tooltipRow}>
                  <span className={styles.tooltipLabel}>{t('side')}</span>
                  <span className={styles.tooltipValue} data-side={hoverTrade.side}>
                    {hoverTrade.side === 'buy' ? tf('buy') : tf('sell')}
                  </span>
                </div>
                <div className={styles.tooltipRow}>
                  <span className={styles.tooltipLabel}>{t('size')}</span>
                  <span className={styles.tooltipValue}>{hoverTrade.size}</span>
                </div>
                <div className={styles.tooltipRow}>
                  <span className={styles.tooltipLabel}>{t('price')}</span>
                  <span className={styles.tooltipValue}>
                    {(() => {
                      const p = optionPremiumUsd(hoverTrade);
                      return p != null
                        ? `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '–';
                    })()}
                  </span>
                </div>
                <div className={styles.tooltipRow}>
                  <span className={styles.tooltipLabel}>IV</span>
                  <span className={styles.tooltipValue}>
                    {hoverTrade.iv != null ? fmtIv(hoverTrade.iv) : '–'}
                  </span>
                </div>
                <div className={styles.tooltipRow}>
                  <span className={styles.tooltipLabel}>{t('premium')}</span>
                  <span className={styles.tooltipValue}>
                    {hoverTrade.premiumUsd != null
                      ? `$${Math.round(hoverTrade.premiumUsd).toLocaleString()}`
                      : '–'}
                  </span>
                </div>
                {hoverTrade.isBlock ? (
                  <div className={styles.tooltipRow}>
                    <span className={styles.tooltipBadge}>BLOCK</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} data-side="buy" /> {t('buy')}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} data-side="sell" /> {t('sell')}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} data-block /> {t('blockOutline')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
