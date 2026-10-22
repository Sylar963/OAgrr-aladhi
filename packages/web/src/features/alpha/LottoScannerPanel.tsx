import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaLottoCandidate,
  type AlphaLottoScannerResponse,
  type AlphaLottoTarget,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import HoverTooltip from '@components/ui/HoverTooltip';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtDelta, fmtIv, fmtPct, fmtStrike, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import LottoOutcomeBuilder from './LottoOutcomeBuilder';
import { candidateToBuilderLeg } from './radar-builder';
import { useLottoScanner } from './useLottoScanner';
import styles from './LottoScannerPanel.module.css';

const PREMIUM_PRESETS = [100, 200, 400, 500] as const;
const OTM_PRESETS = [5, 8, 10, 15] as const;
const GUIDED_MIN_DTE = 15;
const GUIDED_MAX_DTE = 75;
const GUIDED_PREMIUM_CAP = 10_000;
const GUIDED_SCANNER_BUYING_POWER = 2_400;
const ADVANCED_MIN_DTE = 15;
const ADVANCED_MAX_DTE = 45;
const ADVANCED_MAX_SPREAD_PCT = 30;
type ScannerView = 'guided' | 'advanced';

const messages = defineMessages(
  {
    tipMark: 'The sticker price used to filter the board. Your real buy-in is the ask, which can be higher.',
    tipOtm: 'How far the market must climb just to touch the strike. Farther out means a cheaper long shot, but a harder hit.',
    tipBankroll: 'Your total bankroll for sizing. The scanner shows what fits; it never places an order.',
    tipPrice: 'MARK is the table estimate. ASK is the quoted price before taker fees.',
    tipVolatility: 'IV is how much movement the option market is pricing in. Higher IV usually means a more expensive bet.',
    tipBreakeven:
      "OTM is the climb to the strike. BE uses the current ask plus the estimated taker fee when available. The odds are the risk-neutral chance of finishing above BE at expiry, from the option's own IV.",
    tipTarget:
      'The move that makes the option worth 10× your ask-paid entry if it lands halfway to expiry and you sell at the bid. The odds are the risk-neutral chance of touching that level by then. Model estimates, not guarantees.',
    tipCapacity:
      'How many contracts your bankroll can cover at fee-adjusted ask, capped by quoted ask size. Reserved also uses a safety buffer.',
    atmIvUnavailable: 'ATM IV unavailable',
    within15: 'within 1.5 implied moves',
    between15and2: '1.5–2 implied moves',
    over2: 'over 2 implied moves',
    theHand: 'THE HAND · LONG CALL',
    upBefore: '{underlying} UP BEFORE {expiry}',
    handIntro:
      'You are paying for a shot at a fast upside run. Like drawing to a big hand, your buy-in is capped, but the clock can fold you even when you guessed the direction right.',
    buyIn: 'BUY-IN',
    estimatedEntry: '{value} estimated entry',
    askNoFee: '{ask} ask; fee unavailable and excluded.',
    askPlusFee: '{ask} ask + {fee} taker fee.',
    venueMinimum: 'Venue minimum costs {value}.',
    profitLine: 'PROFIT LINE AT EXPIRY',
    above: '{underlying} above {price}',
    climb: 'That is a {pct} climb from now · about {odds} risk-neutral odds.',
    bustLine: 'BUST LINE AT EXPIRY',
    atOrBelow: '{underlying} at or below {price}',
    bustText: 'The call expires worth $0 and the full buy-in is lost.',
    tenXOut: '10× OUT:',
    noScenario: 'The model cannot price this scenario.',
    tenXNear:
      '{underlying} near {price} ({pct}) within {days} days, about {odds} odds of touching it.',
    assumes: 'Assumes unchanged IV and a sale at the bid ({haircut} vs fair); not an expiry payout.',
    maxLoss: 'MAX LOSS: 100% OF WHAT YOU PAY · NO LOSS BEYOND THE PREMIUM',
    eyebrow: '{underlying} · {n} ACTIVE VENUES · LONG CALLS',
    ownUpside: 'Own the upside',
    lottoRadar: 'Lotto radar',
    guidedDescription: 'Define one possible future, cap what you can lose, and compare ways to own it.',
    advancedDescription:
      'Ranked by the 10× move, landing halfway to expiry and sold at the bid, in ATM implied-move units. Hover a contract for the poker read.',
    viewAria: 'Lotto radar view',
    guided: 'Guided',
    advancedRadar: 'Advanced radar',
    scanOnly: 'SCAN ONLY',
    maxContractMark: 'Max contract mark',
    minOtm: 'Min OTM',
    buyingPower: 'Buying power',
    buyingPowerAria: 'Scanner buying power',
    budgetError: 'Enter $1 to $10,000,000.',
    spreadRule: '≤50% spread',
    reserveRule: '1.2× reserve',
    invalidBuyingPower: 'Enter valid buying power to run the advanced scan.',
    scanning: 'Scanning {n} venues…',
    noVenues: 'No supported active venues are available for this scan.',
    scannerUnavailable: 'Scanner unavailable: {error}',
    requestFailed: 'request failed',
    refreshFailed: 'Refresh failed; showing the scan from {time}.',
    now: '{underlying} NOW',
    horizon: 'HORIZON',
    horizonDays: '15–75 DAYS',
    liveCalls: 'LIVE CALLS',
    availableDates: 'AVAILABLE DATES',
    liveVenues: 'LIVE VENUES',
    index: 'INDEX',
    avgForward: 'AVG FORWARD',
    expiries: 'EXPIRIES',
    matches: 'MATCHES',
    scannedVenues: 'SCANNED VENUES',
    refreshing: 'REFRESHING',
    partialData: 'Partial or no scan data from {venues}.',
    noLiquid: 'No liquid {underlying} calls match these mark, moneyness, DTE, and venue limits.',
    venueContract: 'Venue / contract',
    markAsk: 'Mark / ask',
    ivImplied: 'IV / implied',
    tenXMove: '10× move',
    capacity: 'Capacity',
    rowAria: 'Select {instrument} and show its plain-language bet explanation',
    askWide: '{ask} ask · {pct} wide',
    finishAbove: '{odds} finish above',
    implied: '{n} implied',
    touch: '{context} · {odds} touch',
    reserved: '{n} reserved',
    footerCapacity: 'Capacity uses fee-adjusted ask and quoted size; reserve quantity also includes the 1.2× buffer.',
    footerScans:
      'Scans {min}–{max} DTE with spreads up to {spread}%. Targets measure return on estimated entry cost if the move lands halfway to expiry, IV is unchanged, and you sell at the bid.',
    footerOdds: "Odds are risk-neutral estimates from the option's IV, not forecasts.",
    footerGuided:
      'Guided scans 15–75 DTE for one-month and two-month calls. Payouts use intrinsic value at expiry; unknown venue fees are excluded.',
    footerNoOrder: 'No order is sent. Most short-dated OTM calls expire worthless.',
    perContract: '{size} {underlying} / contract',
    minSettle: 'min {qty} · {settle}',
    inverse: 'inverse',
    minOrder: 'min order {value}',
    venueForward: 'venue forward',
    spotProxy: 'spot proxy',
    xAsk: '{n}× ASK',
    touchIn: '{odds} touch in {days}d',
    expiryIntrinsicValue: 'expiry intrinsic {value}',
    expiryIntrinsic: 'EXPIRY INTRINSIC',
    askSize: 'ASK SIZE {value}',
    openBuilder: 'Open in Builder V2',
  },
  {
    tipMark: 'El precio de referencia usado para filtrar el tablero. Tu entrada real es el ask, que puede ser mayor.',
    tipOtm: 'Cuánto debe subir el mercado solo para tocar el strike. Más lejos significa una apuesta más barata, pero más difícil de acertar.',
    tipBankroll: 'Tu capital total para dimensionar. El escáner muestra lo que cabe; nunca envía una orden.',
    tipPrice: 'MARK es la estimación de la tabla. ASK es el precio cotizado antes de comisiones taker.',
    tipVolatility: 'La IV es cuánto movimiento descuenta el mercado de opciones. Una IV más alta suele significar una apuesta más cara.',
    tipBreakeven:
      'OTM es la subida hasta el strike. BE usa el ask actual más la comisión taker estimada cuando está disponible. Las probabilidades son la chance neutral al riesgo de terminar sobre el BE al vencimiento, según la propia IV de la opción.',
    tipTarget:
      'El movimiento que hace que la opción valga 10× tu entrada pagada al ask si llega a mitad del camino al vencimiento y vendes en el bid. Las probabilidades son la chance neutral al riesgo de tocar ese nivel para entonces. Estimaciones del modelo, no garantías.',
    tipCapacity:
      'Cuántos contratos cubre tu capital al ask ajustado por comisiones, limitado por el tamaño cotizado del ask. Reservado también usa un margen de seguridad.',
    atmIvUnavailable: 'ATM IV no disponible',
    within15: 'dentro de 1.5 movimientos implícitos',
    between15and2: '1.5–2 movimientos implícitos',
    over2: 'más de 2 movimientos implícitos',
    theHand: 'LA MANO · LONG CALL',
    upBefore: '{underlying} SUBE ANTES DEL {expiry}',
    handIntro:
      'Pagas por una oportunidad de una subida rápida. Como apostar a una gran mano, tu entrada está limitada, pero el reloj puede hacerte perder aun si acertaste la dirección.',
    buyIn: 'ENTRADA',
    estimatedEntry: '{value} de entrada estimada',
    askNoFee: '{ask} ask; comisión no disponible y excluida.',
    askPlusFee: '{ask} ask + {fee} de comisión taker.',
    venueMinimum: 'El mínimo del exchange cuesta {value}.',
    profitLine: 'LÍNEA DE GANANCIA AL VENCIMIENTO',
    above: '{underlying} sobre {price}',
    climb: 'Es una subida de {pct} desde ahora · probabilidad neutral al riesgo de aprox. {odds}.',
    bustLine: 'LÍNEA DE PÉRDIDA TOTAL AL VENCIMIENTO',
    atOrBelow: '{underlying} en o bajo {price}',
    bustText: 'El call vence valiendo $0 y se pierde toda la entrada.',
    tenXOut: 'SALIDA 10×:',
    noScenario: 'El modelo no puede valorar este escenario.',
    tenXNear:
      '{underlying} cerca de {price} ({pct}) en {days} días, con aprox. {odds} de probabilidad de tocarlo.',
    assumes: 'Supone IV sin cambios y venta en el bid ({haircut} vs justo); no es un pago al vencimiento.',
    maxLoss: 'PÉRDIDA MÁX.: 100% DE LO QUE PAGAS · NINGUNA PÉRDIDA MÁS ALLÁ DE LA PRIMA',
    eyebrow: '{underlying} · {n} EXCHANGES ACTIVOS · LONG CALLS',
    ownUpside: 'Captura el alza',
    lottoRadar: 'Radar lotto',
    guidedDescription: 'Define un futuro posible, limita lo que puedes perder y compara formas de capturarlo.',
    advancedDescription:
      'Ordenado por el movimiento 10×, llegando a mitad del camino al vencimiento y vendido en el bid, en unidades de movimiento implícito ATM. Pasa el cursor sobre un contrato para la lectura de póker.',
    viewAria: 'Vista del radar lotto',
    guided: 'Guiado',
    advancedRadar: 'Radar avanzado',
    scanOnly: 'SOLO ESCANEO',
    maxContractMark: 'Mark máx. por contrato',
    minOtm: 'OTM mín.',
    buyingPower: 'Poder de compra',
    buyingPowerAria: 'Poder de compra del escáner',
    budgetError: 'Ingresa de $1 a $10,000,000.',
    spreadRule: 'spread ≤50%',
    reserveRule: 'reserva 1.2×',
    invalidBuyingPower: 'Ingresa un poder de compra válido para ejecutar el escaneo avanzado.',
    scanning: 'Escaneando {n} exchanges…',
    noVenues: 'No hay exchanges activos compatibles para este escaneo.',
    scannerUnavailable: 'Escáner no disponible: {error}',
    requestFailed: 'falló la solicitud',
    refreshFailed: 'Falló la actualización; se muestra el escaneo de las {time}.',
    now: '{underlying} AHORA',
    horizon: 'HORIZONTE',
    horizonDays: '15–75 DÍAS',
    liveCalls: 'CALLS EN VIVO',
    availableDates: 'FECHAS DISPONIBLES',
    liveVenues: 'EXCHANGES EN VIVO',
    index: 'ÍNDICE',
    avgForward: 'FORWARD PROM.',
    expiries: 'VENCIMIENTOS',
    matches: 'COINCIDENCIAS',
    scannedVenues: 'EXCHANGES ESCANEADOS',
    refreshing: 'ACTUALIZANDO',
    partialData: 'Datos de escaneo parciales o ausentes de {venues}.',
    noLiquid: 'Ningún call líquido de {underlying} cumple estos límites de mark, moneyness, DTE y exchange.',
    venueContract: 'Exchange / contrato',
    markAsk: 'Mark / ask',
    ivImplied: 'IV / implícito',
    tenXMove: 'Movimiento 10×',
    capacity: 'Capacidad',
    rowAria: 'Selecciona {instrument} y muestra la explicación simple de la apuesta',
    askWide: '{ask} ask · {pct} de ancho',
    finishAbove: '{odds} termina sobre',
    implied: '{n} implícitos',
    touch: '{context} · {odds} toque',
    reserved: '{n} reservados',
    footerCapacity: 'La capacidad usa el ask ajustado por comisiones y el tamaño cotizado; la cantidad reservada también incluye el margen de 1.2×.',
    footerScans:
      'Escanea {min}–{max} DTE con spreads de hasta {spread}%. Los objetivos miden el retorno sobre el costo de entrada estimado si el movimiento llega a mitad del camino al vencimiento, la IV no cambia y vendes en el bid.',
    footerOdds: 'Las probabilidades son estimaciones neutrales al riesgo a partir de la IV de la opción, no pronósticos.',
    footerGuided:
      'El modo guiado escanea 15–75 DTE para calls a uno y dos meses. Los pagos usan el valor intrínseco al vencimiento; se excluyen las comisiones desconocidas del exchange.',
    footerNoOrder: 'No se envía ninguna orden. La mayoría de los calls OTM de corto plazo vencen sin valor.',
    perContract: '{size} {underlying} / contrato',
    minSettle: 'mín. {qty} · {settle}',
    inverse: 'inverso',
    minOrder: 'orden mín. {value}',
    venueForward: 'forward del exchange',
    spotProxy: 'proxy de spot',
    xAsk: '{n}× ASK',
    touchIn: '{odds} toque en {days}d',
    expiryIntrinsicValue: 'intrínseco al vencimiento {value}',
    expiryIntrinsic: 'INTRÍNSECO AL VENCIMIENTO',
    askSize: 'TAMAÑO ASK {value}',
    openBuilder: 'Abrir en Builder V2',
  },
);

type T = Translate<typeof messages.en>;

interface LottoScannerPanelProps {
  underlying: string;
  venues: string[];
}

function targetFor(candidate: AlphaLottoCandidate, multiple: number): AlphaLottoTarget | null {
  return candidate.targets.find((target) => target.multiple === multiple) ?? null;
}

function scannerVenues(venues: string[]): VenueId[] {
  return venues.flatMap((venue) => {
    const parsed = VenueIdSchema.safeParse(venue);
    return parsed.success ? [parsed.data] : [];
  });
}

function moveContext(target: AlphaLottoTarget | null, t: T): string {
  const ratio = target?.impliedMoveMultiple;
  if (ratio == null) return t('atmIvUnavailable');
  if (ratio <= 1.5) return t('within15');
  if (ratio <= 2) return t('between15and2');
  return t('over2');
}

function fmtChance(probability: number | null): string {
  if (probability == null) return '—';
  const pct = probability * 100;
  if (pct < 0.1) return '<0.1%';
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(data: AlphaLottoScannerResponse): void {
  const headers = [
    'venue',
    'underlying',
    'instrument',
    'expiry',
    'dte',
    'strike',
    'contract_size',
    'min_qty',
    'inverse',
    'reference_source',
    'mark_usd',
    'bid_usd',
    'ask_usd',
    'taker_fee_usd',
    'entry_cost_usd',
    'mark_iv',
    'atm_iv',
    'expected_move_pct',
    'otm_pct',
    'expiry_be_pct',
    'prob_above_be',
    'quantity_at_ask',
    'conservative_quantity',
    'move_10x_pct',
    'implied_moves_10x',
    'horizon_days_10x',
    'exit_haircut_pct',
    'touch_prob_10x',
  ];
  const rows = data.candidates.map((candidate) => {
    const tenX = targetFor(candidate, 10);
    return [
      candidate.venue,
      candidate.underlying,
      candidate.instrument,
      candidate.expiry,
      candidate.dte,
      candidate.strike,
      candidate.contractSize,
      candidate.minQty,
      candidate.inverse,
      candidate.referenceSource,
      candidate.mark,
      candidate.bid,
      candidate.ask,
      candidate.takerFee,
      candidate.entryCost,
      candidate.markIv,
      candidate.atmIv,
      candidate.expectedMovePct,
      candidate.otmPct,
      candidate.breakEvenMovePct,
      candidate.probabilityAboveBreakEven,
      candidate.quantityAtAsk,
      candidate.conservativeQuantity,
      tenX?.modelMovePct ?? null,
      tenX?.impliedMoveMultiple ?? null,
      tenX?.horizonDays ?? null,
      tenX?.exitHaircutPct ?? null,
      tenX?.touchProbability ?? null,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${data.underlying.toLowerCase()}-long-call-scan-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatQuantity(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface MetricTipProps {
  label: string;
  tip: string;
  placement?: 'bottom-start' | 'bottom-end';
}

function MetricTip({ label, tip, placement = 'bottom-start' }: MetricTipProps) {
  return (
    <HoverTooltip
      className={styles.tipTrigger}
      placement={placement}
      content={<div className={styles.metricTip}>{tip}</div>}
    >
      <span>{label}</span>
      <span className={styles.tipMark} aria-hidden="true">?</span>
    </HoverTooltip>
  );
}

function CallBetTooltip({ candidate }: { candidate: AlphaLottoCandidate }) {
  const t = useT(messages);
  const tenX = targetFor(candidate, 10);
  const expiry = formatExpiry(candidate.expiry);

  return (
    <div className={styles.betTooltip}>
      <div className={styles.betTooltipHeader}>
        <span>{t('theHand')}</span>
        <strong>{t('upBefore', { underlying: candidate.underlying, expiry: expiry.toUpperCase() })}</strong>
      </div>
      <p>{t('handIntro')}</p>
      <div className={styles.betLines}>
        <div data-tone="stake">
          <span>{t('buyIn')}</span>
          <strong>{t('estimatedEntry', { value: fmtUsd(candidate.entryCost) })}</strong>
          <small>
            {candidate.takerFee == null
              ? t('askNoFee', { ask: fmtUsd(candidate.ask) })
              : t('askPlusFee', { ask: fmtUsd(candidate.ask), fee: fmtUsd(candidate.takerFee) })}
          </small>
          <small>{t('venueMinimum', { value: fmtUsd(candidate.minimumOrderCost) })}</small>
        </div>
        <div data-tone="win">
          <span>{t('profitLine')}</span>
          <strong>
            {t('above', {
              underlying: candidate.underlying,
              price: fmtUsdCompact(candidate.breakEvenPrice),
            })}
          </strong>
          <small>
            {t('climb', {
              pct: fmtPct(candidate.breakEvenMovePct, 1),
              odds: fmtChance(candidate.probabilityAboveBreakEven),
            })}
          </small>
        </div>
        <div data-tone="bust">
          <span>{t('bustLine')}</span>
          <strong>
            {t('atOrBelow', { underlying: candidate.underlying, price: fmtUsdCompact(candidate.strike) })}
          </strong>
          <small>{t('bustText')}</small>
        </div>
      </div>
      <div className={styles.betFootnote}>
        <strong>{t('tenXOut')}</strong>{' '}
        {tenX?.modelUnderlyingPrice == null
          ? t('noScenario')
          : t('tenXNear', {
              underlying: candidate.underlying,
              price: fmtUsdCompact(tenX.modelUnderlyingPrice),
              pct: fmtPct(tenX.modelMovePct, 1),
              days: tenX.horizonDays.toFixed(1),
              odds: fmtChance(tenX.touchProbability),
            })}{' '}
        {t('assumes', { haircut: tenX == null ? '—' : `−${tenX.exitHaircutPct.toFixed(1)}%` })}
      </div>
      <div className={styles.maxLoss}>{t('maxLoss')}</div>
    </div>
  );
}

export default function LottoScannerPanel({ underlying, venues }: LottoScannerPanelProps) {
  const t = useT(messages);
  const [view, setView] = useState<ScannerView>('guided');
  const [advancedLimit, setAdvancedLimit] = useState(20);
  const [premiumCap, setPremiumCap] = useState(400);
  const [minOtmPct, setMinOtmPct] = useState(5);
  const [buyingPowerInput, setBuyingPowerInput] = useState('2400');
  const [riskBudgetInput, setRiskBudgetInput] = useState('250');
  const [targetPriceInput, setTargetPriceInput] = useState('');
  const [outcomeExpiry, setOutcomeExpiry] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setBuilderVariant = useAppStore((state) => state.setBuilderVariant);
  const setExpiry = useAppStore((state) => state.setExpiry);
  const buyingPower = Number(buyingPowerInput);
  const buyingPowerIsValid = Number.isFinite(buyingPower) && buyingPower > 0 && buyingPower <= 10_000_000;
  const validBuyingPower = buyingPowerIsValid ? buyingPower : 2_400;
  const deferredAdvancedBuyingPower = useDeferredValue(validBuyingPower);
  const queryBuyingPower = view === 'guided' ? GUIDED_SCANNER_BUYING_POWER : deferredAdvancedBuyingPower;
  const activeVenues = scannerVenues(venues);

  const query = useLottoScanner(
    {
      underlying,
      venues: activeVenues,
      premiumCap: view === 'guided' ? GUIDED_PREMIUM_CAP : premiumCap,
      minDte: view === 'guided' ? GUIDED_MIN_DTE : ADVANCED_MIN_DTE,
      maxDte: view === 'guided' ? GUIDED_MAX_DTE : ADVANCED_MAX_DTE,
      minOtmPct,
      maxOtmPct: 50,
      buyingPower: queryBuyingPower,
      marginHaircut: 1.2,
      maxSpreadPct: view === 'guided' ? 50 : ADVANCED_MAX_SPREAD_PCT,
      limit: view === 'guided' ? 50 : advancedLimit,
      diversifyExpiries: view === 'guided',
    },
    activeVenues.length > 0 && (view === 'guided' || buyingPowerIsValid),
  );
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => `${candidate.venue}:${candidate.instrument}` === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilderV2(candidate: AlphaLottoCandidate): void {
    replaceLegs([candidateToBuilderLeg(candidate)], candidate.underlying);
    setExpiry(candidate.expiry);
    setBuilderVariant('v2');
    setActiveTab('architect');
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            {t('eyebrow', { underlying, n: activeVenues.length })}
          </div>
          <h2 className={styles.title}>{view === 'guided' ? t('ownUpside') : t('lottoRadar')}</h2>
          <p className={styles.description}>
            {view === 'guided' ? t('guidedDescription') : t('advancedDescription')}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.viewSwitch} role="group" aria-label={t('viewAria')}>
            <button
              type="button"
              data-active={view === 'guided'}
              aria-pressed={view === 'guided'}
              onClick={() => setView('guided')}
            >
              {t('guided')}
            </button>
            <button
              type="button"
              data-active={view === 'advanced'}
              aria-pressed={view === 'advanced'}
              onClick={() => {
                setAdvancedLimit(20);
                setView('advanced');
              }}
            >
              {t('advancedRadar')}
            </button>
          </div>
          <span className={styles.scanOnly}>{t('scanOnly')}</span>
          {view === 'advanced' && (
            <button
              type="button"
              className={styles.exportButton}
              disabled={!data || data.candidates.length === 0}
              onClick={() => data && downloadCsv(data)}
            >
              CSV
            </button>
          )}
        </div>
      </header>

      {view === 'advanced' && (
        <div className={styles.controls}>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label={t('maxContractMark')} tip={t('tipMark')} /></legend>
            <div className={styles.presetRow}>
              {PREMIUM_PRESETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  data-active={premiumCap === value}
                  onClick={() => setPremiumCap(value)}
                >
                  ${value}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label={t('minOtm')} tip={t('tipOtm')} /></legend>
            <div className={styles.presetRow}>
              {OTM_PRESETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  data-active={minOtmPct === value}
                  onClick={() => setMinOtmPct(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
          </fieldset>
          <label className={styles.budgetControl} data-invalid={!buyingPowerIsValid || undefined}>
            <span><MetricTip label={t('buyingPower')} tip={t('tipBankroll')} /></span>
            <div className={styles.inputShell}>
              <span>$</span>
              <input
                inputMode="decimal"
                value={buyingPowerInput}
                aria-label={t('buyingPowerAria')}
                aria-invalid={!buyingPowerIsValid}
                aria-errormessage={!buyingPowerIsValid ? 'lotto-advanced-budget-error' : undefined}
                onChange={(event) => setBuyingPowerInput(event.target.value)}
              />
            </div>
            {!buyingPowerIsValid && (
              <small id="lotto-advanced-budget-error" className={styles.controlError} role="alert">
                {t('budgetError')}
              </small>
            )}
          </label>
          <div className={styles.fixedRules}>
            <span>4–14 DTE</span>
            <span>{t('spreadRule')}</span>
            <span>{t('reserveRule')}</span>
          </div>
        </div>
      )}

      {view === 'advanced' && !buyingPowerIsValid && (
        <div className={styles.message}>{t('invalidBuyingPower')}</div>
      )}

      {query.isLoading && !data && (view === 'guided' || buyingPowerIsValid) && (
        <div className={styles.loading}>
          <Spinner size="sm" label={t('scanning', { n: activeVenues.length })} />
        </div>
      )}

      {activeVenues.length === 0 && (
        <div className={styles.message}>{t('noVenues')}</div>
      )}

      {query.error && !data && (
        <div className={styles.message} data-tone="error">
          {t('scannerUnavailable', {
            error: query.error instanceof Error ? query.error.message : t('requestFailed'),
          })}
        </div>
      )}

      {query.error && data && (
        <div className={styles.message} data-tone="error">
          {t('refreshFailed', { time: new Date(data.generatedAt).toLocaleTimeString() })}
        </div>
      )}

      {data && (view === 'guided' || buyingPowerIsValid) && (
        <>
          <div className={styles.marketStrip}>
            {view === 'guided' ? (
              <>
                <span>{t('now', { underlying })} <strong>{fmtUsdCompact(data.indexPrice)}</strong></span>
                <span>{t('horizon')} <strong>{t('horizonDays')}</strong></span>
                <span>{t('liveCalls')} <strong>{data.candidates.length}</strong></span>
                <span>{t('availableDates')} <strong>{data.eligibleExpiries.length}</strong></span>
                <span>{t('liveVenues')} <strong>{data.venueStatus.filter((status) => status.scannedContracts > 0).length}/{data.venues.length}</strong></span>
              </>
            ) : (
              <>
                <span>{t('index')} <strong>{fmtUsdCompact(data.indexPrice)}</strong></span>
                <span>{t('avgForward')} <strong>{fmtUsdCompact(data.forwardPrice)}</strong></span>
                <span>{t('expiries')} <strong>{data.eligibleExpiries.length}</strong></span>
                <span>{t('matches')} <strong>{data.candidates.length}</strong></span>
                <span>{t('scannedVenues')} <strong>{data.venueStatus.filter((status) => status.scannedContracts > 0).length}/{data.venues.length}</strong></span>
              </>
            )}
            {query.isFetching && <span className={styles.refreshing}>{t('refreshing')}</span>}
          </div>
          {unavailableVenues.length > 0 && (
            <div className={styles.venueWarning}>
              {t('partialData', {
                venues: unavailableVenues.map((status) => VENUES[status.venue]?.label ?? status.venue).join(', '),
              })}
            </div>
          )}

          {view === 'guided' ? (
            <LottoOutcomeBuilder
              data={data}
              targetPriceInput={targetPriceInput}
              expiry={outcomeExpiry}
              riskBudgetInput={riskBudgetInput}
              onTargetPriceChange={setTargetPriceInput}
              onExpiryChange={setOutcomeExpiry}
              onRiskBudgetChange={setRiskBudgetInput}
              onInspect={(candidate) => {
                setSelectedKey(`${candidate.venue}:${candidate.instrument}`);
                setAdvancedLimit(50);
                setView('advanced');
              }}
            />
          ) : data.candidates.length === 0 ? (
            <div className={styles.message}>
              {t('noLiquid', { underlying })}
            </div>
          ) : (
            <div className={styles.results}>
              <div className={styles.tableScroll}>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <div>{t('venueContract')}</div>
                    <div><MetricTip label={t('markAsk')} tip={t('tipPrice')} /></div>
                    <div><MetricTip label={t('ivImplied')} tip={t('tipVolatility')} /></div>
                    <div><MetricTip label="OTM / BE" tip={t('tipBreakeven')} /></div>
                    <div><MetricTip label={t('tenXMove')} tip={t('tipTarget')} /></div>
                    <div><MetricTip label={t('capacity')} tip={t('tipCapacity')} placement="bottom-end" /></div>
                  </div>
                  {data.candidates.map((candidate) => {
                    const key = `${candidate.venue}:${candidate.instrument}`;
                    const tenX = targetFor(candidate, 10);
                    return (
                      <HoverTooltip
                        as="button"
                        className={styles.row}
                        dataSelected={selected != null && key === `${selected.venue}:${selected.instrument}` ? 'true' : 'false'}
                        ariaLabel={t('rowAria', { instrument: candidate.instrument })}
                        content={<CallBetTooltip candidate={candidate} />}
                        key={key}
                        onActivate={() => setSelectedKey(key)}
                      >
                        <div className={styles.contractCell}>
                          <span className={styles.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
                          <strong>{candidate.instrument}</strong>
                          <span>{candidate.dte.toFixed(1)} DTE · K {fmtStrike(candidate.strike)}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtUsd(candidate.mark)}</strong>
                          <span>{t('askWide', { ask: fmtUsd(candidate.ask), pct: fmtPct(candidate.spreadPct, 1) })}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtIv(candidate.markIv)}</strong>
                          <span>ATM {fmtIv(candidate.atmIv)} · {fmtPct(candidate.expectedMovePct, 1)}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtPct(candidate.otmPct, 1)}</strong>
                          <span>BE {fmtPct(candidate.breakEvenMovePct, 1)}</span>
                          <small>{t('finishAbove', { odds: fmtChance(candidate.probabilityAboveBreakEven) })}</small>
                        </div>
                        <div className={styles.targetCell}>
                          <strong>{fmtPct(tenX?.modelMovePct ?? null, 1)}</strong>
                          <span>{tenX?.impliedMoveMultiple == null ? '—' : t('implied', { n: tenX.impliedMoveMultiple.toFixed(2) })}</span>
                          <small>
                            {t('touch', {
                              context: moveContext(tenX, t),
                              odds: fmtChance(tenX?.touchProbability ?? null),
                            })}
                          </small>
                        </div>
                        <div className={styles.capacityCell}>
                          <strong>{formatQuantity(candidate.quantityAtAsk)}</strong>
                          <span>{t('reserved', { n: formatQuantity(candidate.conservativeQuantity) })}</span>
                        </div>
                      </HoverTooltip>
                    );
                  })}
                </div>
              </div>
              {selected && (
                <CandidateInspector candidate={selected} onOpenBuilder={openInBuilderV2} />
              )}
            </div>
          )}
        </>
      )}

      <footer className={styles.footer}>
        {view === 'advanced' && (
          <>
            <span>{t('footerCapacity')}</span>
            <span>
              {t('footerScans', {
                min: ADVANCED_MIN_DTE,
                max: ADVANCED_MAX_DTE,
                spread: ADVANCED_MAX_SPREAD_PCT,
              })}
            </span>
            <span>{t('footerOdds')}</span>
          </>
        )}
        {view === 'guided' && (
          <span>{t('footerGuided')}</span>
        )}
        <span>{t('footerNoOrder')}</span>
      </footer>
    </section>
  );
}

interface CandidateInspectorProps {
  candidate: AlphaLottoCandidate;
  onOpenBuilder: (candidate: AlphaLottoCandidate) => void;
}

function CandidateInspector({ candidate, onOpenBuilder }: CandidateInspectorProps) {
  const t = useT(messages);
  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <div>
          <span>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
          <strong>{candidate.instrument}</strong>
        </div>
        <div className={styles.inspectorMeta}>
          <span>{t('perContract', { size: candidate.contractSize, underlying: candidate.underlying })}</span>
          <span>{t('minSettle', { qty: candidate.minQty, settle: candidate.inverse ? t('inverse') : candidate.settle })}</span>
          <span>{t('minOrder', { value: fmtUsd(candidate.minimumOrderCost) })}</span>
          <span>{candidate.referenceSource === 'venue-forward' ? t('venueForward') : t('spotProxy')}</span>
        </div>
      </div>
      <div className={styles.targetGrid}>
        {candidate.targets.map((target) => (
          <div key={target.multiple}>
            <span>{t('xAsk', { n: target.multiple })}</span>
            <strong>{fmtUsdCompact(target.modelUnderlyingPrice)}</strong>
            <small>
              {fmtPct(target.modelMovePct, 1)} ·{' '}
              {target.impliedMoveMultiple == null ? '—' : t('implied', { n: target.impliedMoveMultiple.toFixed(2) })}
            </small>
            <small>
              {t('touchIn', { odds: fmtChance(target.touchProbability), days: target.horizonDays.toFixed(1) })}
            </small>
            <small>{t('expiryIntrinsicValue', { value: fmtUsdCompact(target.intrinsicUnderlyingPrice) })}</small>
          </div>
        ))}
      </div>
      <div className={styles.shockGrid}>
        <span>{t('expiryIntrinsic')}</span>
        {candidate.shocks.map((shock) => (
          <div key={shock.movePct}>
            <span>+{shock.movePct}%</span>
            <strong>{shock.intrinsicMultiple.toFixed(1)}×</strong>
            <small>{fmtUsdCompact(shock.underlyingPrice)}</small>
          </div>
        ))}
      </div>
      <div className={styles.greeksLine}>
        <span>Δ {fmtDelta(candidate.delta)}</span>
        <span>IV {fmtIv(candidate.markIv)}</span>
        <span>{t('askSize', { value: candidate.askSize ?? '—' })}</span>
      </div>
      <button
        type="button"
        className={styles.builderButton}
        onClick={() => onOpenBuilder(candidate)}
      >
        <span>{t('openBuilder')}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </aside>
  );
}
