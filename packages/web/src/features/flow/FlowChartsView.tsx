import { EmptyState, Spinner } from '@components/ui';
import { fmtIv } from '@lib/format';
import { defineMessages, useT, type Translate } from '@lib/i18n';
import { VENUE_IDS, VENUES } from '@lib/venue-meta';
import { useMarket } from '@stores/app-store';
import { useEffect, useMemo, useState } from 'react';
import { FlowIvSmile, FlowSpotChart, FlowStrikeLadder } from './FlowMarketCharts';
import {
  defaultExpiry,
  flowRangeIsSupported,
  flowResolution,
  formatExpiry,
  formatMoney,
  optionTypeFromInstrument,
  buildStrikeFlowProfile,
  type OptionFilter,
} from './flow-map-model';
import { getCustomRangeFromBounds } from './DateRangePicker';
import DateRangePicker from './DateRangePicker';
import type { HistoryPreset } from './HistoryControls';
import {
  useFlowStrikeMap,
  useInstrumentList,
  useInstrumentTrades,
  useSpotCandleRange,
} from './chart-queries';
import type { HistoryRange, TradeEvent, TradeHistoryCursor } from './queries';
import { useFlowHistoryPage, useFlowHistorySummary } from './queries';
import { flowMessages } from './i18n';
import type { FlowStrikeMapPoint } from '@oggregator/protocol';
import styles from './FlowChartsView.module.css';

const messages = defineMessages(
  {
    historyRange: 'History range',
    today: 'Today',
    yesterday: 'Yesterday',
    last7d: '7D',
    last30d: '30D',
    custom: 'Custom',
    expiry: 'Expiry',
    allExpiries: 'No expiry data',
    allOptions: 'All',
    calls: 'Calls',
    puts: 'Puts',
    trades: 'Trades',
    notional: 'Notional',
    netFlow: 'Buy − sell',
    premium: 'Premium',
    dateWindow: 'Window',
    historyNote: 'Stored trade prints · venue coverage varies by range',
    loading: 'Loading strike flow…',
    noHistory: 'No option trades in this range',
    noHistoryDetail: 'Try another expiry, venue, or time window.',
    storageNeeded: 'Charts require trade history storage',
    storageNeededDetail: 'TRADE_STORE_URL is not configured on the server.',
    rangeTooWide: 'Choose a window of 90 days or less',
    rangeTooWideDetail: 'The historical strike map is bounded to keep the chart responsive.',
    mapFailed: 'Could not load historical flow',
    mapFailedDetail: 'Try another range or venue. The selected history may be unavailable.',
    noFlowForExpiry: 'No trades for this expiry in the selected range',
    selectFlow: 'Select a flow bubble or strike to inspect executions',
    selectFlowDetail: 'The chart groups prints by time, option type, and reported trade side.',
    executions: 'Executions in selected interval',
    selectContract: 'Select a print to inspect the contract',
    contractHistory: 'Contract history',
    selectedInterval: '{type} {side} · {time} UTC',
    showingPrints: 'Showing {shown} of {total} prints in this interval',
    nextPage: 'Load next page',
    time: 'Time UTC',
    side: 'Side',
    instrument: 'Contract',
    size: 'Size',
    premiumUsd: 'Premium USD',
    price: 'Premium path',
    iv: 'Last IV',
    noContractTrades: 'No trades for this contract in this window',
    tradeSide: 'Buy',
    buy: 'Buy',
    sell: 'Sell',
    c: 'C',
    p: 'P',
    error: 'Request failed',
  },
  {
    historyRange: 'Rango histórico',
    today: 'Hoy',
    yesterday: 'Ayer',
    last7d: '7D',
    last30d: '30D',
    custom: 'Personalizado',
    expiry: 'Vencimiento',
    allExpiries: 'Sin vencimientos',
    allOptions: 'Todos',
    calls: 'Calls',
    puts: 'Puts',
    trades: 'Trades',
    notional: 'Nocional',
    netFlow: 'Compra − venta',
    premium: 'Prima',
    dateWindow: 'Período',
    historyNote: 'Prints guardados · la cobertura del venue varía según el período',
    loading: 'Cargando flujo por strike…',
    noHistory: 'No hay trades de opciones en este período',
    noHistoryDetail: 'Prueba otro vencimiento, venue o período.',
    storageNeeded: 'Los gráficos requieren almacenamiento del historial de trades',
    storageNeededDetail: 'TRADE_STORE_URL no está configurado en el servidor.',
    rangeTooWide: 'Elige un período de 90 días o menos',
    rangeTooWideDetail: 'El mapa histórico de strikes limita el rango para mantener el gráfico ágil.',
    mapFailed: 'No se pudo cargar el flujo histórico',
    mapFailedDetail: 'Prueba otro período o venue. El historial seleccionado podría no estar disponible.',
    noFlowForExpiry: 'No hay trades para este vencimiento en el período seleccionado',
    selectFlow: 'Selecciona una burbuja o strike para revisar ejecuciones',
    selectFlowDetail: 'El gráfico agrupa prints por hora, tipo de opción y lado reportado.',
    executions: 'Ejecuciones del intervalo seleccionado',
    selectContract: 'Selecciona un print para revisar el contrato',
    contractHistory: 'Historial del contrato',
    selectedInterval: '{type} {side} · {time} UTC',
    showingPrints: 'Mostrando {shown} de {total} prints en este intervalo',
    nextPage: 'Cargar página siguiente',
    time: 'Hora UTC',
    side: 'Lado',
    instrument: 'Contrato',
    size: 'Tamaño',
    premiumUsd: 'Prima USD',
    price: 'Trayectoria de prima',
    iv: 'Última IV',
    noContractTrades: 'No hay trades de este contrato en este período',
    tradeSide: 'Compra',
    buy: 'Compra',
    sell: 'Venta',
    c: 'C',
    p: 'P',
    error: 'Error de solicitud',
  },
);

interface FlowChartsViewProps {
  historyPreset: HistoryPreset;
  historyRange: HistoryRange;
  onPresetChange: (preset: HistoryPreset) => void;
  onRangeChange: (range: HistoryRange) => void;
}

const PRESETS: HistoryPreset[] = ['today', 'yesterday', 'last7d', 'last30d', 'custom'];

export default function FlowChartsView({
  historyPreset,
  historyRange,
  onPresetChange,
  onRangeChange,
}: FlowChartsViewProps) {
  const t = useT(messages);
  const tf = useT(flowMessages);
  const underlying = useMarket((market) => market.underlying);
  const activeVenues = useMarket((market) => market.activeVenues);
  const [selectedVenue, setSelectedVenue] = useState<string>(() => activeVenues[0] ?? 'deribit');
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [optionFilter, setOptionFilter] = useState<OptionFilter>('all');
  const [selectedPoint, setSelectedPoint] = useState<FlowStrikeMapPoint | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const [pointCursor, setPointCursor] = useState<TradeHistoryCursor | null>(null);

  useEffect(() => {
    if (!activeVenues.includes(selectedVenue)) setSelectedVenue(activeVenues[0] ?? 'deribit');
  }, [activeVenues, selectedVenue]);

  const rangeReady = Boolean(historyRange.start && historyRange.end);
  const supportedRange = flowRangeIsSupported(historyRange);
  const resolution = flowResolution(historyRange);
  const instrumentsQuery = useInstrumentList(
    { underlying, venue: selectedVenue, range: historyRange, limit: 1000 },
    rangeReady,
  );
  const instruments = instrumentsQuery.data?.instruments ?? [];
  const expiryOptions = useMemo(
    () => [...new Set(instruments.flatMap((row) => (row.expiry ? [row.expiry] : [])))].sort(),
    [instruments],
  );
  const fallbackExpiry = useMemo(() => defaultExpiry(instruments), [instruments]);
  const activeExpiry = selectedExpiry && expiryOptions.includes(selectedExpiry)
    ? selectedExpiry
    : fallbackExpiry;

  useEffect(() => {
    if (selectedExpiry && !expiryOptions.includes(selectedExpiry)) setSelectedExpiry(null);
  }, [expiryOptions, selectedExpiry]);

  useEffect(() => {
    setSelectedPoint(null);
    setSelectedInstrument(null);
    setPointCursor(null);
  }, [activeExpiry, historyRange.end, historyRange.start, optionFilter, underlying, selectedVenue]);

  const historyBounds = useFlowHistorySummary(
    underlying,
    [selectedVenue],
    { start: null, end: null },
    true,
  );

  useEffect(() => {
    if (historyPreset !== 'custom' || (historyRange.start && historyRange.end)) return;
    const next = getCustomRangeFromBounds(historyBounds.data);
    if (next.start && next.end) onRangeChange(next);
  }, [historyBounds.data, historyPreset, historyRange.end, historyRange.start, onRangeChange]);

  const flowQuery = useFlowStrikeMap(
    {
      underlying,
      venue: selectedVenue,
      expiry: activeExpiry ?? '',
      range: historyRange,
      resolution,
    },
    supportedRange && activeExpiry != null,
  );
  const spotQuery = useSpotCandleRange(
    { underlying, range: historyRange, resolution },
    supportedRange,
  );
  const flowMap = flowQuery.data;
  const buckets = flowMap?.buckets ?? [];
  const profile = useMemo(() => buildStrikeFlowProfile(buckets), [buckets]);
  const candles = spotQuery.data?.candles ?? [];
  const lastSpot = candles.at(-1)?.close ?? null;

  const pointRange = useMemo<HistoryRange>(
    () =>
      selectedPoint
        ? {
            start: new Date(selectedPoint.bucketTs).toISOString(),
            end: new Date(selectedPoint.bucketTs + resolution * 1000).toISOString(),
          }
        : historyRange,
    [historyRange, resolution, selectedPoint],
  );
  const pointTradeQuery = useFlowHistoryPage(
    {
      underlying,
      venues: [selectedVenue],
      range: pointRange,
      expiry: activeExpiry ?? undefined,
      cursor: pointCursor,
      limit: 200,
    },
    selectedPoint != null && activeExpiry != null,
  );
  const pointTrades = useMemo(
    () =>
      (pointTradeQuery.data?.trades ?? []).filter(
        (trade) =>
          selectedPoint != null &&
          trade.side === selectedPoint.side &&
          optionTypeFromInstrument(trade.instrument) === selectedPoint.optionType,
      ),
    [pointTradeQuery.data?.trades, selectedPoint],
  );

  const contractQuery = useInstrumentTrades(
    {
      underlying,
      venue: selectedVenue,
      instrument: selectedInstrument ?? '',
      range: historyRange,
      limit: 500,
    },
    selectedInstrument != null,
  );
  const contractTrades = useMemo(
    () =>
      [...(contractQuery.data?.trades ?? [])]
        .filter((trade) => optionPremiumUsd(trade) != null)
        .sort((left, right) => left.timestamp - right.timestamp),
    [contractQuery.data?.trades],
  );

  const selectPoint = (point: FlowStrikeMapPoint) => {
    setSelectedPoint(point);
    setSelectedInstrument(null);
    setPointCursor(null);
  };

  const selectInstrument = (instrument: string) => {
    setSelectedPoint(null);
    setSelectedInstrument(instrument);
    setPointCursor(null);
  };

  const instrumentsAvailable = instrumentsQuery.data?.available !== false;
  const flowSummary = flowMap;
  const dateWindow = formatDateWindow(historyRange);

  return (
    <div className={styles.wrap}>
      <div className={styles.controlPanel}>
        <div className={styles.controlRow}>
          <div className={styles.venuePicker} aria-label="Venue">
            {VENUE_IDS.filter((venue) => activeVenues.includes(venue)).map((venue) => (
              <button
                key={venue}
                type="button"
                className={styles.venueBtn}
                data-active={venue === selectedVenue}
                onClick={() => {
                  setSelectedVenue(venue);
                  setSelectedExpiry(null);
                  setSelectedPoint(null);
                  setSelectedInstrument(null);
                }}
                title={VENUES[venue]?.label}
              >
                {VENUES[venue]?.shortLabel ?? venue}
              </button>
            ))}
          </div>
          <label className={styles.expiryControl}>
            <span>{t('expiry')}</span>
            <select
              value={activeExpiry ?? ''}
              disabled={expiryOptions.length === 0}
              onChange={(event) => {
                setSelectedExpiry(event.target.value || null);
                setSelectedPoint(null);
                setSelectedInstrument(null);
              }}
            >
              {expiryOptions.length === 0 ? <option value="">{t('allExpiries')}</option> : null}
              {expiryOptions.map((expiry) => <option value={expiry} key={expiry}>{formatExpiry(expiry)}</option>)}
            </select>
          </label>
          <div className={styles.filterPicker} aria-label="Option type">
            {(['all', 'call', 'put'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                data-active={optionFilter === filter}
                onClick={() => setOptionFilter(filter)}
              >
                {filter === 'all' ? t('allOptions') : filter === 'call' ? t('calls') : t('puts')}
              </button>
            ))}
          </div>
          <div className={styles.rangePicker} aria-label={t('historyRange')}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                data-active={historyPreset === preset}
                onClick={() => onPresetChange(preset)}
              >
                {t(preset)}
              </button>
            ))}
          </div>
          {historyPreset === 'custom' ? (
            <DateRangePicker range={historyRange} bounds={historyBounds.data} onApply={onRangeChange} />
          ) : null}
        </div>
        <div className={styles.rangeMeta}>
          <span>{t('historyNote')}</span>
          <span>{dateWindow}</span>
        </div>
      </div>

      {!supportedRange ? (
        <div className={styles.inlineState} role="note">
          <strong>{t('rangeTooWide')}</strong><span>{t('rangeTooWideDetail')}</span>
        </div>
      ) : !instrumentsAvailable ? (
        <EmptyState title={t('storageNeeded')} detail={t('storageNeededDetail')} />
      ) : instrumentsQuery.isLoading ? (
        <div className={styles.loadingState}><Spinner size="lg" label={t('loading')} /></div>
      ) : instruments.length === 0 ? (
        <EmptyState title={t('noHistory')} detail={t('noHistoryDetail')} />
      ) : flowQuery.error ? (
        <EmptyState title={t('mapFailed')} detail={t('mapFailedDetail')} />
      ) : activeExpiry == null ? (
        <EmptyState title={t('noHistory')} detail={t('noHistoryDetail')} />
      ) : (
        <>
          <div className={styles.summaryGrid}>
            <SummaryCard label={t('trades')} value={flowSummary?.count.toLocaleString('en-US') ?? '…'} />
            <SummaryCard label={t('notional')} value={flowSummary ? formatMoney(flowSummary.notionalUsd) : '…'} />
            <SummaryCard
              label={t('netFlow')}
              value={flowSummary ? `${flowSummary.buyNotionalUsd >= flowSummary.sellNotionalUsd ? '+' : '−'}${formatMoney(Math.abs(flowSummary.buyNotionalUsd - flowSummary.sellNotionalUsd))}` : '…'}
              dataTone={flowSummary == null ? undefined : flowSummary.buyNotionalUsd >= flowSummary.sellNotionalUsd ? 'buy' : 'sell'}
            />
            <SummaryCard label={t('premium')} value={flowSummary ? formatMoney(flowSummary.premiumUsd) : '…'} />
            <SummaryCard label={t('dateWindow')} value={dateWindow} />
          </div>

          {flowQuery.isLoading && !flowMap ? (
            <div className={styles.loadingState}><Spinner size="lg" label={t('loading')} /></div>
          ) : !flowMap?.available ? (
            <EmptyState title={t('storageNeeded')} detail={t('storageNeededDetail')} />
          ) : (
            <>
              <div className={styles.mapGrid}>
                <FlowSpotChart
                  candles={candles}
                  points={flowMap.points}
                  range={historyRange}
                  resolution={resolution}
                  optionFilter={optionFilter}
                  selectedPoint={selectedPoint}
                  onSelectPoint={selectPoint}
                />
                <div className={styles.profileColumn}>
                  <FlowStrikeLadder
                    profile={profile}
                    optionFilter={optionFilter}
                    spot={lastSpot}
                    selectedInstrument={selectedInstrument}
                    onSelectInstrument={selectInstrument}
                  />
                  <FlowIvSmile
                    points={flowMap.ivPoints}
                    optionFilter={optionFilter}
                    range={historyRange}
                    selectedInstrument={selectedInstrument}
                    coverageComplete={flowMap.ivCoverageComplete}
                  />
                </div>
              </div>
              <div className={styles.detailGrid}>
                <section className={styles.detailPanel}>
                  {selectedPoint ? (
                    <>
                      <div className={styles.detailHeader}>
                        <div>
                          <h3>{t('executions')}</h3>
                          <span>
                            {t('selectedInterval', {
                              type: selectedPoint.optionType === 'call' ? t('c') : t('p'),
                              side: selectedPoint.side === 'buy' ? t('buy') : t('sell'),
                              time: new Date(selectedPoint.bucketTs).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }),
                            })}
                          </span>
                        </div>
                        <span>{t('showingPrints', { shown: pointTrades.length, total: selectedPoint.count })}</span>
                      </div>
                      <TradeRows
                        trades={pointTrades}
                        selectedInstrument={selectedInstrument}
                        onSelect={selectInstrument}
                        t={t}
                        tf={tf}
                      />
                      {pointTradeQuery.isFetching ? <span className={styles.tableMeta}>{t('loading')}</span> : null}
                      {pointTradeQuery.data?.trades.length === 200 ? (
                        <button
                          className={styles.moreButton}
                          type="button"
                          onClick={() => setPointCursor(pointTradeQuery.data?.nextCursor ?? null)}
                          disabled={pointTradeQuery.isFetching || pointTradeQuery.data.nextCursor == null}
                        >
                          {t('nextPage')}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className={styles.detailPrompt}>
                      <strong>{t('selectFlow')}</strong><span>{t('selectFlowDetail')}</span>
                    </div>
                  )}
                </section>
                <ContractDetail
                  instrument={selectedInstrument}
                  trades={contractTrades}
                  loading={contractQuery.isFetching}
                  t={t}
                  tf={tf}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, dataTone }: { label: string; value: string; dataTone?: 'buy' | 'sell' }) {
  return (
    <div className={styles.summaryCard}>
      <span>{label}</span>
      <strong data-tone={dataTone}>{value}</strong>
    </div>
  );
}

function TradeRows({
  trades,
  selectedInstrument,
  onSelect,
  t,
  tf,
}: {
  trades: TradeEvent[];
  selectedInstrument: string | null;
  onSelect: (instrument: string) => void;
  t: Translate<typeof messages.en>;
  tf: Translate<typeof flowMessages.en>;
}) {
  if (trades.length === 0) return <div className={styles.tableEmpty}>{t('noContractTrades')}</div>;
  return (
    <div className={styles.tradeTableWrap}>
      <div className={styles.tradeTable} role="table">
        <div className={styles.tradeTableHead} role="row">
          <span>{t('time')}</span><span>{t('side')}</span><span>{t('instrument')}</span><span>{t('size')}</span><span>{t('premiumUsd')}</span>
        </div>
        {trades.map((trade) => (
          <button
            className={styles.tradeRow}
            type="button"
            key={`${trade.tradeUid}-${trade.timestamp}`}
            data-selected={trade.instrument === selectedInstrument || undefined}
            onClick={() => onSelect(trade.instrument)}
          >
            <span>{formatTime(trade.timestamp)}</span>
            <span data-side={trade.side}>{trade.side === 'buy' ? tf('buy') : tf('sell')}</span>
            <span className={styles.instrumentCell}>{trade.instrument}</span>
            <span>{trade.size.toLocaleString('en-US')}</span>
            <span>{formatMoney(optionPremiumUsd(trade) ?? 0)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ContractDetail({
  instrument,
  trades,
  loading,
  t,
  tf,
}: {
  instrument: string | null;
  trades: TradeEvent[];
  loading: boolean;
  t: Translate<typeof messages.en>;
  tf: Translate<typeof flowMessages.en>;
}) {
  if (!instrument) {
    return (
      <section className={styles.detailPanel}>
        <div className={styles.detailPrompt}><strong>{t('selectContract')}</strong></div>
      </section>
    );
  }
  const priced = trades.flatMap((trade) => {
    const price = optionPremiumUsd(trade);
    return price == null ? [] : [{ trade, price }];
  });
  const last = priced.at(-1);
  const maxPrice = Math.max(0, ...priced.map((point) => point.price));
  const minPrice = Math.min(maxPrice, ...priced.map((point) => point.price));
  const range = Math.max(maxPrice - minPrice, maxPrice * 0.01, 0.0001);
  const line = priced
    .map(({ price }, index) => {
      const x = 18 + (index / Math.max(1, priced.length - 1)) * 564;
      const y = 116 - ((price - minPrice) / range) * 96;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div><h3>{t('contractHistory')}</h3><span className={styles.contractName}>{instrument}</span></div>
        <div className={styles.contractStats}>
          <span>{trades.length} {t('trades')}</span>
          <span>{last ? formatMoney(last.price) : '—'}</span>
          <span>{last?.trade.iv != null ? fmtIv(last.trade.iv) : '—'} {t('iv')}</span>
        </div>
      </div>
      {loading ? <div className={styles.contractLoading}><Spinner size="sm" /></div> : trades.length === 0 ? (
        <div className={styles.tableEmpty}>{t('noContractTrades')}</div>
      ) : (
        <>
          <div className={styles.contractChartHeading}>{t('price')}</div>
          <svg className={styles.contractChart} viewBox="0 0 600 140" role="img" aria-label={t('price')}>
            {[0, 1, 2].map((index) => {
              const y = 20 + index * 48;
              return <line key={index} x1="18" x2="582" y1={y} y2={y} className={styles.chartGrid} />;
            })}
            <path d={line} className={styles.contractLine} />
            {priced.map(({ trade, price }, index) => {
              const x = 18 + (index / Math.max(1, priced.length - 1)) * 564;
              const y = 116 - ((price - minPrice) / range) * 96;
              return <circle key={trade.tradeUid} cx={x} cy={y} r="3" className={styles.contractPoint} data-side={trade.side} />;
            })}
          </svg>
          <TradeRows
            trades={trades.slice().reverse().slice(0, 8)}
            selectedInstrument={instrument}
            onSelect={() => {}}
            t={t}
            tf={tf}
          />
        </>
      )}
    </section>
  );
}

function optionPremiumUsd(trade: TradeEvent): number | null {
  const price = trade.price;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (trade.venue !== 'deribit' && trade.venue !== 'okx') return price;
  const referencePrice = trade.referencePriceUsd;
  if (referencePrice == null || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  return price * referencePrice;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function formatDateWindow(range: HistoryRange): string {
  if (!range.start || !range.end) return '—';
  return `${formatDate(range.start)} → ${formatDate(range.end)}`;
}

function formatDate(value: string): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
