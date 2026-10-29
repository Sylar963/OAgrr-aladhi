import { useMemo, useState, useCallback, useEffect } from 'react';

import { useAppStore } from '@stores/app-store';
import { AssetPickerButton, DropdownPicker, VenuePickerButton } from '@components/ui';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import {
  useTradfiChain,
  useTradfiChainsForExpiries,
  useTradfiExpiries,
  useTradfiUnderlyings,
} from '@features/tradfi/queries';
import { mergeLiveBars } from '@features/tradfi/live-candle';
import { useTradfiUnderlyingCandles } from '@features/tradfi/use-tradfi-underlying-candles';
import {
  useTradfiUnderlyingCandlesLive,
  type LiveBar,
} from '@features/tradfi/use-tradfi-underlying-candles-live';
import { useChainWs } from '@hooks/useChainWs';
import { fmtUsd, formatExpiry, dteDays } from '@lib/format';
import { defineMessages, useLocale, useT, type Translate } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import {
  isSpotCandleUnderlying,
  type InstrumentCandleInterval,
  type InstrumentCandleRange,
  type ThesisGateLeg,
} from '@oggregator/protocol';
import type { EnrichedChainResponse, VenueId } from '@shared/enriched';
import { useStrategyStore } from './strategy-store';
import {
  computePayoff,
  computeMetrics,
  computeScenarioPayoff,
  detectStrategy,
  hedgePnlAtPrice,
  type HedgeLeg,
  type Leg,
} from './payoff';
import { deriveTenorColumns } from './ladder-geometry';
import {
  computeGhostPaths,
  buildFractalPathOnTimes,
  projectionTimesOnGrid,
  realizedVol,
  pathTexture,
  DEFAULT_IV,
  type GhostPath,
} from './ghost-paths';
import {
  listSnapshots,
  addSnapshot,
  removeSnapshot,
  type GhostSnapshot,
} from './snapshots-store';
import { debitSplit, spreadImpact } from './cost-impact';
import { openingCost, repriceLeg } from './reprice';
import { withPortfolioEntryPrice } from './portfolio-import';
import { STRATEGY_PARAM_KEYS, buildShareUrl, decodeStrategy } from './share';
import PayoffChart from './PayoffChart';
import PayoffChartV2, { pickCandleSpec } from './PayoffChartV2';
import PayoffChartV3 from './PayoffChartV3';
import { buildExpiryMarks, expiryTimeMs } from './expiry-timeline';
import { computeLongCallProfitFrontiers } from './profit-frontiers';
import SnapshotBanner from './SnapshotBanner';
import {
  hasUsableSpotCandles,
  isSpotCandleCurrency,
  useChainsForExpiries,
  useSpotCandles,
  type SpotCandlesResponse,
} from './queries';
import VenueSlideover from './VenueSlideover';
import type { StrategyRouting } from '@features/builder/round-trip';
import { legsToOrderRequest, useCreateTrade } from '@features/trading';
import { ThesisSection, useThesisGateState } from '@features/thesis';
import StrategyTemplates, {
  buildTemplateVariant,
  clearActiveTemplateDrag,
  findTemplateVariant,
} from './StrategyTemplates';
import LegInput from './LegInput';
import styles from './Architect.module.css';

const messages = defineMessages(
  {
    justNow: 'just now',
    minsAgo: '{n}m ago',
    hrsAgo: '{n}h ago',
    daysAgo: '{n}d ago',
    strike: 'Strike',
    expiry: 'Expiry',
    side: 'Side',
    buy: 'BUY',
    sell: 'SELL',
    done: 'Done',
    editLeg: 'Edit leg',
    removeLeg: 'Remove leg',
    bestRoute: 'Best route',
    oneVenue: '1 venue',
    nVenues: '{n} venues',
    only: 'Only',
    resolveThesis: 'Resolve the thesis gate first.',
    filledOn: 'Filled on {venue} - switching to Paper tab',
    paperFailed: 'Paper order failed',
    emptyUpstream: 'upstream returned empty data',
    builder: 'Builder',
    clear: 'Clear',
    compareVenues: 'Compare Venues',
    route: 'Route',
    noLegsQuoted: 'No legs have a quote on {venue}.',
    someLegsUnquoted: '{n} of {total} legs have no quote on {venue}.',
    pickAnotherVenue: 'Pick another venue or switch to Best route.',
    tradfiPaperOff: 'TradFi paper execution is not connected yet',
    sending: 'Sending…',
    sendToPaper: 'Send to paper',
    emptyLegs: 'Pick a template, add custom legs, or drag strikes on the chart.',
    dropToApply: 'Drop to apply strategy',
    dragHint: 'Drag a strategy here, or select from the templates above',
    titleV1: 'P&L at Expiry',
    titleV2: 'Live Spot vs Break-even Zones',
    titleV3: 'Lego Ladder',
    chartMeta: '{range} window · {interval} candles · tenor-led',
    atExpiry: 'At expiry',
    projectionsOn: 'Projections on',
    projectionsOff: 'Projections off',
    snapshot: '⎙ Snapshot',
    live: 'Live',
    metrics: 'Metrics',
    debit: 'Debit',
    credit: 'Credit',
    net: 'Net',
    maxProfit: 'Max Profit',
    maxLoss: 'Max Loss',
    breakeven: 'Breakeven',
    openingCost: 'Opening cost · {venue}',
    openAtMarket: 'At bid/ask',
    openAtMid: 'At mid',
    spreadCost: 'Spread cost',
    openMidFallback: '{n} leg(s) had no crossing quote and are priced at mid.',
    openUnquoted: '{n} leg(s) have no quote on this route and are left out.',
    debitSplit: '{back} of the {debit} debit comes back at expiry wherever {underlying} settles. At risk: {risk}.',
    spreadWarn:
      'Crossing the spread costs {cost}, {pct}% of the {mid} this makes at mid. Max profit after the spread: {after}. Closing before expiry costs about as much again.',
    spreadCantProfit:
      'Crossing the spread costs {cost}, all of the {mid} this makes at mid. At bid/ask it cannot make money.',
    spreadBestRoute: 'Best route spread: {cost}.',
    spreadWorkMid: 'Work the order near mid or use an RFQ.',
    closeSpread: 'Closing before expiry at bid/ask on this route costs {cost} in spread.',
    greeks: 'Greeks',
    legsReporting: '{n}/{total} legs reporting',
    scenarios: 'Scenarios',
    reset: 'Reset',
    frontierHint:
      'Move IV to draw a blue comparison path. Time decay runs left to right; both paths meet the expiry break-even.',
    share: 'Share',
    shareEmpty: 'Build a strategy to share',
    copied: 'Copied',
    copy: 'Copy',
    size: 'Size',
    entry: 'Entry',
    removeHedge: 'Remove hedge',
    editHedge: 'Edit hedge',
    hedgeSuffix: '{name} + perp hedge',
    perpOnly: 'Perp',
    hedgeDelta: 'Hedge Δ with perp',
    hedgeDeltaTitle: '{side} {size} perp at {price} to flatten net delta',
    hedgesNotRouted: 'Perp hedges count in the payoff and greeks but are not sent to paper or venue routing.',
  },
  {
    justNow: 'ahora',
    minsAgo: 'hace {n}m',
    hrsAgo: 'hace {n}h',
    daysAgo: 'hace {n}d',
    strike: 'Strike',
    expiry: 'Venc.',
    side: 'Lado',
    buy: 'COMPRA',
    sell: 'VENTA',
    done: 'Listo',
    editLeg: 'Editar pata',
    removeLeg: 'Quitar pata',
    bestRoute: 'Mejor ruta',
    oneVenue: '1 exchange',
    nVenues: '{n} exchanges',
    only: 'Solo',
    resolveThesis: 'Primero resuelve el filtro de tesis.',
    filledOn: 'Ejecutado en {venue} - cambiando a la pestaña Paper',
    paperFailed: 'La orden paper falló',
    emptyUpstream: 'la fuente devolvió datos vacíos',
    builder: 'Constructor',
    clear: 'Limpiar',
    compareVenues: 'Comparar exchanges',
    route: 'Ruta',
    noLegsQuoted: 'Ninguna pata tiene cotización en {venue}.',
    someLegsUnquoted: '{n} de {total} patas no tienen cotización en {venue}.',
    pickAnotherVenue: 'Elige otro exchange o cambia a Mejor ruta.',
    tradfiPaperOff: 'La ejecución paper de TradFi aún no está conectada',
    sending: 'Enviando…',
    sendToPaper: 'Enviar a paper',
    emptyLegs: 'Elige una plantilla, agrega patas personalizadas o arrastra strikes en el gráfico.',
    dropToApply: 'Suelta para aplicar la estrategia',
    dragHint: 'Arrastra una estrategia aquí o elige una de las plantillas de arriba',
    titleV1: 'P&L al vencimiento',
    titleV2: 'Spot en vivo vs zonas de breakeven',
    titleV3: 'Escalera Lego',
    chartMeta: 'ventana {range} · velas {interval} · según tenor',
    atExpiry: 'Al vencimiento',
    projectionsOn: 'Proyecciones: sí',
    projectionsOff: 'Proyecciones: no',
    snapshot: '⎙ Captura',
    live: 'En vivo',
    metrics: 'Métricas',
    debit: 'Débito',
    credit: 'Crédito',
    net: 'Neto',
    maxProfit: 'Ganancia máx.',
    maxLoss: 'Pérdida máx.',
    breakeven: 'Breakeven',
    openingCost: 'Costo de apertura · {venue}',
    openAtMarket: 'A bid/ask',
    openAtMid: 'A mid',
    spreadCost: 'Costo del spread',
    openMidFallback: '{n} pata(s) sin cotización cruzable, valoradas a mid.',
    openUnquoted: '{n} pata(s) sin cotización en esta ruta, excluidas.',
    debitSplit: '{back} del débito de {debit} vuelve al vencimiento, donde sea que cierre {underlying}. En riesgo: {risk}.',
    spreadWarn:
      'Cruzar el spread cuesta {cost}, el {pct}% de los {mid} que gana a mid. Ganancia máx. tras el spread: {after}. Cerrar antes del vencimiento cuesta otro tanto.',
    spreadCantProfit:
      'Cruzar el spread cuesta {cost}, todo lo que gana a mid ({mid}). A bid/ask no puede ganar.',
    spreadBestRoute: 'Spread con mejor ruta: {cost}.',
    spreadWorkMid: 'Trabaja la orden cerca de mid o usa un RFQ.',
    closeSpread: 'Cerrar antes del vencimiento a bid/ask en esta ruta cuesta {cost} de spread.',
    greeks: 'Greeks',
    legsReporting: '{n}/{total} patas reportando',
    scenarios: 'Escenarios',
    reset: 'Restablecer',
    frontierHint:
      'Mueve la IV para trazar una ruta de comparación azul. El decaimiento temporal va de izquierda a derecha; ambas rutas llegan al breakeven del vencimiento.',
    share: 'Compartir',
    shareEmpty: 'Arma una estrategia para compartir',
    copied: 'Copiado',
    copy: 'Copiar',
    size: 'Tamaño',
    entry: 'Entrada',
    removeHedge: 'Quitar cobertura',
    editHedge: 'Editar cobertura',
    hedgeSuffix: '{name} + cobertura perp',
    perpOnly: 'Perp',
    hedgeDelta: 'Cubrir Δ con perp',
    hedgeDeltaTitle: '{side} {size} perp a {price} para neutralizar el delta neto',
    hedgesNotRouted: 'Las coberturas perp cuentan en el payoff y las greeks, pero no se envían a paper ni al ruteo de exchanges.',
  },
);

type T = Translate<typeof messages.en>;

function formatAgo(ms: number, t: T): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return t('minsAgo', { n: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t('hrsAgo', { n: hrs });
  return t('daysAgo', { n: Math.round(hrs / 24) });
}

// ── Inline-editable leg row ──────────────────────────────────────────────────

interface LegRowProps {
  leg: Leg;
  allStrikes: number[];
  onRemove: () => void;
  onUpdate: (id: string, patch: Partial<Leg>) => void;
}

const BEST_ROUTE_VALUE = '__best-route__';

function OpenPremiumCard({ label, premium, t }: { label: string; premium: number; t: T }) {
  const side = premium < 0 ? t('debit') : premium > 0 ? t('credit') : t('net');
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricCardLabel}>
        {label} · {side}
      </span>
      <span
        className={styles.metricCardVal}
        data-positive={premium > 0 ? 'true' : undefined}
        data-negative={premium < 0 ? 'true' : undefined}
      >
        {fmtUsd(Math.abs(premium))}
      </span>
    </div>
  );
}
const TRADFI_VENUES = ['tastytrade'];

function tradfiCandleWindow(resolutionSec: number, buckets: number): {
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  resolutionSec: number;
} {
  const interval: InstrumentCandleInterval =
    resolutionSec <= 300
      ? '5m'
      : resolutionSec <= 1_800
        ? '15m'
        : resolutionSec <= 3_600
          ? '1h'
          : resolutionSec <= 14_400
            ? '4h'
            : '1d';
  const days = (resolutionSec * buckets) / 86_400;
  const range: InstrumentCandleRange =
    days <= 1 ? '1d' : days <= 7 ? '7d' : days <= 30 ? '30d' : 'max';
  const effectiveResolutionSec: Record<InstrumentCandleInterval, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3_600,
    '4h': 14_400,
    '1d': 86_400,
  };
  return { interval, range, resolutionSec: effectiveResolutionSec[interval] };
}

function chainMultiplier(chain: EnrichedChainResponse | null, leg: Leg): number | null {
  const side = chain?.strikes.find((s) => s.strike === leg.strike)?.[leg.type];
  const quote = side?.venues[leg.venue as VenueId] ?? Object.values(side?.venues ?? {})[0];
  return quote?.execution?.contractMultiplierBase ?? null;
}

function resolveBuilderExpiry(preferredExpiry: string, expiries: string[]): string {
  if (preferredExpiry && expiries.includes(preferredExpiry)) return preferredExpiry;

  const viableExpiry = expiries.find((entry) => dteDays(entry) >= 3);
  return viableExpiry ?? expiries[1] ?? expiries[0] ?? '';
}

function LegRow({ leg, allStrikes, onRemove, onUpdate }: LegRowProps) {
  const t = useT(messages);
  const [editing, setEditing] = useState(false);

  function stepStrike(delta: number) {
    const sorted = [...allStrikes].sort((a, b) => a - b);
    const idx = sorted.indexOf(leg.strike);
    if (idx < 0) return;
    const next = sorted[idx + delta];
    if (next != null) onUpdate(leg.id, { strike: next });
  }

  function toggleDirection() {
    onUpdate(leg.id, { direction: leg.direction === 'buy' ? 'sell' : 'buy' });
  }

  function toggleType() {
    onUpdate(leg.id, { type: leg.type === 'call' ? 'put' : 'call' });
  }

  if (editing) {
    return (
      <div className={styles.legRowEditing}>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>{t('strike')}</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(-1)}>
            −
          </button>
          <span className={styles.legStepVal}>{leg.strike.toLocaleString()}</span>
          <button className={styles.legStepBtn} onClick={() => stepStrike(1)}>
            +
          </button>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>{t('expiry')}</span>
          <span className={styles.legStepVal}>{formatExpiry(leg.expiry)}</span>
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>{t('side')}</span>
          <button
            className={styles.legStepBtn}
            onClick={toggleDirection}
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {leg.direction === 'buy' ? t('buy') : t('sell')}
          </button>
          <button
            className={styles.legStepBtn}
            onClick={toggleType}
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {leg.type === 'call' ? 'CALL' : 'PUT'}
          </button>
          <div className={styles.legEditActions}>
            <button className={styles.legEditSave} onClick={() => setEditing(false)}>
              {t('done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.legRow} data-direction={leg.direction}>
      <span className={styles.legDirection} data-direction={leg.direction}>
        {leg.direction === 'buy' ? t('buy') : t('sell')}
      </span>
      <span className={styles.legQty}>{leg.quantity}×</span>
      <span className={styles.legStrike}>{leg.strike.toLocaleString()}</span>
      <span className={styles.legType} data-type={leg.type}>
        {leg.type === 'call' ? 'C' : 'P'}
      </span>
      <span className={styles.legExpiry}>{formatExpiry(leg.expiry)}</span>
      <span className={styles.legPrice}>{fmtUsd(leg.entryPrice)}</span>
      <button className={styles.legEditBtn} onClick={() => setEditing(true)} title={t('editLeg')}>
        ✎
      </button>
      <button className={styles.legRemove} onClick={onRemove} title={t('removeLeg')}>
        ×
      </button>
    </div>
  );
}

interface HedgeRowProps {
  hedge: HedgeLeg;
  spotPrice: number;
  onRemove: () => void;
  onUpdate: (id: string, patch: Partial<HedgeLeg>) => void;
}

function parsePositive(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Capped at 4 decimals: fmtUsd prints 6 below $0.01, which overflows the leg grid.
function fmtHedgePnl(pnl: number): string {
  const abs = Math.abs(pnl);
  return `${pnl < 0 ? '−' : '+'}${abs >= 1 ? fmtUsd(abs) : `$${abs.toFixed(4)}`}`;
}

function HedgeRow({ hedge, spotPrice, onRemove, onUpdate }: HedgeRowProps) {
  const t = useT(messages);
  const [editing, setEditing] = useState(false);
  const [sizeInput, setSizeInput] = useState(String(hedge.quantity));
  const [entryInput, setEntryInput] = useState(String(hedge.entryPrice));
  const pnl = spotPrice > 0 ? hedgePnlAtPrice([hedge], spotPrice) : null;
  const typeLabel = hedge.kind === 'future' ? 'FUT' : 'PERP';

  if (editing) {
    return (
      <div className={styles.legRowEditing}>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>{t('size')}</span>
          <input
            type="text"
            inputMode="decimal"
            className={styles.legInputField}
            value={sizeInput}
            onChange={(e) => {
              setSizeInput(e.target.value);
              const quantity = parsePositive(e.target.value);
              if (quantity != null) onUpdate(hedge.id, { quantity });
            }}
            style={{ width: 76 }}
          />
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>{t('entry')}</span>
          <input
            type="text"
            inputMode="decimal"
            className={styles.legInputField}
            value={entryInput}
            onChange={(e) => {
              setEntryInput(e.target.value);
              const entryPrice = parsePositive(e.target.value);
              if (entryPrice != null) onUpdate(hedge.id, { entryPrice });
            }}
            style={{ width: 90 }}
          />
        </div>
        <div className={styles.legEditRow}>
          <span className={styles.legEditLabel}>{t('side')}</span>
          <button
            className={styles.legStepBtn}
            onClick={() =>
              onUpdate(hedge.id, { direction: hedge.direction === 'buy' ? 'sell' : 'buy' })
            }
            style={{ width: 'auto', padding: '0 6px' }}
          >
            {hedge.direction === 'buy' ? t('buy') : t('sell')}
          </button>
          <div className={styles.legEditActions}>
            <button className={styles.legEditSave} onClick={() => setEditing(false)}>
              {t('done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.legRow} data-direction={hedge.direction} data-hedge="true">
      <span className={styles.legDirection} data-direction={hedge.direction}>
        {hedge.direction === 'buy' ? t('buy') : t('sell')}
      </span>
      <span className={styles.legQty}>{hedge.quantity}×</span>
      <span className={styles.legStrike} title={`${t('entry')} ${fmtUsd(hedge.entryPrice)}`}>
        {hedge.entryPrice.toLocaleString(undefined, {
          maximumFractionDigits: hedge.entryPrice >= 1000 ? 0 : 3,
        })}
      </span>
      <span className={styles.legType} data-type="perp" title={hedge.instrumentName}>
        {typeLabel}
      </span>
      <span
        className={styles.legPrice}
        data-positive={pnl != null && pnl > 0 ? 'true' : undefined}
        data-negative={pnl != null && pnl < 0 ? 'true' : undefined}
      >
        {pnl != null ? fmtHedgePnl(pnl) : '–'}
      </span>
      <button
        className={styles.legEditBtn}
        onClick={() => {
          setSizeInput(String(hedge.quantity));
          setEntryInput(String(hedge.entryPrice));
          setEditing(true);
        }}
        title={t('editHedge')}
      >
        ✎
      </button>
      <button className={styles.legRemove} onClick={onRemove} title={t('removeHedge')}>
        ×
      </button>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

interface ArchitectViewProps {
  market?: 'crypto' | 'tradfi';
}

export default function ArchitectView({ market = 'crypto' }: ArchitectViewProps) {
  const t = useT(messages);
  const locale = useLocale();
  const cryptoUnderlying = useAppStore((s) => s.underlying);
  const cryptoExpiry = useAppStore((s) => s.expiry);
  const cryptoVenues = useAppStore((s) => s.activeVenues);
  const tradfiUnderlying = useAppStore((s) => s.tradfiUnderlying);
  const tradfiExpiry = useAppStore((s) => s.tradfiExpiry);
  const setTradfiUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const underlying = market === 'tradfi' ? tradfiUnderlying : cryptoUnderlying;
  const globalExpiry = market === 'tradfi' ? tradfiExpiry : cryptoExpiry;
  const activeVenues = market === 'tradfi' ? TRADFI_VENUES : cryptoVenues;
  const { data: cryptoExpiriesData } = useExpiries(market === 'crypto' ? underlying : '');
  const { data: tradfiExpiriesData } = useTradfiExpiries(market === 'tradfi' ? underlying : '');
  const { data: tradfiUnderlyingsData } = useTradfiUnderlyings(market === 'tradfi');
  const allExpiries = useMemo(
    () =>
      market === 'tradfi'
        ? (tradfiExpiriesData?.expiries ?? [])
        : (cryptoExpiriesData?.expiries ?? []),
    [cryptoExpiriesData, market, tradfiExpiriesData],
  );
  const tradfiUnderlyings = tradfiUnderlyingsData?.underlyings ?? [];
  const [builderExpiry, setBuilderExpiry] = useState('');

  useEffect(() => {
    if (
      market === 'tradfi' &&
      tradfiUnderlyings.length > 0 &&
      !tradfiUnderlyings.includes(underlying)
    ) {
      setTradfiUnderlying(tradfiUnderlyings[0]!);
    }
  }, [market, setTradfiUnderlying, tradfiUnderlyings, underlying]);

  useEffect(() => {
    const nextExpiry = resolveBuilderExpiry(builderExpiry || globalExpiry, allExpiries);
    if (nextExpiry && nextExpiry !== builderExpiry) {
      setBuilderExpiry(nextExpiry);
    }
  }, [allExpiries, builderExpiry, globalExpiry, underlying]);

  const { connectionState: builderFeedState } = useChainWs({
    underlying,
    expiry: builderExpiry,
    venues: activeVenues,
    enabled: market === 'crypto' && Boolean(builderExpiry),
  });
  const { data: cryptoChain } = useChainQuery(underlying, builderExpiry, activeVenues, {
    enabled: market === 'crypto' && builderFeedState !== 'live',
  });
  const { data: tradfiChain } = useTradfiChain(
    market === 'tradfi' ? underlying : '',
    market === 'tradfi' ? builderExpiry : '',
  );
  const chain = market === 'tradfi' ? tradfiChain : cryptoChain;

  const legs = useStrategyStore((s) => s.legs);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const removeLeg = useStrategyStore((s) => s.removeLeg);
  const updateLeg = useStrategyStore((s) => s.updateLeg);
  const addLeg = useStrategyStore((s) => s.addLeg);
  const hedges = useStrategyStore((s) => s.hedges);
  const addHedge = useStrategyStore((s) => s.addHedge);
  const removeHedge = useStrategyStore((s) => s.removeHedge);
  const updateHedge = useStrategyStore((s) => s.updateHedge);
  const strategyUnderlying = useStrategyStore((s) => s.underlying);
  const hasPosition = legs.length > 0 || hedges.length > 0;

  useEffect(() => {
    if (strategyUnderlying && strategyUnderlying !== underlying && hasPosition) {
      clearLegs();
    }
  }, [clearLegs, hasPosition, strategyUnderlying, underlying]);

  const [showVenues, setShowVenues] = useState(false);
  const [ivShift, setIvShift] = useState(0);
  const [dteShift, setDteShift] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [paperStatus, setPaperStatus] = useState<string | null>(null);
  const [routeVenue, setRouteVenue] = useState(BEST_ROUTE_VALUE);
  const variant = useAppStore((s) => s.builderVariant);
  const setVariant = useAppStore((s) => s.setBuilderVariant);
  const [lastGoodSpotCandles, setLastGoodSpotCandles] = useState<{
    data: SpotCandlesResponse;
    dataUpdatedAt: number;
  } | null>(null);

  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const createTrade = useCreateTrade();

  useEffect(() => {
    if (routeVenue !== BEST_ROUTE_VALUE && !activeVenues.includes(routeVenue)) {
      setRouteVenue(BEST_ROUTE_VALUE);
    }
  }, [activeVenues, routeVenue]);

  const pricingVenues = useMemo(
    () => (routeVenue === BEST_ROUTE_VALUE ? activeVenues : [routeVenue]),
    [routeVenue, activeVenues],
  );

  // ── Tenor axis (V3 lego ladder) ──────────────────────────────────────────
  // Legs can live on different expiries; the ladder shows them as columns.
  const legExpiries = useMemo(
    () => Array.from(new Set(legs.map((l) => l.expiry).filter(Boolean))),
    [legs],
  );
  const tenorColumns = useMemo(
    () => deriveTenorColumns(allExpiries, legExpiries, builderExpiry),
    [allExpiries, legExpiries, builderExpiry],
  );
  // Chains beyond the live builder expiry: every leg's own tenor (pricing
  // correctness in all variants) plus, while V3 is up, the visible columns
  // (so a block dropped on any column reprices instantly). REST-only — the
  // WS subscription stays on builderExpiry.
  const extraExpiries = useMemo(() => {
    const wanted = new Set(legExpiries);
    if (variant === 'v3') for (const tenor of tenorColumns) wanted.add(tenor);
    wanted.delete(builderExpiry);
    return [...wanted].filter((e) => allExpiries.includes(e));
  }, [legExpiries, tenorColumns, builderExpiry, variant, allExpiries]);
  const cryptoExtraChains = useChainsForExpiries(
    underlying,
    market === 'crypto' ? extraExpiries : [],
    activeVenues,
  );
  const tradfiExtraChains = useTradfiChainsForExpiries(
    underlying,
    market === 'tradfi' ? extraExpiries : [],
  );
  const extraChains = market === 'tradfi' ? tradfiExtraChains : cryptoExtraChains;
  const chainFor = useCallback(
    (expiry: string) => (expiry === builderExpiry ? chain ?? null : extraChains[expiry] ?? null),
    [builderExpiry, chain, extraChains],
  );

  const unroutableLegs = useMemo(() => {
    if (routeVenue === BEST_ROUTE_VALUE || legs.length === 0) return [];
    return legs.filter((leg) => {
      const tenorChain = chainFor(leg.expiry || builderExpiry);
      if (!tenorChain) return false; // chain still loading — don't flag yet
      return (
        repriceLeg(
          tenorChain,
          [routeVenue],
          {
            type: leg.type,
            direction: leg.direction,
            strike: leg.strike,
            expiry: leg.expiry || builderExpiry,
            quantity: leg.quantity,
          },
          { exactStrike: true },
        ) == null
      );
    });
  }, [routeVenue, legs, chainFor, builderExpiry]);

  const routeOptions = useMemo(
    () => [
      {
        value: BEST_ROUTE_VALUE,
        label: t('bestRoute'),
        meta:
          activeVenues.length === 1
            ? VENUES[activeVenues[0] ?? '']?.label ?? t('oneVenue')
            : t('nVenues', { n: activeVenues.length }),
      },
      ...activeVenues.flatMap((venueId) => {
        const venue = VENUES[venueId];
        return venue ? [{ value: venue.id, label: venue.label, meta: t('only') }] : [];
      }),
    ],
    [activeVenues, t],
  );

  async function handleSendToPaper(routing?: StrategyRouting) {
    if (market === 'tradfi' || pricedLegs.length === 0) return;
    if (thesisGated) {
      setPaperStatus(t('resolveThesis'));
      return;
    }
    setPaperStatus(null);
    try {
      const req = legsToOrderRequest(pricedLegs, underlying, pricingVenues, routing);
      const strategyName = detectStrategy(pricedLegs);
      const result = await createTrade.mutateAsync({
        label: strategyName,
        strategyName,
        order: req,
      });
      const filledVenues = Array.from(new Set(result.fills.map((fill) => fill.venue)));
      const fillSummary =
        filledVenues.length === 1
          ? VENUES[filledVenues[0] ?? '']?.label ?? filledVenues[0]
          : t('nVenues', { n: filledVenues.length });
      setPaperStatus(t('filledOn', { venue: fillSummary ?? '' }));
      setShowVenues(false);
      setTimeout(() => setActiveTab('trading'), 400);
    } catch (err) {
      setPaperStatus(err instanceof Error ? err.message : t('paperFailed'));
    }
  }

  useEffect(() => {
    setBuilderError(null);
  }, [activeVenues, builderExpiry, underlying]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const decoded = decodeStrategy(params);
    if (!decoded) return;

    clearLegs();
    for (const leg of decoded.legs) addLeg(leg, decoded.underlying);
    for (const hedge of decoded.hedges) addHedge(hedge, decoded.underlying);
    if (decoded.legs[0]) setBuilderExpiry(decoded.legs[0].expiry);

    for (const k of STRATEGY_PARAM_KEYS) params.delete(k);
    const clean = params.toString();
    window.history.replaceState({}, '', clean ? `?${clean}` : window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const spotPrice = chain?.stats.forwardPriceUsd ?? chain?.stats.indexPriceUsd ?? 0;
  // Perps track the index, not the option forward.
  const perpReferencePrice = chain?.stats.indexPriceUsd ?? spotPrice;
  const availableStrikes = useMemo(() => chain?.strikes.map((s) => s.strike) ?? [], [chain]);

  const repriceStrategyLeg = useCallback(
    (leg: Leg, patch: Partial<Leg> = {}, exactStrike = false) => {
      // Each leg prices against its OWN tenor's chain — legs can live on
      // different expiries now that the ladder has a tenor axis. A missing
      // chain (still loading) returns null so the stored pricing holds.
      const targetExpiry = patch.expiry ?? leg.expiry ?? builderExpiry;
      const tenorChain = chainFor(targetExpiry);
      if (!tenorChain || !targetExpiry) return null;

      return repriceLeg(
        tenorChain,
        pricingVenues,
        {
          type: patch.type ?? leg.type,
          direction: patch.direction ?? leg.direction,
          strike: patch.strike ?? leg.strike,
          expiry: targetExpiry,
          quantity: patch.quantity ?? leg.quantity,
        },
        { exactStrike },
      );
    },
    [pricingVenues, builderExpiry, chainFor],
  );

  const handleLegUpdate = useCallback(
    (legId: string, patch: Partial<Leg>) => {
      const leg = legs.find((entry) => entry.id === legId);
      if (!leg) return;

      // exactStrike:false — strike edits originate from the BUILDER expiry's
      // grid (ladder rungs, LegRow stepper) but commit against the leg's OWN
      // tenor's chain; when the grids differ an exact lookup misses and the
      // edit would silently revert. Nearest-snap is identical whenever the
      // strike exists on the leg's grid.
      const repriced = repriceStrategyLeg(leg, patch, false);
      if (!repriced) return;

      updateLeg(legId, repriced);
    },
    [legs, repriceStrategyLeg, updateLeg],
  );

  const handleLegStrikeDrag = useCallback(
    (legId: string, newStrike: number) => {
      handleLegUpdate(legId, { strike: newStrike });
    },
    [handleLegUpdate],
  );

  const handleLegTenorDrag = useCallback(
    (legId: string, newExpiry: string, strike: number) => {
      const leg = legs.find((entry) => entry.id === legId);
      if (!leg) return;
      // Strike grids differ across tenors — snap to the target tenor's nearest
      // strike (exactStrike: false) while repricing on its chain.
      const repriced = repriceStrategyLeg(leg, { expiry: newExpiry, strike }, false);
      if (!repriced) return;
      updateLeg(legId, repriced);
      // Follow the drop: the builder's selected tenor (expiry dropdown, live WS
      // feed, highlighted column, rung grid) moves to where the leg landed.
      setBuilderExpiry(newExpiry);
    },
    [legs, repriceStrategyLeg, updateLeg],
  );

  const handleAddLegAtStrike = useCallback(
    (
      strike: number,
      type: 'call' | 'put',
      direction: 'buy' | 'sell',
      quantity: number,
      expiry?: string,
    ) => {
      const targetExpiry = expiry ?? builderExpiry;
      const tenorChain = chainFor(targetExpiry);
      if (!tenorChain || !targetExpiry) return;
      const repriced = repriceLeg(
        tenorChain,
        pricingVenues,
        { type, direction, strike, expiry: targetExpiry, quantity },
        { exactStrike: false },
      );
      if (!repriced) return;
      addLeg(repriced, underlying);
    },
    [chainFor, pricingVenues, builderExpiry, addLeg, underlying],
  );

  const handleRemoveLeg = useCallback((legId: string) => removeLeg(legId), [removeLeg]);

  const pricedLegs = useMemo(
    () =>
      legs.map((leg) => {
        const repriced = repriceStrategyLeg(leg, {}, leg.portfolioEntryPrice != null);
        return repriced ? { ...leg, ...repriced } : leg;
      }),
    [legs, repriceStrategyLeg],
  );
  const analyticsLegs = useMemo(
    () =>
      market === 'tradfi'
        ? pricedLegs.map((leg) => ({
            ...withPortfolioEntryPrice(leg),
            contractMultiplier: chainMultiplier(chainFor(leg.expiry), leg) ?? 100,
          }))
        : pricedLegs.map(withPortfolioEntryPrice),
    [market, pricedLegs, chainFor],
  );

  const payoffPoints = useMemo(
    () => computePayoff(analyticsLegs, spotPrice, undefined, hedges),
    [analyticsLegs, spotPrice, hedges],
  );
  const metrics = useMemo(
    () => (hasPosition ? computeMetrics(analyticsLegs, spotPrice, hedges) : null),
    [analyticsLegs, spotPrice, hedges, hasPosition],
  );
  const openCost = useMemo(
    () => (analyticsLegs.length > 0 ? openingCost(analyticsLegs, chainFor, pricingVenues) : null),
    [analyticsLegs, chainFor, pricingVenues],
  );
  const routeLabel =
    routeVenue === BEST_ROUTE_VALUE ? t('bestRoute') : (VENUES[routeVenue]?.label ?? routeVenue);
  // Held legs already paid their opening spread; what's left is the spread to close early.
  const heldBook = analyticsLegs.length > 0 && analyticsLegs.every((l) => l.portfolioEntryPrice != null);
  const tradeBeingBuilt = analyticsLegs.length > 0 && analyticsLegs.every((l) => l.portfolioEntryPrice == null);
  const spreadRisk = useMemo(
    () =>
      tradeBeingBuilt && openCost && metrics && openCost.unquotedLegs === 0
        ? spreadImpact(metrics.maxProfit, openCost.spreadCost)
        : null,
    [tradeBeingBuilt, openCost, metrics],
  );
  const bestRouteSpread = useMemo(() => {
    if (!spreadRisk || spreadRisk.severity === 'ok' || routeVenue === BEST_ROUTE_VALUE) return null;
    const best = openingCost(analyticsLegs, chainFor, activeVenues);
    return best.unquotedLegs === 0 && best.spreadCost < spreadRisk.spreadCost - 0.005
      ? best.spreadCost
      : null;
  }, [spreadRisk, routeVenue, analyticsLegs, chainFor, activeVenues]);
  const closeSpreadCost = useMemo(() => {
    if (!heldBook) return null;
    const closing = analyticsLegs.map((l) => ({
      ...l,
      direction: l.direction === 'buy' ? ('sell' as const) : ('buy' as const),
    }));
    const cost = openingCost(closing, chainFor, pricingVenues);
    return cost.unquotedLegs === 0 && cost.spreadCost > 0 ? cost.spreadCost : null;
  }, [heldBook, analyticsLegs, chainFor, pricingVenues]);
  const debitBreakdown = metrics ? debitSplit(metrics.netDebit, metrics.maxLoss) : null;
  const strategyName = useMemo(() => {
    if (pricedLegs.length === 0) return t('perpOnly');
    const name = detectStrategy(pricedLegs);
    return hedges.length > 0 ? t('hedgeSuffix', { name }) : name;
  }, [pricedLegs, hedges.length, t]);

  // Rounded to the delta display precision so the hedge lands on 0.000.
  const deltaHedge = useMemo(() => {
    const netDelta = metrics?.netDelta;
    if (market !== 'crypto' || legs.length === 0 || netDelta == null || !(perpReferencePrice > 0)) {
      return null;
    }
    const quantity = Math.round(Math.abs(netDelta) * 1000) / 1000;
    if (quantity === 0) return null;
    return { direction: netDelta > 0 ? ('sell' as const) : ('buy' as const), quantity };
  }, [legs.length, market, metrics?.netDelta, perpReferencePrice]);

  const handleDeltaHedge = useCallback(() => {
    if (!deltaHedge) return;
    addHedge({ kind: 'perpetual', ...deltaHedge, entryPrice: perpReferencePrice }, underlying);
  }, [addHedge, deltaHedge, perpReferencePrice, underlying]);

  const thesisEnabled = market !== 'tradfi' && isSpotCandleUnderlying(underlying);
  const thesisLegs = useMemo((): ThesisGateLeg[] | null => {
    if (!thesisEnabled) return null;
    const gateLegs = pricedLegs.flatMap((leg): ThesisGateLeg[] =>
      /^\d{4}-\d{2}-\d{2}$/.test(leg.expiry) && leg.strike > 0 && leg.quantity > 0
        ? [
            {
              expiry: leg.expiry,
              strike: leg.strike,
              optionRight: leg.type,
              side: leg.direction,
              size: leg.quantity * (leg.contractMultiplier ?? 1),
              premiumUsd: Math.max(0, leg.entryPrice),
              iv: leg.iv != null && leg.iv > 0 ? leg.iv : null,
            },
          ]
        : [],
    );
    return gateLegs.length > 0 ? gateLegs.slice(0, 40) : null;
  }, [pricedLegs, thesisEnabled]);
  const thesisState = useThesisGateState(underlying, thesisLegs);
  const thesisGated = thesisEnabled && thesisState.gated;
  const nearestLegExpiry = thesisLegs?.map((leg) => leg.expiry).sort()[0] ?? null;

  const baseDte = useMemo(() => {
    if (pricedLegs.length === 0) return 30;
    return dteDays(pricedLegs[0]!.expiry);
  }, [pricedLegs]);

  const scenarioIvPoints = useMemo(() => {
    if (analyticsLegs.length === 0 || ivShift === 0) return undefined;
    return computeScenarioPayoff(
      analyticsLegs,
      spotPrice,
      ivShift / 100,
      0,
      baseDte,
      undefined,
      hedges,
    );
  }, [analyticsLegs, baseDte, ivShift, spotPrice, hedges]);

  const scenarioDtePoints = useMemo(() => {
    if (analyticsLegs.length === 0 || dteShift === 0) return undefined;
    return computeScenarioPayoff(
      analyticsLegs,
      spotPrice,
      0,
      dteShift,
      baseDte,
      undefined,
      hedges,
    );
  }, [analyticsLegs, baseDte, dteShift, spotPrice, hedges]);

  const hasScenarios = ivShift !== 0 || dteShift !== 0;

  const candleSpec = useMemo(() => pickCandleSpec(pricedLegs), [pricedLegs]);
  const tradfiCandleSpec = useMemo(
    () => tradfiCandleWindow(candleSpec.resolutionSec, candleSpec.buckets),
    [candleSpec.buckets, candleSpec.resolutionSec],
  );
  const cryptoSpotCandles = useSpotCandles(
    market === 'crypto' ? underlying : '',
    candleSpec.resolutionSec,
    candleSpec.buckets,
    candleSpec.refetchIntervalMs,
  );
  const tradfiSpotCandles = useTradfiUnderlyingCandles({
    underlying,
    interval: tradfiCandleSpec.interval,
    range: tradfiCandleSpec.range,
    enabled: market === 'tradfi',
  });
  const tradfiLiveKey = `${underlying}:${tradfiCandleSpec.interval}`;
  const [tradfiLiveState, setTradfiLiveState] = useState<{
    key: string;
    bars: LiveBar[];
    updatedAt: number;
  }>({ key: '', bars: [], updatedAt: 0 });
  const handleTradfiLiveBar = useCallback(
    (bar: LiveBar) => {
      setTradfiLiveState((previous) => {
        const bars = previous.key === tradfiLiveKey ? previous.bars : [];
        const next = [...bars.filter((candidate) => candidate.ts !== bar.ts), bar]
          .sort((a, b) => a.ts - b.ts)
          .slice(-4);
        return { key: tradfiLiveKey, bars: next, updatedAt: Date.now() };
      });
    },
    [tradfiLiveKey],
  );
  useTradfiUnderlyingCandlesLive({
    underlying,
    interval: tradfiCandleSpec.interval,
    enabled: market === 'tradfi' && variant === 'v2',
    onBar: handleTradfiLiveBar,
  });
  const activeTradfiLiveBars =
    tradfiLiveState.key === tradfiLiveKey ? tradfiLiveState.bars : [];
  const normalizedTradfiSpotCandles = useMemo<SpotCandlesResponse | undefined>(() => {
    if (!tradfiSpotCandles.data && activeTradfiLiveBars.length === 0) return undefined;
    const history =
      tradfiSpotCandles.data?.candles.map((candle) => ({
        timestamp: candle.ts,
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
      })) ?? [];
    const candles = mergeLiveBars(history, activeTradfiLiveBars);
    return {
      currency: underlying,
      resolution: tradfiCandleSpec.resolutionSec,
      count: candles.length,
      candles,
    };
  }, [activeTradfiLiveBars, tradfiCandleSpec.resolutionSec, tradfiSpotCandles.data, underlying]);
  const spotCandlesData =
    market === 'tradfi' ? normalizedTradfiSpotCandles : cryptoSpotCandles.data;
  const spotCandlesUpdatedAt =
    market === 'tradfi'
      ? Math.max(tradfiSpotCandles.dataUpdatedAt, tradfiLiveState.updatedAt)
      : cryptoSpotCandles.dataUpdatedAt;
  const spotCandlesLoading =
    market === 'tradfi' ? tradfiSpotCandles.isLoading : cryptoSpotCandles.isLoading;
  const spotCandlesFetching =
    market === 'tradfi' ? tradfiSpotCandles.isFetching : cryptoSpotCandles.isFetching;
  const spotCandlesIsPlaceholderData =
    market === 'tradfi'
      ? tradfiSpotCandles.isPlaceholderData
      : cryptoSpotCandles.isPlaceholderData;
  const spotCandlesIsError =
    market === 'tradfi' ? tradfiSpotCandles.isError : cryptoSpotCandles.isError;
  const spotCandlesError = market === 'tradfi' ? tradfiSpotCandles.error : cryptoSpotCandles.error;
  const refetchSpotCandles =
    market === 'tradfi' ? tradfiSpotCandles.refetch : cryptoSpotCandles.refetch;
  const candleAvailable = market === 'tradfi' || isSpotCandleCurrency(underlying);
  const candleResolutionSec =
    market === 'tradfi' ? tradfiCandleSpec.resolutionSec : candleSpec.resolutionSec;
  const candleRangeLabel =
    market === 'tradfi' ? tradfiCandleSpec.range.toUpperCase() : candleSpec.rangeLabel;
  const candleIntervalLabel =
    market === 'tradfi' ? tradfiCandleSpec.interval.toUpperCase() : candleSpec.intervalLabel;
  const spotCandlesEmpty = spotCandlesData != null && spotCandlesData.candles.length === 0;
  const spotCandlesFailureMessage =
    spotCandlesEmpty
      ? t('emptyUpstream')
      : spotCandlesError instanceof Error
        ? spotCandlesError.message
        : null;

  useEffect(() => {
    if (hasUsableSpotCandles(spotCandlesData)) {
      setLastGoodSpotCandles({ data: spotCandlesData, dataUpdatedAt: spotCandlesUpdatedAt });
    }
  }, [spotCandlesData, spotCandlesUpdatedAt]);

  useEffect(() => {
    setLastGoodSpotCandles(null);
  }, [underlying]);

  const visibleSpotCandles = hasUsableSpotCandles(spotCandlesData)
    ? spotCandlesData
    : lastGoodSpotCandles?.data ?? null;
  const visibleSpotCandlesUpdatedAt = hasUsableSpotCandles(spotCandlesData)
    ? spotCandlesUpdatedAt
    : lastGoodSpotCandles?.dataUpdatedAt ?? 0;
  const hasVisibleSpotCandles = hasUsableSpotCandles(visibleSpotCandles);
  const spotCandlesUnavailable = spotCandlesIsError || (spotCandlesEmpty && !spotCandlesFetching);

  const [showProjections, setShowProjections] = useState(true);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<GhostSnapshot[]>(() => listSnapshots(underlying));

  useEffect(() => {
    setSnapshots(listSnapshots(underlying));
    setSelectedSnapshotId(null);
  }, [underlying]);

  // Anchor the projection at the last real candle's bucket (grid-aligned).
  const projectionBucketMs = candleResolutionSec * 1000;
  const lastBarMs =
    visibleSpotCandles?.candles.at(-1)?.timestamp ??
    Math.floor(Date.now() / projectionBucketMs) * projectionBucketMs;

  const nearestExpiryMs = useMemo(() => {
    const expiries = pricedLegs.map((l) => l.expiry).filter(Boolean);
    if (expiries.length === 0) return Number.NaN;
    const earliest = expiries.reduce((a, b) => (a < b ? a : b));
    return expiryTimeMs(earliest, market);
  }, [market, pricedLegs]);

  const expiryKey = [...new Set(pricedLegs.map((l) => l.expiry))].sort().join(',');
  const expiryMarks = useMemo(
    () => buildExpiryMarks(expiryKey ? expiryKey.split(',') : [], market, Date.now(), locale),
    // lastBarMs advances once per candle, which keeps the time-left labels fresh.
    [expiryKey, market, lastBarMs, locale],
  );

  const liveGhostPaths = useMemo(
    () =>
      computeGhostPaths(
        analyticsLegs,
        spotPrice,
        nearestExpiryMs,
        lastBarMs,
        candleResolutionSec,
        visibleSpotCandles?.candles ?? [],
        hedges,
      ),
    [
      analyticsLegs,
      hedges,
      spotPrice,
      nearestExpiryMs,
      lastBarMs,
      candleResolutionSec,
      visibleSpotCandles?.candles,
    ],
  );

  const profitFrontiers = useMemo(
    () =>
      computeLongCallProfitFrontiers(
        analyticsLegs,
        lastBarMs,
        nearestExpiryMs,
        candleResolutionSec,
        ivShift,
      ),
    [legs, candleResolutionSec, ivShift, lastBarMs, nearestExpiryMs],
  );

  const selectedSnapshot = useMemo(
    () => snapshots.find((s) => s.id === selectedSnapshotId) ?? null,
    [snapshots, selectedSnapshotId],
  );

  // A selected snapshot replaces the live projection, rebuilt at its original
  // anchor on the chart's current bar grid.
  const realCandles = visibleSpotCandles?.candles;
  const snapshotGhostPaths: GhostPath[] = useMemo(() => {
    if (!selectedSnapshot) return [];
    const times = projectionTimesOnGrid(
      selectedSnapshot.createdAt,
      selectedSnapshot.expiryMs,
      candleResolutionSec,
      (realCandles ?? []).map((c) => c.timestamp),
    );
    const textureVol =
      selectedSnapshot.textureVol ??
      realizedVol(realCandles ?? [], candleResolutionSec) ??
      DEFAULT_IV;
    return selectedSnapshot.paths.map((p) => ({
      kind: p.kind,
      isProfit: p.isProfit,
      targetPrice: p.targetPrice,
      pnlAtExpiry: p.pnlAtExpiry,
      shape: p.shape ?? [],
      textureVol,
      candles: buildFractalPathOnTimes(
        selectedSnapshot.spotAtSnapshot,
        p.targetPrice,
        selectedSnapshot.createdAt,
        selectedSnapshot.expiryMs,
        times,
        p.shape ?? [],
        pathTexture(p.kind, textureVol, selectedSnapshot.createdAt),
      ),
    }));
  }, [selectedSnapshot, candleResolutionSec, realCandles]);

  const activeGhostPaths = selectedSnapshot ? snapshotGhostPaths : liveGhostPaths;
  const liveBreakevens = metrics?.breakevens;
  const ghostBreakevens = useMemo(
    () => (selectedSnapshot ? selectedSnapshot.breakevens : liveBreakevens) ?? [],
    [selectedSnapshot, liveBreakevens],
  );
  const ghostExpiryMs = selectedSnapshot?.expiryMs ?? nearestExpiryMs;

  const snapshotMeta = useMemo(
    () => (selectedSnapshot ? { agoLabel: formatAgo(selectedSnapshot.createdAt, t) } : null),
    [selectedSnapshot, t],
  );

  const handleSnapshot = useCallback(() => {
    if (liveGhostPaths.length === 0 || !Number.isFinite(nearestExpiryMs)) return;
    const snap: GhostSnapshot = {
      id: crypto.randomUUID(),
      createdAt: lastBarMs,
      underlying,
      structureLabel: detectStrategy(pricedLegs),
      spotAtSnapshot: spotPrice,
      expiryMs: nearestExpiryMs,
      resolutionSec: candleResolutionSec,
      breakevens: metrics?.breakevens ?? [],
      textureVol: liveGhostPaths[0]!.textureVol,
      paths: liveGhostPaths.map((p) => ({
        kind: p.kind,
        isProfit: p.isProfit,
        targetPrice: p.targetPrice,
        pnlAtExpiry: p.pnlAtExpiry,
        shape: p.shape,
      })),
    };
    setSnapshots(addSnapshot(snap));
  }, [
    liveGhostPaths,
    nearestExpiryMs,
    lastBarMs,
    underlying,
    pricedLegs,
    spotPrice,
    candleResolutionSec,
    metrics?.breakevens,
  ]);

  function handleCopyUrl() {
    const url = buildShareUrl(
      pricedLegs,
      hedges,
      underlying,
      market === 'tradfi' ? `#tradfi/builder/${underlying}` : `#builder/${underlying}`,
    );
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const dragged = findTemplateVariant(
      e.dataTransfer.getData('application/x-oggregator-strategy') ||
        e.dataTransfer.getData('text/plain'),
    );
    clearActiveTemplateDrag();
    if (!dragged) return;

    const result = buildTemplateVariant(
      chain ?? null,
      builderExpiry,
      dragged.template,
      dragged.variant,
      locale,
    );
    if (!result.ok) {
      setBuilderError(result.error.message);
      return;
    }

    setBuilderError(null);
    // Drop appends — drags are how the user composes a custom multi-leg
    // strategy (e.g. straddle + put spread). Click-to-apply on the card
    // still replaces, since that gesture means "use this template".
    for (const leg of result.legs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.view} data-market={market}>
      <div className={styles.mainArea}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{t('builder')}</span>
            {market === 'tradfi' ? (
              <DropdownPicker
                size="sm"
                value={underlying}
                onChange={setTradfiUnderlying}
                options={tradfiUnderlyings.map((ticker) => ({
                  value: ticker,
                  label: ticker,
                  meta: 'US',
                }))}
              />
            ) : (
              <AssetPickerButton />
            )}
            <VenuePickerButton
              {...(market === 'tradfi'
                ? {
                    venueIds: TRADFI_VENUES,
                    activeVenueIds: TRADFI_VENUES,
                    label: 'Tastytrade',
                    readOnly: true,
                  }
                : {})}
            />
          </div>
        </div>

        <StrategyTemplates
          chain={chain ?? null}
          expiry={builderExpiry}
          underlying={underlying}
          errorMessage={builderError}
          onErrorMessageChange={setBuilderError}
        />

        <div className={styles.splitBody}>
          <div className={styles.controlsCol}>
            <LegInput
              chain={chain ?? null}
              expiry={builderExpiry}
              expiries={allExpiries}
              underlying={underlying}
              activeVenues={activeVenues}
              allowPerp={market === 'crypto'}
              onExpiryChange={setBuilderExpiry}
            />

            {hasPosition && (
              <div className={styles.legsSection}>
                <div className={styles.legsSectionHeader}>
                  <span className={styles.strategyName}>{strategyName}</span>
                  <button className={styles.clearBtn} onClick={clearLegs}>
                    {t('clear')}
                  </button>
                </div>

                <div className={styles.legsList}>
                  {legs.map((leg) => (
                    <LegRow
                      key={leg.id}
                      leg={leg}
                      // The leg's own tenor's grid — strikes differ per expiry,
                      // and stepping along the wrong grid dead-ends the stepper.
                      allStrikes={
                        chainFor(leg.expiry)?.strikes.map((s) => s.strike) ?? availableStrikes
                      }
                      onRemove={() => removeLeg(leg.id)}
                      onUpdate={handleLegUpdate}
                    />
                  ))}
                  {hedges.map((hedge) => (
                    <HedgeRow
                      key={hedge.id}
                      hedge={hedge}
                      spotPrice={perpReferencePrice}
                      onRemove={() => removeHedge(hedge.id)}
                      onUpdate={updateHedge}
                    />
                  ))}
                </div>
                {hedges.length > 0 && legs.length > 0 && (
                  <div className={styles.greeksPartial}>{t('hedgesNotRouted')}</div>
                )}
              </div>
            )}

            {legs.length > 0 && (
              <button className={styles.compareBtn} onClick={() => setShowVenues(true)}>
                {t('compareVenues')}
              </button>
            )}

            {legs.length > 0 && (
              <div className={styles.paperTradeControls}>
                <span className={styles.paperTradeLabel}>{t('route')}</span>
                <DropdownPicker
                  options={routeOptions}
                  value={routeVenue}
                  onChange={setRouteVenue}
                />
                {unroutableLegs.length > 0 && (
                  <div className={styles.routeUnroutable}>
                    {unroutableLegs.length === legs.length
                      ? t('noLegsQuoted', { venue: VENUES[routeVenue]?.label ?? routeVenue })
                      : t('someLegsUnquoted', {
                          n: unroutableLegs.length,
                          total: legs.length,
                          venue: VENUES[routeVenue]?.label ?? routeVenue,
                        })}{' '}
                    {t('pickAnotherVenue')}
                  </div>
                )}
              </div>
            )}

            {legs.length > 0 && (
              <button
                className={styles.compareBtn}
                onClick={() => handleSendToPaper()}
                disabled={market === 'tradfi' || createTrade.isPending || thesisGated}
                title={
                  market === 'tradfi'
                    ? t('tradfiPaperOff')
                    : thesisGated
                      ? t('resolveThesis')
                      : undefined
                }
                style={{ marginTop: 8 }}
              >
                {createTrade.isPending ? t('sending') : t('sendToPaper')}
              </button>
            )}

            {paperStatus && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                {paperStatus}
              </div>
            )}

            {!hasPosition && (
              <div className={styles.emptyLegs}>
                {t('emptyLegs')}
              </div>
            )}
          </div>

          <div className={styles.chartCol}>
            <div
              className={`${styles.chartPanel} ${dragOver ? styles.chartPanelDragOver : ''}`}
              data-variant={variant}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {/* V3 stays mounted when empty: its ladder is the empty state
                  (click a rung to place the first leg). V1/V2 keep the ghost. */}
              {!hasPosition && variant !== 'v3' ? (
                <div className={styles.chartEmpty}>
                  <svg
                    className={styles.ghostChart}
                    viewBox="0 0 200 100"
                    preserveAspectRatio="none"
                  >
                    {[20, 40, 60, 80].map((y) => (
                      <line
                        key={`h${y}`}
                        x1="0"
                        y1={y}
                        x2="200"
                        y2={y}
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        opacity="0.4"
                      />
                    ))}
                    {[40, 80, 120, 160].map((x) => (
                      <line
                        key={`v${x}`}
                        x1={x}
                        y1="0"
                        x2={x}
                        y2="100"
                        stroke="var(--border-subtle)"
                        strokeWidth="0.5"
                        opacity="0.4"
                      />
                    ))}
                    <line
                      x1="0"
                      y1="50"
                      x2="200"
                      y2="50"
                      stroke="var(--text-dim)"
                      strokeWidth="0.8"
                      strokeDasharray="4 3"
                      opacity="0.3"
                    />
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 140 35 L 200 35"
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeWidth="1.5"
                      opacity="0.12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M 0 65 L 60 65 L 100 50 L 100 50 L 60 50 L 0 50 Z"
                      fill="var(--color-loss)"
                      opacity="0.03"
                    />
                    <path
                      d="M 100 50 L 140 35 L 200 35 L 200 50 L 100 50 Z"
                      fill="var(--color-profit)"
                      opacity="0.03"
                    />
                  </svg>
                  <div className={styles.chartDropHint}>
                    <span className={styles.chartDropIcon}>{dragOver ? '+' : '↕'}</span>
                    <span className={styles.chartDropText}>
                      {dragOver
                        ? t('dropToApply')
                        : t('dragHint')}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  {thesisEnabled && (
                    <ThesisSection
                      underlying={underlying}
                      state={thesisState}
                      expiryOptions={allExpiries}
                      breakevens={metrics?.breakevens ?? []}
                      spotUsd={spotPrice}
                      nearestExpiry={nearestLegExpiry}
                    />
                  )}
                  <div className={styles.chartTitleRow}>
                    <div className={styles.chartTitleBlock}>
                      <div className={styles.chartTitle}>
                        {variant === 'v1'
                          ? t('titleV1')
                          : variant === 'v2'
                            ? t('titleV2')
                            : t('titleV3')}
                      </div>
                      {variant === 'v2' && (
                        <div className={styles.chartTitleMeta}>
                          {t('chartMeta', {
                            range: candleRangeLabel,
                            interval: candleIntervalLabel,
                          })}
                        </div>
                      )}
                    </div>
                    <div className={styles.variantToggle}>
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v1'}
                        data-variant="v1"
                        onClick={() => setVariant('v1')}
                      >
                        V1
                      </button>
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v2'}
                        data-variant="v2"
                        onClick={() => setVariant('v2')}
                      >
                        V2
                      </button>
                      <button
                        className={styles.variantBtn}
                        data-active={variant === 'v3'}
                        data-variant="v3"
                        onClick={() => setVariant('v3')}
                      >
                        V3
                      </button>
                    </div>
                  </div>

                  {variant === 'v1' ? (
                    <>
                      <PayoffChart
                        points={payoffPoints}
                        breakevens={metrics?.breakevens ?? []}
                        spotPrice={spotPrice}
                        legs={analyticsLegs}
                        maxProfit={metrics?.maxProfit ?? null}
                        maxLoss={metrics?.maxLoss ?? null}
                        strikes={availableStrikes}
                        onLegStrikeDrag={handleLegStrikeDrag}
                        scenarioIvPoints={scenarioIvPoints}
                        scenarioDtePoints={scenarioDtePoints}
                      />
                      {hasScenarios && (
                        <div className={styles.scenarioLegend}>
                          <span className={styles.legendItem}>
                            <span className={`${styles.legendDot} ${styles.legendDotBase}`} />
                            <span className={styles.legendLabel}>{t('atExpiry')}</span>
                          </span>
                          {ivShift !== 0 && (
                            <span className={styles.legendItem}>
                              <span className={`${styles.legendDot} ${styles.legendDotIv}`} />
                              <span className={styles.legendLabel}>
                                IV {ivShift > 0 ? '+' : ''}
                                {ivShift}%
                              </span>
                            </span>
                          )}
                          {dteShift !== 0 && (
                            <span className={styles.legendItem}>
                              <span className={`${styles.legendDot} ${styles.legendDotDte}`} />
                              <span className={styles.legendLabel}>
                                {dteShift > 0 ? '+' : ''}
                                {dteShift}d DTE
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : variant === 'v2' ? (
                    <>
                      {candleAvailable && (
                        <SnapshotBanner
                          dataUpdatedAt={visibleSpotCandlesUpdatedAt}
                          hasData={hasVisibleSpotCandles}
                          isFetching={spotCandlesFetching}
                          windowLabel={candleRangeLabel}
                          intervalLabel={candleIntervalLabel}
                          isSwitchingWindow={spotCandlesIsPlaceholderData && hasVisibleSpotCandles}
                          isError={spotCandlesUnavailable}
                          errorMessage={spotCandlesFailureMessage}
                          isEmpty={spotCandlesEmpty && !hasVisibleSpotCandles}
                          onRetry={() => {
                            void refetchSpotCandles();
                          }}
                        />
                      )}
                      <div className={styles.projControls}>
                        <button
                          className={styles.projToggle}
                          data-active={showProjections}
                          onClick={() => setShowProjections((v) => !v)}
                        >
                          {showProjections ? t('projectionsOn') : t('projectionsOff')}
                        </button>
                        <button
                          className={styles.projSnapBtn}
                          onClick={handleSnapshot}
                          disabled={liveGhostPaths.length === 0 || thesisGated}
                          title={thesisGated ? t('resolveThesis') : undefined}
                        >
                          {t('snapshot')}
                        </button>
                        {snapshots.length > 0 && (
                          <select
                            className={styles.projSnapSelect}
                            value={selectedSnapshotId ?? ''}
                            onChange={(e) => setSelectedSnapshotId(e.target.value || null)}
                          >
                            <option value="">{t('live')}</option>
                            {snapshots.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.structureLabel} · {formatAgo(s.createdAt, t)}
                              </option>
                            ))}
                          </select>
                        )}
                        {selectedSnapshot && (
                          <button
                            className={styles.projSnapDel}
                            onClick={() => {
                              setSnapshots(removeSnapshot(selectedSnapshot.id));
                              setSelectedSnapshotId(null);
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <PayoffChartV2
                        candles={visibleSpotCandles?.candles ?? []}
                        breakevens={metrics?.breakevens ?? []}
                        spotPrice={spotPrice}
                        legs={analyticsLegs}
                        hedges={hedges}
                        resolutionSec={candleResolutionSec}
                        loading={spotCandlesLoading && candleAvailable}
                        available={candleAvailable}
                        onSwitchToV1={() => setVariant('v1')}
                        ghostPaths={activeGhostPaths}
                        ghostBreakevens={ghostBreakevens}
                        ghostExpiryMs={ghostExpiryMs}
                        showProjections={showProjections}
                        snapshotMeta={snapshotMeta}
                        projectionKey={`${market}:${underlying}:${selectedSnapshotId ?? 'live'}:${nearestExpiryMs}:${candleResolutionSec}`}
                        profitFrontiers={profitFrontiers}
                        expiryMarks={expiryMarks}
                        invalidationLevel={thesisEnabled ? thesisState.invalidationLevel : null}
                      />
                    </>
                  ) : (
                    <PayoffChartV3
                      points={payoffPoints}
                      breakevens={metrics?.breakevens ?? []}
                      spotPrice={spotPrice}
                      legs={pricedLegs}
                      hedges={hedges}
                      netDebit={metrics?.netDebit ?? 0}
                      strikes={availableStrikes}
                      tenors={tenorColumns}
                      activeTenor={builderExpiry}
                      candles={candleAvailable ? (visibleSpotCandles?.candles ?? []) : []}
                      candleIntervalLabel={candleIntervalLabel}
                      onLegStrikeDrag={handleLegStrikeDrag}
                      onLegTenorDrag={handleLegTenorDrag}
                      onAddLegAtStrike={handleAddLegAtStrike}
                      onRemoveLeg={handleRemoveLeg}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className={styles.rightCol}>
            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>{t('metrics')}</span>
              <div className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>
                    {metrics
                      ? metrics.netDebit < 0
                        ? t('debit')
                        : metrics.netDebit > 0
                          ? t('credit')
                          : t('net')
                      : t('net')}
                  </span>
                  <span
                    className={styles.metricCardVal}
                    data-positive={metrics ? metrics.netDebit > 0 : undefined}
                    data-negative={metrics ? metrics.netDebit < 0 : undefined}
                  >
                    {metrics ? fmtUsd(Math.abs(metrics.netDebit)) : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>{t('maxProfit')}</span>
                  <span
                    className={styles.metricCardVal}
                    data-positive={metrics ? 'true' : undefined}
                  >
                    {metrics ? (metrics.maxProfit != null ? fmtUsd(metrics.maxProfit) : '∞') : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>{t('maxLoss')}</span>
                  <span
                    className={styles.metricCardVal}
                    data-negative={metrics ? 'true' : undefined}
                  >
                    {metrics ? (metrics.maxLoss != null ? fmtUsd(metrics.maxLoss) : '∞') : '–'}
                  </span>
                </div>
                <div className={styles.metricCard}>
                  <span className={styles.metricCardLabel}>{t('breakeven')}</span>
                  <span className={styles.metricCardVal}>
                    {metrics && metrics.breakevens.length > 0
                      ? metrics.breakevens.map((b) => fmtUsd(b)).join(', ')
                      : '–'}
                  </span>
                </div>
              </div>
              {debitBreakdown && (
                <span className={styles.greeksPartial}>
                  {t('debitSplit', {
                    back: fmtUsd(debitBreakdown.guaranteedBack),
                    debit: fmtUsd(debitBreakdown.debit),
                    underlying,
                    risk: fmtUsd(debitBreakdown.atRisk),
                  })}
                </span>
              )}
              {openCost && (
                <>
                  <span className={styles.metricsSubTitle}>
                    {t('openingCost', { venue: routeLabel })}
                  </span>
                  <div className={styles.metricsGrid}>
                    <OpenPremiumCard
                      label={t('openAtMarket')}
                      premium={openCost.netPremiumAtMarket}
                      t={t}
                    />
                    <OpenPremiumCard label={t('openAtMid')} premium={openCost.netPremiumAtMid} t={t} />
                    <div className={`${styles.metricCard} ${styles.metricCardWide}`}>
                      <span className={styles.metricCardLabel}>{t('spreadCost')}</span>
                      <span
                        className={styles.metricCardVal}
                        data-negative={openCost.spreadCost > 0 ? 'true' : undefined}
                      >
                        {fmtUsd(openCost.spreadCost)}
                      </span>
                    </div>
                  </div>
                  {openCost.midFallbackLegs > 0 && (
                    <span className={styles.greeksPartial}>
                      {t('openMidFallback', { n: openCost.midFallbackLegs })}
                    </span>
                  )}
                  {openCost.unquotedLegs > 0 && (
                    <span className={styles.greeksPartial}>
                      {t('openUnquoted', { n: openCost.unquotedLegs })}
                    </span>
                  )}
                  {spreadRisk && spreadRisk.severity !== 'ok' && (
                    <div className={styles.spreadWarning} data-severity={spreadRisk.severity}>
                      {spreadRisk.maxProfitAfterSpread <= 0
                        ? t('spreadCantProfit', {
                            cost: fmtUsd(spreadRisk.spreadCost),
                            mid: fmtUsd(spreadRisk.maxProfitAtMid),
                          })
                        : t('spreadWarn', {
                            cost: fmtUsd(spreadRisk.spreadCost),
                            pct: Math.round(spreadRisk.share * 100),
                            mid: fmtUsd(spreadRisk.maxProfitAtMid),
                            after: fmtUsd(spreadRisk.maxProfitAfterSpread),
                          })}{' '}
                      {bestRouteSpread != null
                        ? t('spreadBestRoute', { cost: fmtUsd(bestRouteSpread) })
                        : t('spreadWorkMid')}
                    </div>
                  )}
                  {closeSpreadCost != null && (
                    <span className={styles.greeksPartial}>
                      {t('closeSpread', { cost: fmtUsd(closeSpreadCost) })}
                    </span>
                  )}
                </>
              )}
            </div>

            <div
              className={styles.rightSection}
              data-partial={metrics ? metrics.greeksMissingLegs > 0 : undefined}
            >
              <span className={styles.rightSectionTitle}>{t('greeks')}</span>
              <div className={styles.greeksGrid}>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Δ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netDelta?.toFixed(3) ?? '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Γ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netGamma?.toFixed(5) ?? '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>Θ</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netTheta != null ? fmtUsd(metrics.netTheta) : '–'}
                  </span>
                </div>
                <div className={styles.greekCard}>
                  <span className={styles.greekCardLabel}>V</span>
                  <span className={styles.greekCardVal}>
                    {metrics?.netVega != null ? fmtUsd(metrics.netVega) : '–'}
                  </span>
                </div>
              </div>
              {metrics && metrics.greeksMissingLegs > 0 && (
                <span className={styles.greeksPartial}>
                  {t('legsReporting', {
                    n: legs.length - metrics.greeksMissingLegs,
                    total: legs.length,
                  })}
                </span>
              )}
              {deltaHedge && (
                <button
                  className={styles.hedgeDeltaBtn}
                  onClick={handleDeltaHedge}
                  title={t('hedgeDeltaTitle', {
                    side: deltaHedge.direction === 'buy' ? t('buy') : t('sell'),
                    size: deltaHedge.quantity,
                    price: fmtUsd(perpReferencePrice),
                  })}
                >
                  {t('hedgeDelta')} · {deltaHedge.direction === 'buy' ? '+' : '−'}
                  {deltaHedge.quantity}
                </button>
              )}
            </div>

            <div className={styles.rightSection}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span className={styles.rightSectionTitle}>{t('scenarios')}</span>
                {hasScenarios && (
                  <button
                    className={styles.sliderReset}
                    onClick={() => {
                      setIvShift(0);
                      setDteShift(0);
                    }}
                  >
                    {t('reset')}
                  </button>
                )}
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>IV</span>
                <div className={styles.sliderWrap}>
                  <input
                    type="range"
                    className={styles.sliderInput}
                    data-kind="iv"
                    min={-30}
                    max={30}
                    step={1}
                    value={ivShift}
                    onChange={(e) => setIvShift(Number(e.target.value))}
                    disabled={legs.length === 0}
                  />
                </div>
                <span className={styles.sliderValue}>
                  {ivShift > 0 ? '+' : ''}
                  {ivShift}%
                </span>
              </div>

              {variant === 'v2' ? (
                <div className={styles.frontierHint}>
                  {t('frontierHint')}
                </div>
              ) : (
                <div className={styles.sliderRow}>
                  <span className={styles.sliderLabel}>DTE</span>
                  <div className={styles.sliderWrap}>
                    <input
                      type="range"
                      className={styles.sliderInput}
                      data-kind="dte"
                      min={-Math.min(baseDte, 60)}
                      max={60}
                      step={1}
                      value={dteShift}
                      onChange={(e) => setDteShift(Number(e.target.value))}
                      disabled={legs.length === 0}
                    />
                  </div>
                  <span className={styles.sliderValue}>
                    {dteShift > 0 ? '+' : ''}
                    {dteShift}d
                  </span>
                </div>
              )}
            </div>

            <div className={styles.rightSection}>
              <span className={styles.rightSectionTitle}>{t('share')}</span>
              <div className={styles.shareBar}>
                <span className={styles.shareUrl}>
                  {hasPosition
                    ? buildShareUrl(
                        pricedLegs,
                        hedges,
                        underlying,
                        market === 'tradfi'
                          ? `#tradfi/builder/${underlying}`
                          : `#builder/${underlying}`,
                      )
                    : t('shareEmpty')}
                </span>
                {hasPosition &&
                  (copied ? (
                    <span className={styles.shareCopied}>{t('copied')}</span>
                  ) : (
                    <button className={styles.shareBtn} onClick={handleCopyUrl}>
                      {t('copy')}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showVenues && (
        <>
          <div className={styles.backdrop} onClick={() => setShowVenues(false)} />
          <VenueSlideover
            legs={analyticsLegs}
            chain={chain ?? null}
            chainFor={chainFor}
            activeVenues={pricingVenues}
            onClose={() => setShowVenues(false)}
            {...(market === 'crypto'
              ? { onSendToPaper: (routing: StrategyRouting) => handleSendToPaper(routing) }
              : {})}
            isSending={createTrade.isPending}
          />
        </>
      )}
    </div>
  );
}
