import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaPutCandidate,
  type AlphaPutRankBy,
  type AlphaPutScannerResponse,
  type AlphaPutTarget,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import HoverTooltip from '@components/ui/HoverTooltip';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtDelta, fmtIv, fmtPct, fmtStrike, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import {
  buildProtectionChoices,
  defaultHedgeQty,
  hedgedPnlAt,
  type ProtectionChoice,
  type ProtectionStyle,
} from './put-protection';
import { alphaMessages } from './i18n';
import { putCandidateToBuilderLeg } from './radar-builder';
import { useAlphaMarketContext } from './useAlphaMarketContext';
import { usePutScanner } from './usePutScanner';
import styles from './LottoScannerPanel.module.css';
import ob from './LottoOutcomeBuilder.module.css';
import own from './ProtectivePutPanel.module.css';

const PREMIUM_PRESETS = [250, 500, 1_000, 2_500] as const;
const OTM_PRESETS = [0, 5, 10, 15] as const;
const FLOOR_PRESETS = [10, 20, 30] as const;
const GUIDED_MIN_DTE = 7;
const GUIDED_MAX_DTE = 90;
const ADVANCED_MIN_DTE = 4;
const ADVANCED_MAX_DTE = 60;
const STRESS_MOVE_PCT = -30;
type ScannerView = 'guided' | 'advanced';

const messages = defineMessages(
  {
    cardTightLabel: 'Tight floor',
    cardTightCharacter: 'Smallest worst case',
    cardBalancedLabel: 'Balanced',
    cardBalancedCharacter: 'Middle strike',
    cardCheapLabel: 'Crash cover',
    cardCheapCharacter: 'Cheapest premium',
    tipMark:
      'The sticker price used to filter the board. Your real buy-in is the ask, which can be higher.',
    tipOtm:
      'How far the market must fall just to touch the strike. Farther out is cheaper, but pays only in a deeper drop.',
    tipRank:
      'Protection ranks by worst-case hedged loss. Convexity ranks by the drop needed for a 5× mark.',
    tipBankroll:
      'Premium budget for outright long puts. The scanner shows what fits; it never places an order.',
    tipPrice: 'MARK is the table estimate. ASK is the quoted price before taker fees.',
    tipVolatility:
      'Put IV and its premium over the ATM IV of the same expiry. Downside puts usually carry positive skew.',
    tipBreakeven:
      'OTM is the fall to the strike. BE is the fall needed for the put alone to pay back its fee-adjusted ask.',
    tipTarget:
      'A model of the fall that could make the put worth 5× your ask-paid entry. It is not a probability or guarantee.',
    tipInsurance:
      'Premium as a percent of one unit of underlying, and that cost annualized so expiries compare fairly.',
    tipCapacity:
      'Contracts your budget covers at fee-adjusted ask, capped by quoted ask size. Reserved also uses a safety buffer.',
    vsAtm: '{points} vs ATM',
    theHand: 'THE HAND · LONG PUT',
    downBefore: '{underlying} DOWN BEFORE {expiry}',
    betIntro:
      'Bought alone, this is a capped-cost bet on a fall. Held against {underlying} you own, it is insurance: it sets a floor at the strike for the life of the option.',
    buyIn: 'BUY-IN',
    estimatedEntry: '{value} estimated entry',
    askNoFee: '{ask} ask; fee unavailable and excluded.',
    askWithFee: '{ask} ask + {fee} taker fee.',
    asBet: 'AS A BET · PROFIT BELOW',
    fallFromNow: 'That is a {pct} fall from now.',
    asHedge: 'AS A HEDGE · FLOOR',
    floorWorst: '{strike} · worst case {pct}',
    hedgeCost:
      'Costs {cost} of spot ({annual} a year). Upside pays for it above {price}.',
    maxLossPut: 'MAX LOSS ON THE PUT: 100% OF WHAT YOU PAY',
    insuranceCost: 'Insurance cost',
    ofHolding: '{pct} of the holding · {annual} a year',
    floor: 'Floor',
    estWorstCase: 'Est. worst case',
    worstCase: 'Worst case',
    atMove: 'At {pct}%',
    now: 'Now',
    paidBack: 'Paid back',
    contracts: '{n} contracts',
    days: '{n} days',
    askCoversOnly: 'Ask size covers only {covered} of {target} {underlying}.',
    whyThisPut: 'Why this put?',
    unhedgedAt: 'Unhedged at {pct}%',
    sameHoldingNoPut: 'same holding, no put',
    floorDistance: 'Floor distance',
    absorbFall: 'you absorb this fall first',
    liquidity: 'Liquidity',
    spreadPct: '{pct} spread',
    quotedAtAsk: '{n} quoted at ask',
    putPricing: 'Put pricing',
    ivValue: '{iv} IV',
    inspectRadar: 'Inspect contract in Advanced Radar',
    protectEyebrow: 'Protect what you already hold',
    keepUpside: 'Keep the upside.',
    putFloor: 'Put a floor under the downside.',
    protectIntro:
      'A protective put caps how much your {underlying} can lose until expiry. You pay for it up front, and the premium is gone if the market never falls.',
    toProtect: '{underlying} to protect',
    qtyAria: '{underlying} quantity to protect',
    qtyError: 'Enter a quantity above 0.',
    atSpot: '≈ {value} at spot',
    protectUntil: 'Protect until',
    putExpiryAria: 'Put expiry',
    expiryDays: '{expiry} · {n} days',
    dayRange: '{min}–{max} days',
    deepestFloor: 'Deepest floor considered',
    enterHolding: 'Enter how much {underlying} you want to protect.',
    sizedInContracts: 'The hedge is sized in contracts to cover that quantity.',
    noLiquidPut: 'No liquid put covers this holding for the selected date.',
    tryAnother: 'Try another expiry, a deeper floor, or inspect the full board in Advanced Radar.',
    waysToInsure: 'Ways to insure the holding',
    sameHolding: 'Same holding. Different floor and price.',
    worstCaseNote: 'Worst case is at expiry from live asks, holding valued at the current index.',
    eyebrow: '{underlying} · {n} ACTIVE VENUES · LONG PUTS',
    insureStack: 'Insure the stack',
    radarTitle: 'Long put radar',
    guidedDescription: 'Size a protective put to the coin you hold and compare floor against premium.',
    advancedDescription:
      'Every liquid OTM put with bet and insurance economics side by side. Hover a contract for the read.',
    viewAria: 'Long put view',
    protect: 'Protect',
    advancedRadar: 'Advanced radar',
    rankBy: 'Rank by',
    bet: 'Bet',
    hedge: 'Hedge',
    maxMark: 'Max contract mark',
    minOtm: 'Min OTM',
    buyingPower: 'Buying power',
    buyingPowerAria: 'Put scanner buying power',
    budgetError: 'Enter $1 to $10,000,000.',
    maxSpread: '≤40% spread',
    reserve: '1.2× reserve',
    underlyingNow: '{underlying} NOW',
    horizon: 'HORIZON',
    horizonDays: '{min}–{max} DAYS',
    livePuts: 'LIVE PUTS',
    expiries: 'EXPIRIES',
    liveVenues: 'LIVE VENUES',
    noLiquidPuts: 'No liquid {underlying} puts match these mark, moneyness, DTE, and venue limits.',
    venueContract: 'Venue / contract',
    ivSkew: 'IV / skew',
    fiveXMove: '5× move',
    insurance: 'Insurance',
    capacity: 'Capacity',
    rowAria: 'Select {instrument} and show its plain-language explanation',
    askWide: '{ask} ask · {pct} wide',
    implied: '{n} implied',
    perYear: '{pct} / yr',
    worst: 'worst {pct}',
    reserved: '{n} reserved',
    guidedFooter:
      'Worst case assumes the holding is valued at today’s index and the put is held to expiry. Unknown venue fees are excluded.',
    advancedFooter:
      'Targets measure return on estimated entry cost and hold current IV and time constant.',
    noOrder:
      'No order is sent. An unused protective put expires worthless; that premium is the cost of the floor.',
    perContract: '{size} {underlying} / contract',
    minSettle: 'min {qty} · {settle}',
    inverse: 'inverse',
    minOrder: 'min order {value}',
    venueForward: 'venue forward',
    spotProxy: 'spot proxy',
    xAsk: '{n}× ASK',
    expiryIntrinsic: 'expiry intrinsic {value}',
    expiryIntrinsicHeading: 'EXPIRY INTRINSIC',
    floorCost: 'FLOOR COST {pct}',
    perYearUpper: '{pct} / YR',
    worstUpper: 'WORST {pct}',
    askSize: 'ASK SIZE {n}',
    openInBuilder: 'Open in Builder V2',
  },
  {
    cardTightLabel: 'Piso ajustado',
    cardTightCharacter: 'Menor peor caso',
    cardBalancedLabel: 'Equilibrado',
    cardBalancedCharacter: 'Strike intermedio',
    cardCheapLabel: 'Cobertura de crash',
    cardCheapCharacter: 'Prima más barata',
    tipMark:
      'El precio de referencia usado para filtrar el tablero. Tu entrada real es el ask, que puede ser mayor.',
    tipOtm:
      'Cuánto debe caer el mercado solo para tocar el strike. Más lejos es más barato, pero solo paga en una caída más profunda.',
    tipRank:
      'Protección ordena por la pérdida cubierta en el peor caso. Convexidad ordena por la caída necesaria para un mark de 5×.',
    tipBankroll:
      'Presupuesto de prima para long puts directos. El escáner muestra lo que cabe; nunca coloca una orden.',
    tipPrice: 'MARK es la estimación de la tabla. ASK es el precio cotizado antes de comisiones taker.',
    tipVolatility:
      'IV del put y su prima sobre la IV ATM del mismo vencimiento. Los puts a la baja suelen tener skew positivo.',
    tipBreakeven:
      'OTM es la caída hasta el strike. BE es la caída necesaria para que el put solo recupere su ask ajustado por comisiones.',
    tipTarget:
      'Un modelo de la caída que podría hacer valer el put 5× tu entrada pagada al ask. No es una probabilidad ni una garantía.',
    tipInsurance:
      'Prima como porcentaje de una unidad del subyacente, y ese costo anualizado para comparar vencimientos de forma justa.',
    tipCapacity:
      'Contratos que cubre tu presupuesto al ask ajustado por comisiones, limitados por el tamaño cotizado en el ask. Reservado también usa un margen de seguridad.',
    vsAtm: '{points} vs ATM',
    theHand: 'LA MANO · LONG PUT',
    downBefore: '{underlying} A LA BAJA ANTES DEL {expiry}',
    betIntro:
      'Comprado solo, es una apuesta de costo limitado a una caída. Frente a {underlying} que ya tienes, es un seguro: fija un piso en el strike durante la vida de la opción.',
    buyIn: 'ENTRADA',
    estimatedEntry: 'entrada estimada de {value}',
    askNoFee: 'ask de {ask}; comisión no disponible y excluida.',
    askWithFee: 'ask de {ask} + comisión taker de {fee}.',
    asBet: 'COMO APUESTA · GANANCIA POR DEBAJO DE',
    fallFromNow: 'Es una caída de {pct} desde ahora.',
    asHedge: 'COMO COBERTURA · PISO',
    floorWorst: '{strike} · peor caso {pct}',
    hedgeCost:
      'Cuesta {cost} del spot ({annual} al año). La subida lo paga por encima de {price}.',
    maxLossPut: 'PÉRDIDA MÁX. EN EL PUT: 100% DE LO QUE PAGAS',
    insuranceCost: 'Costo del seguro',
    ofHolding: '{pct} de la tenencia · {annual} al año',
    floor: 'Piso',
    estWorstCase: 'Peor caso est.',
    worstCase: 'Peor caso',
    atMove: 'A {pct}%',
    now: 'Ahora',
    paidBack: 'Recuperado',
    contracts: '{n} contratos',
    days: '{n} días',
    askCoversOnly: 'El tamaño del ask solo cubre {covered} de {target} {underlying}.',
    whyThisPut: '¿Por qué este put?',
    unhedgedAt: 'Sin cobertura a {pct}%',
    sameHoldingNoPut: 'misma tenencia, sin put',
    floorDistance: 'Distancia al piso',
    absorbFall: 'absorbes esta caída primero',
    liquidity: 'Liquidez',
    spreadPct: 'spread de {pct}',
    quotedAtAsk: '{n} cotizado en el ask',
    putPricing: 'Precio del put',
    ivValue: '{iv} IV',
    inspectRadar: 'Inspeccionar contrato en Radar avanzado',
    protectEyebrow: 'Protege lo que ya tienes',
    keepUpside: 'Conserva la subida.',
    putFloor: 'Pon un piso bajo la caída.',
    protectIntro:
      'Un put protector limita cuánto puede perder tu {underlying} hasta el vencimiento. Lo pagas por adelantado, y la prima se pierde si el mercado nunca cae.',
    toProtect: '{underlying} a proteger',
    qtyAria: 'Cantidad de {underlying} a proteger',
    qtyError: 'Ingresa una cantidad mayor a 0.',
    atSpot: '≈ {value} al spot',
    protectUntil: 'Proteger hasta',
    putExpiryAria: 'Vencimiento del put',
    expiryDays: '{expiry} · {n} días',
    dayRange: '{min}–{max} días',
    deepestFloor: 'Piso más profundo considerado',
    enterHolding: 'Ingresa cuánto {underlying} quieres proteger.',
    sizedInContracts: 'La cobertura se dimensiona en contratos para cubrir esa cantidad.',
    noLiquidPut: 'Ningún put líquido cubre esta tenencia para la fecha elegida.',
    tryAnother: 'Prueba otro vencimiento, un piso más profundo o inspecciona el tablero completo en Radar avanzado.',
    waysToInsure: 'Formas de asegurar la tenencia',
    sameHolding: 'Misma tenencia. Distinto piso y precio.',
    worstCaseNote: 'El peor caso es al vencimiento con asks en vivo, con la tenencia valorada al índice actual.',
    eyebrow: '{underlying} · {n} EXCHANGES ACTIVOS · LONG PUTS',
    insureStack: 'Asegura tu tenencia',
    radarTitle: 'Radar de long puts',
    guidedDescription: 'Dimensiona un put protector según la moneda que tienes y compara el piso contra la prima.',
    advancedDescription:
      'Todos los puts OTM líquidos con la economía de apuesta y de seguro lado a lado. Pasa el cursor sobre un contrato para ver la lectura.',
    viewAria: 'Vista de long put',
    protect: 'Proteger',
    advancedRadar: 'Radar avanzado',
    rankBy: 'Ordenar por',
    bet: 'Apuesta',
    hedge: 'Cobertura',
    maxMark: 'Mark máx. del contrato',
    minOtm: 'OTM mín.',
    buyingPower: 'Poder de compra',
    buyingPowerAria: 'Poder de compra del escáner de puts',
    budgetError: 'Ingresa de $1 a $10,000,000.',
    maxSpread: 'spread ≤40%',
    reserve: 'reserva 1.2×',
    underlyingNow: '{underlying} AHORA',
    horizon: 'HORIZONTE',
    horizonDays: '{min}–{max} DÍAS',
    livePuts: 'PUTS EN VIVO',
    expiries: 'VENCIMIENTOS',
    liveVenues: 'EXCHANGES EN VIVO',
    noLiquidPuts: 'Ningún put líquido de {underlying} cumple estos límites de mark, moneyness, DTE y exchange.',
    venueContract: 'Exchange / contrato',
    ivSkew: 'IV / skew',
    fiveXMove: 'Movimiento 5×',
    insurance: 'Seguro',
    capacity: 'Capacidad',
    rowAria: 'Seleccionar {instrument} y mostrar su explicación en lenguaje simple',
    askWide: 'ask {ask} · {pct} de ancho',
    implied: '{n} implícito',
    perYear: '{pct} / año',
    worst: 'peor {pct}',
    reserved: '{n} reservado',
    guidedFooter:
      'El peor caso supone que la tenencia se valora al índice de hoy y que el put se mantiene hasta el vencimiento. Se excluyen las comisiones desconocidas del exchange.',
    advancedFooter:
      'Los objetivos miden el retorno sobre el costo de entrada estimado y mantienen constantes la IV actual y el tiempo.',
    noOrder:
      'No se envía ninguna orden. Un put protector sin usar vence sin valor; esa prima es el costo del piso.',
    perContract: '{size} {underlying} / contrato',
    minSettle: 'mín. {qty} · {settle}',
    inverse: 'inverso',
    minOrder: 'orden mín. {value}',
    venueForward: 'forward del exchange',
    spotProxy: 'proxy de spot',
    xAsk: '{n}× ASK',
    expiryIntrinsic: 'intrínseco al vencimiento {value}',
    expiryIntrinsicHeading: 'INTRÍNSECO AL VENCIMIENTO',
    floorCost: 'COSTO DEL PISO {pct}',
    perYearUpper: '{pct} / AÑO',
    worstUpper: 'PEOR {pct}',
    askSize: 'TAMAÑO ASK {n}',
    openInBuilder: 'Abrir en Builder V2',
  },
);

type MessageKey = keyof typeof messages.en;
type T = Translate<typeof messages.en>;

const CARD_STYLE: Record<
  ProtectionStyle,
  { order: string; label: MessageKey; character: MessageKey; tone: string }
> = {
  tight: { order: '01', label: 'cardTightLabel', character: 'cardTightCharacter', tone: 'safer' },
  balanced: {
    order: '02',
    label: 'cardBalancedLabel',
    character: 'cardBalancedCharacter',
    tone: 'balanced',
  },
  cheap: { order: '03', label: 'cardCheapLabel', character: 'cardCheapCharacter', tone: 'moonshot' },
};

const CONTROL_TIPS = {
  mark: 'tipMark',
  otm: 'tipOtm',
  rank: 'tipRank',
  bankroll: 'tipBankroll',
} as const satisfies Record<string, MessageKey>;

const COLUMN_TIPS = {
  price: 'tipPrice',
  volatility: 'tipVolatility',
  breakeven: 'tipBreakeven',
  target: 'tipTarget',
  insurance: 'tipInsurance',
  capacity: 'tipCapacity',
} as const satisfies Record<string, MessageKey>;

interface ProtectivePutPanelProps {
  underlying: string;
  venues: string[];
}

function pct(value: number | null | undefined, decimals = 1): string {
  return value == null ? '–' : `${value.toFixed(decimals)}%`;
}

function signedUsd(value: number): string {
  const text = fmtUsdCompact(Math.abs(value));
  return value < 0 ? `−${text}` : `+${text}`;
}

function skewPoints(value: number | null, t: T): string {
  if (value == null) return '—';
  const points = value * 100;
  return t('vsAtm', { points: `${points >= 0 ? '+' : ''}${points.toFixed(1)}` });
}

function targetFor(candidate: AlphaPutCandidate, multiple: number): AlphaPutTarget | null {
  return candidate.targets.find((target) => target.multiple === multiple) ?? null;
}

function scannerVenues(venues: string[]): VenueId[] {
  return venues.flatMap((venue) => {
    const parsed = VenueIdSchema.safeParse(venue);
    return parsed.success ? [parsed.data] : [];
  });
}

function formatQuantity(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const HEDGE_STORAGE_KEY = 'alpha-put-hedge-v1';

function loadHedgeInputs(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HEDGE_STORAGE_KEY) ?? 'null');
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    }
  } catch {}
  return {};
}

function validQty(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : null;
}

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(data: AlphaPutScannerResponse): void {
  const headers = [
    'venue', 'underlying', 'instrument', 'expiry', 'dte', 'strike', 'contract_size', 'min_qty',
    'inverse', 'mark_usd', 'bid_usd', 'ask_usd', 'taker_fee_usd', 'entry_cost_usd', 'mark_iv',
    'atm_iv', 'skew_premium', 'otm_pct', 'expiry_be_pct', 'cost_pct', 'annualized_cost_pct',
    'hedged_max_loss_pct', 'quantity_at_ask', 'move_5x_pct', 'implied_moves_5x',
  ];
  const rows = data.candidates.map((candidate) => {
    const fiveX = targetFor(candidate, 5);
    return [
      candidate.venue, candidate.underlying, candidate.instrument, candidate.expiry, candidate.dte,
      candidate.strike, candidate.contractSize, candidate.minQty, candidate.inverse, candidate.mark,
      candidate.bid, candidate.ask, candidate.takerFee, candidate.entryCost, candidate.markIv,
      candidate.atmIv, candidate.protection.skewPremium, candidate.otmPct, candidate.breakEvenMovePct,
      candidate.protection.costPct, candidate.protection.annualizedCostPct,
      candidate.protection.maxLossPct, candidate.quantityAtAsk, fiveX?.modelMovePct ?? null,
      fiveX?.impliedMoveMultiple ?? null,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${data.underlying.toLowerCase()}-long-put-scan-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MetricTip({ label, tip, placement = 'bottom-start' }: {
  label: string;
  tip: string;
  placement?: 'bottom-start' | 'bottom-end';
}) {
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

function PutBetTooltip({ candidate }: { candidate: AlphaPutCandidate }) {
  const t = useT(messages);
  const expiry = formatExpiry(candidate.expiry);
  return (
    <div className={styles.betTooltip}>
      <div className={styles.betTooltipHeader}>
        <span>{t('theHand')}</span>
        <strong>
          {t('downBefore', { underlying: candidate.underlying, expiry: expiry.toUpperCase() })}
        </strong>
      </div>
      <p>{t('betIntro', { underlying: candidate.underlying })}</p>
      <div className={styles.betLines}>
        <div data-tone="stake">
          <span>{t('buyIn')}</span>
          <strong>{t('estimatedEntry', { value: fmtUsd(candidate.entryCost) })}</strong>
          <small>
            {candidate.takerFee == null
              ? t('askNoFee', { ask: fmtUsd(candidate.ask) })
              : t('askWithFee', { ask: fmtUsd(candidate.ask), fee: fmtUsd(candidate.takerFee) })}
          </small>
        </div>
        <div data-tone="win">
          <span>{t('asBet')}</span>
          <strong>{fmtUsdCompact(candidate.breakEvenPrice)}</strong>
          <small>{t('fallFromNow', { pct: fmtPct(candidate.breakEvenMovePct, 1) })}</small>
        </div>
        <div data-tone="bust">
          <span>{t('asHedge')}</span>
          <strong>
            {t('floorWorst', {
              strike: fmtUsdCompact(candidate.strike),
              pct: pct(candidate.protection.maxLossPct),
            })}
          </strong>
          <small>
            {t('hedgeCost', {
              cost: pct(candidate.protection.costPct, 2),
              annual: pct(candidate.protection.annualizedCostPct),
              price: fmtUsdCompact(candidate.protection.upsideBreakEvenPrice),
            })}
          </small>
        </div>
      </div>
      <div className={styles.maxLoss}>{t('maxLossPut')}</div>
    </div>
  );
}

function ChoiceCard({ choice, onInspect }: {
  choice: ProtectionChoice;
  onInspect: (candidate: AlphaPutCandidate) => void;
}) {
  const t = useT(messages);
  const { candidate, hedge } = choice;
  const meta = CARD_STYLE[choice.style];
  const stressPrice = candidate.indexPrice * (1 + STRESS_MOVE_PCT / 100);
  const hedgedStress = hedgedPnlAt(candidate, hedge, stressPrice);
  const unhedgedStress = hedge.targetQty * (stressPrice - candidate.indexPrice);

  return (
    <article className={ob.outcomeCard} data-style={meta.tone}>
      <div className={ob.cardTopline}>
        <span className={ob.cardOrder}>{meta.order}</span>
        <div>
          <strong>{t(meta.label)}</strong>
          <span>{t(meta.character)}</span>
        </div>
        <span className={ob.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
      </div>

      <div className={ob.payoutBlock}>
        <span>{t('insuranceCost')}</span>
        <strong>{fmtUsd(hedge.cost)}</strong>
        <small>
          {t('ofHolding', {
            pct: pct(hedge.costPctOfHolding, 2),
            annual: pct(candidate.protection.annualizedCostPct),
          })}
        </small>
      </div>

      <div className={ob.outcomeStats}>
        <div>
          <span>{t('floor')}</span>
          <strong>{fmtUsdCompact(candidate.strike)}</strong>
        </div>
        <div>
          <span>{candidate.takerFee == null ? t('estWorstCase') : t('worstCase')}</span>
          <strong data-tone="loss">−{fmtUsdCompact(hedge.maxLoss)}</strong>
        </div>
        <div>
          <span>{t('atMove', { pct: STRESS_MOVE_PCT })}</span>
          <strong data-tone={hedgedStress < 0 ? 'loss' : 'profit'}>{signedUsd(hedgedStress)}</strong>
        </div>
      </div>

      <div className={ob.pricePath}>
        <div>
          <span>{t('floor')}</span>
          <strong>{fmtUsdCompact(candidate.strike)}</strong>
        </div>
        <span className={ob.pathArrow}>←</span>
        <div>
          <span>{t('now')}</span>
          <strong>{fmtUsdCompact(candidate.indexPrice)}</strong>
        </div>
        <span className={ob.pathArrow}>→</span>
        <div>
          <span>{t('paidBack')}</span>
          <strong>{fmtUsdCompact(candidate.protection.upsideBreakEvenPrice)}</strong>
        </div>
      </div>

      <div className={ob.contractLine}>
        <span>{candidate.instrument}</span>
        <span>{t('contracts', { n: formatQuantity(hedge.contracts) })}</span>
        <span>{t('days', { n: candidate.dte.toFixed(1) })}</span>
      </div>
      {!hedge.fullyCovered && (
        <div className={own.coverageWarning}>
          {t('askCoversOnly', {
            covered: formatQuantity(hedge.coveredQty),
            target: formatQuantity(hedge.targetQty),
            underlying: candidate.underlying,
          })}
        </div>
      )}

      <details className={ob.explanation}>
        <summary>{t('whyThisPut')}</summary>
        <div className={ob.explanationGrid}>
          <div>
            <span>{t('unhedgedAt', { pct: STRESS_MOVE_PCT })}</span>
            <strong>{signedUsd(unhedgedStress)}</strong>
            <small>{t('sameHoldingNoPut')}</small>
          </div>
          <div>
            <span>{t('floorDistance')}</span>
            <strong>{pct(candidate.otmPct)}</strong>
            <small>{t('absorbFall')}</small>
          </div>
          <div>
            <span>{t('liquidity')}</span>
            <strong>{t('spreadPct', { pct: pct(candidate.spreadPct) })}</strong>
            <small>{t('quotedAtAsk', { n: formatQuantity(candidate.askSize ?? 0) })}</small>
          </div>
          <div>
            <span>{t('putPricing')}</span>
            <strong>{t('ivValue', { iv: fmtIv(candidate.markIv) })}</strong>
            <small>{skewPoints(candidate.protection.skewPremium, t)}</small>
          </div>
        </div>
      </details>

      <button type="button" className={ob.inspectButton} onClick={() => onInspect(candidate)}>
        {t('inspectRadar')}
      </button>
    </article>
  );
}

function ProtectionBuilder({
  data,
  hedgeQtyInput,
  expiry,
  maxFloorPct,
  onHedgeQtyChange,
  onExpiryChange,
  onMaxFloorChange,
  onInspect,
}: {
  data: AlphaPutScannerResponse;
  hedgeQtyInput: string;
  expiry: string;
  maxFloorPct: number;
  onHedgeQtyChange: (value: string) => void;
  onExpiryChange: (value: string) => void;
  onMaxFloorChange: (value: number) => void;
  onInspect: (candidate: AlphaPutCandidate) => void;
}) {
  const t = useT(messages);
  const qtyInvalid = validQty(hedgeQtyInput) == null;
  const candidateExpiries = [...new Set(data.candidates.map((candidate) => candidate.expiry))].sort();
  const resolvedExpiry = candidateExpiries.includes(expiry) ? expiry : (candidateExpiries[0] ?? '');
  const choices = buildProtectionChoices(data.candidates, resolvedExpiry);
  const dteFor = (value: string) => data.candidates.find((candidate) => candidate.expiry === value)?.dte;

  return (
    <div className={ob.builder}>
      <div className={ob.thesis}>
        <div className={ob.thesisLead}>
          <span className={ob.thesisEyebrow}>{t('protectEyebrow')}</span>
          <h3>
            {t('keepUpside')}
            <br />
            {t('putFloor')}
          </h3>
          <p>{t('protectIntro', { underlying: data.underlying })}</p>
        </div>

        <div className={ob.thesisInputs}>
          <label className={ob.builderInput} data-invalid={qtyInvalid || undefined}>
            <span className={ob.step}>01</span>
            <div>
              <span className={ob.inputLabel}>{t('toProtect', { underlying: data.underlying })}</span>
              <div className={`${ob.inputShell} ${own.qtyShell}`}>
                <input
                  inputMode="decimal"
                  aria-label={t('qtyAria', { underlying: data.underlying })}
                  aria-invalid={qtyInvalid}
                  aria-errormessage={qtyInvalid ? 'put-qty-error' : undefined}
                  value={hedgeQtyInput}
                  onChange={(event) => onHedgeQtyChange(event.target.value)}
                />
                <em>{data.underlying}</em>
              </div>
              {qtyInvalid ? (
                <small id="put-qty-error" className={ob.inputError} role="alert">
                  {t('qtyError')}
                </small>
              ) : (
                <small className={ob.inputHint}>
                  {t('atSpot', {
                    value: fmtUsdCompact((validQty(hedgeQtyInput) ?? 0) * (data.indexPrice ?? 0)),
                  })}
                </small>
              )}
            </div>
          </label>

          <label className={ob.builderInput}>
            <span className={ob.step}>02</span>
            <div>
              <span className={ob.inputLabel}>{t('protectUntil')}</span>
              <select
                aria-label={t('putExpiryAria')}
                value={resolvedExpiry}
                disabled={candidateExpiries.length === 0}
                onChange={(event) => onExpiryChange(event.target.value)}
              >
                {candidateExpiries.map((value) => {
                  const dte = dteFor(value);
                  return (
                    <option key={value} value={value}>
                      {dte == null
                        ? formatExpiry(value)
                        : t('expiryDays', {
                            expiry: formatExpiry(value),
                            n: Math.max(0, Math.round(dte)),
                          })}
                    </option>
                  );
                })}
              </select>
              <small className={ob.inputHint}>
                {t('dayRange', { min: GUIDED_MIN_DTE, max: GUIDED_MAX_DTE })}
              </small>
            </div>
          </label>

          <div className={ob.builderInput}>
            <span className={ob.step}>03</span>
            <div>
              <span className={ob.inputLabel}>{t('deepestFloor')}</span>
              <div className={own.floorPresets} role="group" aria-label={t('deepestFloor')}>
                {FLOOR_PRESETS.map((value) => (
                  <button
                    type="button"
                    key={value}
                    data-active={maxFloorPct === value}
                    aria-pressed={maxFloorPct === value}
                    onClick={() => onMaxFloorChange(value)}
                  >
                    −{value}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {qtyInvalid ? (
        <div className={ob.noOutcomes}>
          <strong>{t('enterHolding', { underlying: data.underlying })}</strong>
          <span>{t('sizedInContracts')}</span>
        </div>
      ) : choices.length === 0 ? (
        <div className={ob.noOutcomes}>
          <strong>{t('noLiquidPut')}</strong>
          <span>{t('tryAnother')}</span>
        </div>
      ) : (
        <div className={ob.outcomeSection}>
          <div className={ob.sectionHeader}>
            <div>
              <span>{t('waysToInsure')}</span>
              <strong>{t('sameHolding')}</strong>
            </div>
            <small>{t('worstCaseNote')}</small>
          </div>
          <div className={ob.outcomeGrid}>
            {choices.map((choice) => (
              <ChoiceCard
                key={`${choice.candidate.venue}:${choice.candidate.instrument}`}
                choice={choice}
                onInspect={onInspect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProtectivePutPanel({ underlying, venues }: ProtectivePutPanelProps) {
  const t = useT(messages);
  const tc = useT(alphaMessages);
  const [view, setView] = useState<ScannerView>('guided');
  const [hedgeInputs, setHedgeInputs] = useState<Record<string, string>>(loadHedgeInputs);
  const spot = useAlphaMarketContext(underlying).data?.spotPrice;
  const suggestedHedge = defaultHedgeQty(spot);
  const hedgeQtyInput =
    hedgeInputs[underlying] ?? (suggestedHedge == null ? '' : String(suggestedHedge));
  function setHedgeQtyInput(value: string) {
    setHedgeInputs((previous) => {
      const next = { ...previous, [underlying]: value };
      try {
        localStorage.setItem(HEDGE_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const [guidedExpiry, setGuidedExpiry] = useState('');
  const [maxFloorPct, setMaxFloorPct] = useState<number>(20);
  const [premiumCap, setPremiumCap] = useState<number>(1_000);
  const [minOtmPct, setMinOtmPct] = useState<number>(5);
  const [rankBy, setRankBy] = useState<AlphaPutRankBy>('convexity');
  const [buyingPowerInput, setBuyingPowerInput] = useState('2400');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setBuilderVariant = useAppStore((state) => state.setBuilderVariant);
  const setExpiry = useAppStore((state) => state.setExpiry);

  const buyingPower = Number(buyingPowerInput);
  const buyingPowerIsValid = Number.isFinite(buyingPower) && buyingPower > 0 && buyingPower <= 10_000_000;
  const deferredBuyingPower = useDeferredValue(buyingPowerIsValid ? buyingPower : 2_400);
  const hedgeQty = useDeferredValue(validQty(hedgeQtyInput) ?? suggestedHedge ?? 1);
  const activeVenues = scannerVenues(venues);
  const guided = view === 'guided';

  const query = usePutScanner(
    {
      underlying,
      venues: activeVenues,
      premiumCap: guided ? 100_000 : premiumCap,
      minDte: guided ? GUIDED_MIN_DTE : ADVANCED_MIN_DTE,
      maxDte: guided ? GUIDED_MAX_DTE : ADVANCED_MAX_DTE,
      minOtmPct: guided ? 0 : minOtmPct,
      maxOtmPct: guided ? maxFloorPct : 50,
      hedgeQty,
      buyingPower: deferredBuyingPower,
      marginHaircut: 1.2,
      maxSpreadPct: 40,
      rankBy: guided ? 'protection' : rankBy,
      limit: guided ? 60 : 30,
      diversifyExpiries: guided,
    },
    activeVenues.length > 0 && (guided || buyingPowerIsValid),
  );
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => `${candidate.venue}:${candidate.instrument}` === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilderV2(candidate: AlphaPutCandidate): void {
    replaceLegs([putCandidateToBuilderLeg(candidate)], candidate.underlying);
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
          <h2 className={styles.title}>{guided ? t('insureStack') : t('radarTitle')}</h2>
          <p className={styles.description}>
            {guided ? t('guidedDescription') : t('advancedDescription')}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.viewSwitch} role="group" aria-label={t('viewAria')}>
            <button type="button" data-active={guided} aria-pressed={guided} onClick={() => setView('guided')}>
              {t('protect')}
            </button>
            <button type="button" data-active={!guided} aria-pressed={!guided} onClick={() => setView('advanced')}>
              {t('advancedRadar')}
            </button>
          </div>
          <span className={styles.scanOnly}>{tc('scanOnly')}</span>
          {!guided && (
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

      {!guided && (
        <div className={`${styles.controls} ${own.controls}`}>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label={t('rankBy')} tip={t(CONTROL_TIPS.rank)} /></legend>
            <div className={styles.presetRow}>
              {(['convexity', 'protection'] as const).map((value) => (
                <button type="button" key={value} data-active={rankBy === value} onClick={() => setRankBy(value)}>
                  {value === 'convexity' ? t('bet') : t('hedge')}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label={t('maxMark')} tip={t(CONTROL_TIPS.mark)} /></legend>
            <div className={styles.presetRow}>
              {PREMIUM_PRESETS.map((value) => (
                <button type="button" key={value} data-active={premiumCap === value} onClick={() => setPremiumCap(value)}>
                  ${value.toLocaleString()}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label={t('minOtm')} tip={t(CONTROL_TIPS.otm)} /></legend>
            <div className={styles.presetRow}>
              {OTM_PRESETS.map((value) => (
                <button type="button" key={value} data-active={minOtmPct === value} onClick={() => setMinOtmPct(value)}>
                  {value}%
                </button>
              ))}
            </div>
          </fieldset>
          <label className={styles.budgetControl} data-invalid={!buyingPowerIsValid || undefined}>
            <span><MetricTip label={t('buyingPower')} tip={t(CONTROL_TIPS.bankroll)} /></span>
            <div className={styles.inputShell}>
              <span>$</span>
              <input
                inputMode="decimal"
                value={buyingPowerInput}
                aria-label={t('buyingPowerAria')}
                aria-invalid={!buyingPowerIsValid}
                aria-errormessage={!buyingPowerIsValid ? 'put-advanced-budget-error' : undefined}
                onChange={(event) => setBuyingPowerInput(event.target.value)}
              />
            </div>
            {!buyingPowerIsValid && (
              <small id="put-advanced-budget-error" className={styles.controlError} role="alert">
                {t('budgetError')}
              </small>
            )}
          </label>
          <div className={styles.fixedRules}>
            <span>{ADVANCED_MIN_DTE}–{ADVANCED_MAX_DTE} DTE</span>
            <span>{t('maxSpread')}</span>
            <span>{t('reserve')}</span>
          </div>
        </div>
      )}

      {query.isLoading && !data && (
        <div className={styles.loading}>
          <Spinner size="sm" label={tc('scanningVenues', { n: activeVenues.length })} />
        </div>
      )}

      {activeVenues.length === 0 && (
        <div className={styles.message}>{tc('noSupportedVenues')}</div>
      )}

      {query.error && !data && (
        <div className={styles.message} data-tone="error">
          {tc('scannerUnavailable', {
            error: query.error instanceof Error ? query.error.message : tc('requestFailed'),
          })}
        </div>
      )}

      {query.error && data && (
        <div className={styles.message} data-tone="error">
          {tc('refreshFailed', { time: new Date(data.generatedAt).toLocaleTimeString() })}
        </div>
      )}

      {data && (
        <>
          <div className={styles.marketStrip}>
            <span>
              {t('underlyingNow', { underlying })} <strong>{fmtUsdCompact(data.indexPrice)}</strong>
            </span>
            <span>
              {t('horizon')}{' '}
              <strong>{t('horizonDays', { min: data.config.minDte, max: data.config.maxDte })}</strong>
            </span>
            <span>
              {t('livePuts')} <strong>{data.candidates.length}</strong>
            </span>
            <span>
              {t('expiries')} <strong>{data.eligibleExpiries.length}</strong>
            </span>
            <span>{t('liveVenues')} <strong>{data.venueStatus.filter((status) => status.scannedContracts > 0).length}/{data.venues.length}</strong></span>
            {query.isFetching && <span className={styles.refreshing}>{tc('refreshing')}</span>}
          </div>
          {unavailableVenues.length > 0 && (
            <div className={styles.venueWarning}>
              {tc('partialScanData', {
                venues: unavailableVenues
                  .map((status) => VENUES[status.venue]?.label ?? status.venue)
                  .join(', '),
              })}
            </div>
          )}

          {guided ? (
            <ProtectionBuilder
              data={data}
              hedgeQtyInput={hedgeQtyInput}
              expiry={guidedExpiry}
              maxFloorPct={maxFloorPct}
              onHedgeQtyChange={setHedgeQtyInput}
              onExpiryChange={setGuidedExpiry}
              onMaxFloorChange={setMaxFloorPct}
              onInspect={(candidate) => {
                setSelectedKey(`${candidate.venue}:${candidate.instrument}`);
                setRankBy('protection');
                setMinOtmPct(0);
                setPremiumCap(2_500);
                setView('advanced');
              }}
            />
          ) : data.candidates.length === 0 ? (
            <div className={styles.message}>
              {t('noLiquidPuts', { underlying })}
            </div>
          ) : (
            <div className={styles.results}>
              <div className={styles.tableScroll}>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <div>{t('venueContract')}</div>
                    <div><MetricTip label="Mark / ask" tip={t(COLUMN_TIPS.price)} /></div>
                    <div><MetricTip label={t('ivSkew')} tip={t(COLUMN_TIPS.volatility)} /></div>
                    <div><MetricTip label="OTM / BE" tip={t(COLUMN_TIPS.breakeven)} /></div>
                    {rankBy === 'convexity'
                      ? <div><MetricTip label={t('fiveXMove')} tip={t(COLUMN_TIPS.target)} /></div>
                      : <div><MetricTip label={t('insurance')} tip={t(COLUMN_TIPS.insurance)} /></div>}
                    <div><MetricTip label={t('capacity')} tip={t(COLUMN_TIPS.capacity)} placement="bottom-end" /></div>
                  </div>
                  {data.candidates.map((candidate) => {
                    const key = `${candidate.venue}:${candidate.instrument}`;
                    const fiveX = targetFor(candidate, 5);
                    return (
                      <HoverTooltip
                        as="button"
                        className={styles.row}
                        dataSelected={selected != null && key === `${selected.venue}:${selected.instrument}` ? 'true' : 'false'}
                        ariaLabel={t('rowAria', { instrument: candidate.instrument })}
                        content={<PutBetTooltip candidate={candidate} />}
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
                          <span>{t('askWide', { ask: fmtUsd(candidate.ask), pct: pct(candidate.spreadPct) })}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtIv(candidate.markIv)}</strong>
                          <span>{skewPoints(candidate.protection.skewPremium, t)}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>−{pct(candidate.otmPct)}</strong>
                          <span>BE {fmtPct(candidate.breakEvenMovePct, 1)}</span>
                        </div>
                        {rankBy === 'convexity' ? (
                          <div className={styles.targetCell}>
                            <strong>{fmtPct(fiveX?.modelMovePct ?? null, 1)}</strong>
                            <span>{fiveX?.impliedMoveMultiple == null ? '—' : t('implied', { n: fiveX.impliedMoveMultiple.toFixed(2) })}</span>
                          </div>
                        ) : (
                          <div className={styles.targetCell}>
                            <strong>{pct(candidate.protection.costPct, 2)}</strong>
                            <span>{t('perYear', { pct: pct(candidate.protection.annualizedCostPct) })}</span>
                            <small>{t('worst', { pct: pct(candidate.protection.maxLossPct) })}</small>
                          </div>
                        )}
                        <div className={styles.capacityCell}>
                          <strong>{formatQuantity(candidate.quantityAtAsk)}</strong>
                          <span>{t('reserved', { n: formatQuantity(candidate.conservativeQuantity) })}</span>
                        </div>
                      </HoverTooltip>
                    );
                  })}
                </div>
              </div>
              {selected && <PutInspector candidate={selected} onOpenBuilder={openInBuilderV2} />}
            </div>
          )}
        </>
      )}

      <footer className={styles.footer}>
        {guided ? (
          <span>{t('guidedFooter')}</span>
        ) : (
          <span>{t('advancedFooter')}</span>
        )}
        <span>{t('noOrder')}</span>
      </footer>
    </section>
  );
}

function PutInspector({ candidate, onOpenBuilder }: {
  candidate: AlphaPutCandidate;
  onOpenBuilder: (candidate: AlphaPutCandidate) => void;
}) {
  const t = useT(messages);
  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <div>
          <span>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
          <strong>{candidate.instrument}</strong>
        </div>
        <div className={styles.inspectorMeta}>
          <span>
            {t('perContract', { size: candidate.contractSize, underlying: candidate.underlying })}
          </span>
          <span>
            {t('minSettle', {
              qty: candidate.minQty,
              settle: candidate.inverse ? t('inverse') : candidate.settle,
            })}
          </span>
          <span>{t('minOrder', { value: fmtUsd(candidate.minimumOrderCost) })}</span>
          <span>
            {candidate.referenceSource === 'venue-forward' ? t('venueForward') : t('spotProxy')}
          </span>
        </div>
      </div>
      <div className={styles.targetGrid}>
        {candidate.targets.map((target) => (
          <div key={target.multiple}>
            <span>{t('xAsk', { n: target.multiple })}</span>
            <strong>{fmtUsdCompact(target.modelUnderlyingPrice)}</strong>
            <small>
              {fmtPct(target.modelMovePct, 1)} ·{' '}
              {target.impliedMoveMultiple == null
                ? '—'
                : t('implied', { n: target.impliedMoveMultiple.toFixed(2) })}
            </small>
            <small>
              {t('expiryIntrinsic', { value: fmtUsdCompact(target.intrinsicUnderlyingPrice) })}
            </small>
          </div>
        ))}
      </div>
      <div className={styles.shockGrid}>
        <span>{t('expiryIntrinsicHeading')}</span>
        {candidate.shocks.map((shock) => (
          <div key={shock.movePct}>
            <span>{shock.movePct}%</span>
            <strong>{shock.intrinsicMultiple.toFixed(1)}×</strong>
            <small>{fmtUsdCompact(shock.underlyingPrice)}</small>
          </div>
        ))}
      </div>
      <div className={styles.greeksLine}>
        <span>{t('floorCost', { pct: pct(candidate.protection.costPct, 2) })}</span>
        <span>{t('perYearUpper', { pct: pct(candidate.protection.annualizedCostPct) })}</span>
        <span>{t('worstUpper', { pct: pct(candidate.protection.maxLossPct) })}</span>
      </div>
      <div className={styles.greeksLine}>
        <span>Δ {fmtDelta(candidate.delta)}</span>
        <span>IV {fmtIv(candidate.markIv)}</span>
        <span>{t('askSize', { n: candidate.askSize ?? '—' })}</span>
      </div>
      <button type="button" className={styles.builderButton} onClick={() => onOpenBuilder(candidate)}>
        <span>{t('openInBuilder')}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </aside>
  );
}
