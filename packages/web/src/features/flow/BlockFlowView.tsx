import { useEffect, useMemo, useState } from 'react';

import { Spinner, EmptyState } from '@components/ui';
import { VENUES } from '@lib/venue-meta';
import { fmtUsd } from '@lib/format';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';
import { useBlockFlow, useBlockFlowHistoryPage, useBlockFlowHistorySummary } from './block-queries';
import type { BlockTradeEvent } from './block-queries';
import { getCustomRangeFromBounds } from './DateRangePicker';
import type { HistoryRange, TradeHistoryCursor } from './queries';
import { HistoryControls, type HistoryPreset } from './HistoryControls';
import StrategyIcon, { getStrategyLabel } from './StrategyIcon';
import { flowMessages } from './i18n';
import styles from './BlockFlowView.module.css';
import { FlowEvidencePanel, FlowLabels, FlowRowLabels } from './FlowEvidence';

const messages = defineMessages(
  {
    legSize: '{size} ct',
    legRatio: ' · ratio {ratio}',
    perContract: '{price} per contract',
    otc: 'OTC',
    mixed: 'MIXED LEGS',
    evidence: 'Evidence & OI',
    otcTitle: 'Negotiated off-exchange (Paradigm or bilateral) and printed on the venue tape',
    loadingBlocks: 'Loading block trades…',
    failedBlocks: 'Failed to load institutional trades',
    failedBlocksDetail:
      'Service may still be starting. Deribit and Bybit connect via WebSocket, OKX and Derive poll every 90s.',
    noStoredBlocks: 'No stored institutional trades in range',
    noBlocksYet: 'No institutional trades yet',
    noStoredBlocksDetail:
      'Try a wider date window, another venue selection, or let ingest collect more history.',
    noBlocksYetDetail:
      'RFQ, OTC and block trades will appear here as they execute across Deribit, OKX, Bybit, Binance, and Derive.',
  },
  {
    legSize: '{size} ct',
    legRatio: ' · ratio {ratio}',
    perContract: '{price} por contrato',
    otc: 'OTC',
    mixed: 'PATAS MIXTAS',
    evidence: 'Evidencia y OI',
    otcTitle: 'Negociado fuera del exchange (Paradigm o bilateral) e impreso en la cinta del venue',
    loadingBlocks: 'Cargando block trades…',
    failedBlocks: 'No se pudieron cargar los trades institucionales',
    failedBlocksDetail:
      'Es posible que el servicio aún se esté iniciando. Deribit y Bybit se conectan por WebSocket; OKX y Derive se consultan cada 90s.',
    noStoredBlocks: 'No hay trades institucionales guardados en el rango',
    noBlocksYet: 'Aún no hay trades institucionales',
    noStoredBlocksDetail:
      'Prueba un rango de fechas más amplio, otra selección de exchanges o deja que la ingesta reúna más historial.',
    noBlocksYetDetail:
      'Los trades RFQ, OTC y block aparecerán aquí a medida que se ejecuten en Deribit, OKX, Bybit, Binance y Derive.',
  },
);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

type FlowScope = 'tape' | 'history' | 'charts';

interface BlockFlowViewProps {
  scope: FlowScope;
  historyPreset: HistoryPreset;
  historyRange: HistoryRange;
  onPresetChange: (preset: HistoryPreset) => void;
  onRangeChange: (range: HistoryRange) => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function fmtUsdCompact(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(2)}M`;
  }
  if (n >= 1_000) {
    const thousands = n / 1_000;
    return `$${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
  }
  if (n >= 1) return `$${n.toFixed(0)}`;
  return '<$1';
}

function numDateToHuman(raw: string): string {
  const value = raw.length === 8 ? raw.slice(2) : raw;
  const yy = value.slice(0, 2);
  const mm = parseInt(value.slice(2, 4), 10);
  const dd = value.slice(4, 6);
  if (mm >= 1 && mm <= 12) return `${dd}${MONTHS[mm - 1]}${yy}`;
  return raw;
}

function parseLegInfo(instrument: string): { expiry: string; strike: string; type: string } {
  const parts = instrument.split('-');
  const option = instrument.match(/-(\d+(?:[._d]\d+)?)-([CP])(?:-|$)/);
  const type = option?.[2] === 'C' ? 'CALL' : option?.[2] === 'P' ? 'PUT' : '–';
  const strike = option?.[1] ? Number(option[1].replace(/[d_]/, '.')).toLocaleString() : '–';

  let expiry = '–';
  for (const part of parts) {
    if (/^\d{1,2}[A-Z]{3}\d{2}$/.test(part)) {
      expiry = part;
      break;
    }
    if (/^\d{6,8}$/.test(part) && Number(part) > 200000) {
      expiry = numDateToHuman(part);
      break;
    }
  }

  return { expiry, strike, type };
}

interface BlockTradeRowProps {
  trade: BlockTradeEvent;
  isExpanded: boolean;
  onToggle: () => void;
}

function BlockTradeRow({ trade, isExpanded, onToggle }: BlockTradeRowProps) {
  const t = useT(messages);
  const tf = useT(flowMessages);
  const locale = useLocale();
  const meta = VENUES[trade.venue];
  const isMultiLeg = trade.legs.length > 1;
  const firstLeg = trade.legs[0];
  const legInfo = firstLeg ? parseLegInfo(firstLeg.instrument) : null;
  const premiumUsd = trade.premiumUsd;
  const notionalUsd = trade.notionalUsd > 0 ? trade.notionalUsd : null;
  const isWhale = (notionalUsd ?? premiumUsd ?? 0) >= 100_000;
  const executionSide = trade.analysis?.executionSide ?? trade.direction;
  const structure = trade.analysis?.structure ?? trade.strategy;

  return (
    <div className={styles.tradeWrap}>
      <button
        className={styles.trade}
        data-side={executionSide}
        type="button"
        aria-expanded={isExpanded}
        data-whale={isWhale || undefined}
        onClick={onToggle}
      >
        <div className={styles.tradeMain}>
          <StrategyIcon strategy={structure ?? legInfo?.type ?? null} size={18} />

          <div className={styles.tradeInfo}>
            <div className={styles.tradeTop}>
              <span className={styles.strategy}>
                {getStrategyLabel(structure, legInfo?.type, locale)}
              </span>
              {isMultiLeg ? <span className={styles.legCount}>{trade.legs.length}L</span> : null}
              <span className={styles.side} data-side={executionSide}>
                {executionSide === 'mixed'
                  ? t('mixed')
                  : executionSide === 'buy'
                    ? tf('buy')
                    : tf('sell')}
              </span>
            </div>
            <div className={styles.tradeBottom}>
              {legInfo ? (
                <>
                  <span className={styles.expiry}>{legInfo.expiry}</span>
                  {!isMultiLeg ? <span className={styles.strike}>{legInfo.strike}</span> : null}
                  {!isMultiLeg ? (
                    <span className={styles.optType} data-type={legInfo.type}>
                      {legInfo.type}
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className={styles.tradeRight}>
            <span className={styles.notional} data-whale={isWhale || undefined}>
              {fmtUsdCompact(notionalUsd ?? premiumUsd)}
            </span>
            <span className={styles.notionalMeta}>
              {tf('premiumValue', { value: fmtUsdCompact(premiumUsd) })}
            </span>
            <div className={styles.tradeMeta}>
              <span className={styles.venue}>
                {meta?.logo ? <img src={meta.logo} className={styles.venueLogo} alt="" /> : null}
                {meta?.shortLabel ?? trade.venue}
              </span>
              {trade.source === 'otc' ? (
                <span className={styles.otcBadge} title={t('otcTitle')}>
                  {t('otc')}
                </span>
              ) : null}
              <span className={styles.time}>
                {formatDate(trade.timestamp)} {formatTime(trade.timestamp)}
              </span>
            </div>
          </div>

          <span className={styles.chevron} data-expanded={isExpanded} title={t('evidence')}>
            ›
          </span>
        </div>
      </button>

      <div className={styles.evidenceLabels}>
        {firstLeg ? <FlowRowLabels analysis={trade.analysis} target={{ mode: 'institutional', tradeUid: trade.tradeUid, venue: trade.venue, underlying: trade.underlying, instrument: firstLeg.instrument, timestamp: trade.timestamp }} /> : <FlowLabels analysis={trade.analysis} />}
      </div>

      {isExpanded && isMultiLeg ? (
        <div className={styles.legs}>
          {trade.legs.map((leg, index) => {
            const info = parseLegInfo(leg.instrument);
            return (
              <div key={index} className={styles.leg} data-side={leg.direction}>
                <span className={styles.legDir} data-side={leg.direction}>
                  {leg.direction === 'buy' ? tf('buy') : tf('sell')}
                </span>
                <span className={styles.legSize}>
                  {t('legSize', { size: leg.size })}
                  {leg.ratio > 1 ? t('legRatio', { ratio: leg.ratio }) : ''}
                </span>
                <span className={styles.legExpiry}>{info.expiry}</span>
                <span className={styles.legStrike}>{info.strike}</span>
                <span className={styles.legType} data-type={info.type}>
                  {info.type}
                </span>
                {leg.price > 0 ? (
                  <span className={styles.legPrices}>
                    <span className={styles.legPerContract}>
                      {t('perContract', { price: fmtUsd(leg.price) })}
                    </span>
                    <span className={styles.legTotal}>
                      {fmtUsd(leg.price * leg.size * leg.ratio)}
                    </span>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {isExpanded && firstLeg ? (
        <FlowEvidencePanel
          target={{
            mode: 'institutional',
            tradeUid: trade.tradeUid,
            venue: trade.venue,
            underlying: trade.underlying,
            instrument: firstLeg.instrument,
            timestamp: trade.timestamp,
          }}
        />
      ) : null}
    </div>
  );
}

export default function BlockFlowView({
  scope,
  historyPreset,
  historyRange,
  onPresetChange,
  onRangeChange,
}: BlockFlowViewProps) {
  const t = useT(messages);
  const tf = useT(flowMessages);
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data, isLoading, error } = useBlockFlow(underlying, scope === 'tape');
  const liveTrades = useMemo(
    () => (data?.trades ?? []).filter((trade) => activeVenues.includes(trade.venue)),
    [activeVenues, data?.trades],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyCursors, setHistoryCursors] = useState<Array<TradeHistoryCursor | null>>([null]);
  const pageCursor = historyCursors[historyCursors.length - 1] ?? null;
  const isHistoryRangeReady =
    historyPreset !== 'custom' || Boolean(historyRange.start && historyRange.end);
  const historyPage = useBlockFlowHistoryPage(
    {
      underlying,
      venues: activeVenues,
      range: historyRange,
      cursor: pageCursor,
      limit: 100,
    },
    scope === 'history' && isHistoryRangeReady,
  );
  const historySummary = useBlockFlowHistorySummary(
    underlying,
    activeVenues,
    historyRange,
    scope === 'history' && isHistoryRangeReady,
  );
  const historyBounds = useBlockFlowHistorySummary(
    underlying,
    activeVenues,
    { start: null, end: null },
    scope === 'history',
  );
  const historyTrades = historySummary.data?.count === 0 ? [] : (historyPage.data?.trades ?? []);
  const isCustomInitializing =
    historyPreset === 'custom' &&
    (!historyRange.start || !historyRange.end) &&
    (historyBounds.isLoading || historyBounds.isFetching);
  const isHistoryLoading =
    scope === 'history' &&
    (isCustomInitializing || historyPage.isLoading || historySummary.isLoading);
  const isHistoryEmpty =
    scope === 'history' && !isHistoryLoading && (historySummary.data?.count ?? 0) === 0;
  const trades = scope === 'history' ? historyTrades : liveTrades;

  useEffect(() => {
    setHistoryCursors([null]);
  }, [activeVenues, historyRange.end, historyRange.start, underlying]);

  useEffect(() => {
    if (historyPreset !== 'custom') return;
    if (historyRange.start && historyRange.end) return;
    const nextRange = getCustomRangeFromBounds(historyBounds.data);
    if (!nextRange.start || !nextRange.end) return;
    onRangeChange(nextRange);
  }, [historyBounds.data, historyPreset, historyRange.end, historyRange.start, onRangeChange]);

  function toggleTrade(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleNextPage() {
    if (!historyPage.data?.nextCursor) return;
    setHistoryCursors((prev) => [...prev, historyPage.data?.nextCursor ?? null]);
  }

  function handlePreviousPage() {
    setHistoryCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  if (isLoading) {
    return <Spinner size="lg" label={t('loadingBlocks')} />;
  }

  if (error) {
    return <EmptyState icon="⚠" title={t('failedBlocks')} detail={t('failedBlocksDetail')} />;
  }

  return (
    <>
      {scope === 'history' ? (
        <HistoryControls
          preset={historyPreset}
          range={historyRange}
          summary={historySummary.data}
          bounds={historyBounds.data}
          activeVenues={activeVenues}
          page={historyCursors.length}
          hasPreviousPage={historyCursors.length > 1}
          hasNextPage={Boolean(historyPage.data?.nextCursor)}
          isPageLoading={historyPage.isFetching}
          isSummaryLoading={
            historySummary.isLoading || historySummary.isFetching || !historySummary.data
          }
          onPresetChange={onPresetChange}
          onRangeChange={onRangeChange}
          onPreviousPage={handlePreviousPage}
          onNextPage={handleNextPage}
        />
      ) : null}

      {isHistoryLoading ? (
        <div className={styles.centeredState}>
          <Spinner size="lg" label={tf('loadingHistory')} />
        </div>
      ) : trades.length === 0 || isHistoryEmpty ? (
        <EmptyState
          title={scope === 'history' ? t('noStoredBlocks') : t('noBlocksYet')}
          detail={scope === 'history' ? t('noStoredBlocksDetail') : t('noBlocksYetDetail')}
        />
      ) : (
        <div className={styles.list}>
          {trades.map((trade) => (
            <BlockTradeRow
              key={trade.tradeUid}
              trade={trade}
              isExpanded={expanded.has(trade.tradeUid)}
              onToggle={() => toggleTrade(trade.tradeUid)}
            />
          ))}
        </div>
      )}
    </>
  );
}
