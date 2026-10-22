import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import type { BreakEvenIvRow, PositionLeg, VegaByStrikeRow } from '@oggregator/protocol';

import { defineMessages, useLocale, useT, type Translate } from '@lib/i18n';

import GreekProfileChart, { type ProfileLine } from './GreekProfileChart';
import { buildProfileLegs, buildSpotProfile, buildVolShockProfile } from './greek-profile';
import { buildStrikeRiskBuckets, type StrikeRiskMode } from './strike-risk';
import styles from './PortfolioVegaCurve.module.css';

function hasUsefulGreeks(rows: VegaByStrikeRow[]): boolean {
  return rows.some(
    (row) =>
      row.delta !== 0 ||
      row.vega !== 0 ||
      row.gamma !== 0 ||
      row.theta !== 0 ||
      row.vanna !== 0 ||
      row.volga !== 0,
  );
}

function hasUsefulBreakEven(rows: BreakEvenIvRow[]): boolean {
  return rows.some((row) => row.currentIv != null || row.breakEvenIv != null);
}

function sameLegSignature(left: VegaByStrikeRow[], right: VegaByStrikeRow[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      other != null &&
      row.expiry === other.expiry &&
      row.strike === other.strike &&
      row.optionRight === other.optionRight
    );
  });
}

interface ModeMeta {
  tab: string;
  greek: string;
  question: string;
  scenario: string;
  axis: string;
  profileAxis: string;
  lesson: string;
}

type ChartView = 'curve' | 'strikes';

interface Props {
  positions: PositionLeg[];
  byStrike: VegaByStrikeRow[];
  breakEven: BreakEvenIvRow[];
  spotUsd: number | null;
  underlying: string | null;
}

const MODES: StrikeRiskMode[] = ['delta', 'vega', 'gamma', 'theta', 'vanna', 'volga'];
const COLORS: Record<StrikeRiskMode, string> = {
  delta: '#50d2c1',
  vega: '#a78bfa',
  gamma: '#f59e0b',
  theta: '#f472b6',
  vanna: '#60a5fa',
  volga: '#f0c76a',
};
const LOSS_COLOR = '#ef6177';

const GREEK_LABELS: Record<StrikeRiskMode, string> = {
  delta: 'Delta Δ',
  vega: 'Vega ν',
  gamma: 'Gamma Γ',
  theta: 'Theta Θ',
  vanna: 'Vanna',
  volga: 'Volga',
};

const messages = defineMessages(
  {
    delta_tab: 'Direction',
    delta_question: 'What is my position worth if spot moves?',
    delta_scenario: 'Spot +1%',
    delta_axis: 'estimated P&L for a +1% spot move',
    delta_profileAxis: 'Net delta at each spot price: the perp position your options behave like',
    delta_lesson: 'Delta is your options book expressed as a perp position right now.',
    vega_tab: 'IV',
    vega_question: 'What happens if implied volatility rises?',
    vega_scenario: 'IV +1 point',
    vega_axis: 'estimated P&L for a +1 vol-point IV move',
    vega_profileAxis: 'Dollars gained per +1 vol point of IV, at each spot price',
    vega_lesson: 'A vol point means 60% IV moving to 61%, not a 1% relative change.',
    gamma_tab: 'Big moves',
    gamma_question: 'Does a large spot move help or hurt?',
    gamma_scenario: 'Spot ±5%',
    gamma_axis: 'curvature P&L for a ±5% spot move',
    gamma_profileAxis: 'Delta change for a 1% spot move, at each spot price',
    gamma_lesson:
      'Gamma is the extra curvature beyond your current delta. It has the same sign up or down.',
    theta_tab: 'Time decay',
    theta_question: 'Am I paying or collecting time decay?',
    theta_scenario: '24 hours pass',
    theta_axis: 'estimated P&L after 24 hours with spot and IV unchanged',
    theta_profileAxis: 'Dollars of daily decay at each spot price',
    theta_lesson:
      'Theta is the rent on convexity: long options pay it daily, short options collect it. Positive theta usually means short gamma.',
    vanna_tab: 'Hedge drift',
    vanna_question: 'How does an IV move change my perp hedge?',
    vanna_scenario: 'IV +5 points',
    vanna_axis: 'change in underlying delta after IV rises 5 points',
    vanna_profileAxis: 'Delta change per +1 vol point of IV, at each spot price',
    vanna_lesson:
      'Vanna does not directly show P&L; it shows how much your directional hedge can drift as IV changes.',
    volga_tab: 'Vol convexity',
    volga_question: 'Does a large IV move add hidden curvature?',
    volga_scenario: 'IV ±5 points',
    volga_axis: 'second-order P&L for a ±5 vol-point IV move',
    volga_profileAxis:
      'P&L for a parallel IV shift: full repricing against the vega-only line. The gap is volga.',
    volga_lesson: 'Volga is to volatility what gamma is to spot: the second-order effect after vega.',
    perVolPt: '{v} / vol pt',
    perDay: '{v} / day',
    deltaPerVolPt: '{v} Δ / vol pt',
    ivNow: 'IV now',
    ivPts: 'IV {v} pts',
    perVolPoint: '{v} / vol point',
    deltaPerOnePctSpot: '{v} {u} Δ / 1% spot',
    deltaPerVolPoint: '{v} Δ / vol point',
    perVolPoint2: '{v} / vol point²',
    posture_flat: 'FLAT',
    posture_longDelta: 'LONG DELTA',
    posture_shortDelta: 'SHORT DELTA',
    posture_longVol: 'LONG VOL',
    posture_shortVol: 'SHORT VOL',
    posture_longConvexity: 'LONG CONVEXITY',
    posture_shortConvexity: 'SHORT CONVEXITY',
    posture_collectingTheta: 'COLLECTING THETA',
    posture_payingTheta: 'PAYING THETA',
    posture_hedgeGrows: 'HEDGE GROWS WITH IV',
    posture_hedgeShrinks: 'HEDGE SHRINKS WITH IV',
    posture_longVolConvexity: 'LONG VOL CONVEXITY',
    posture_shortVolConvexity: 'SHORT VOL CONVEXITY',
    selectUnderlying: 'Select BTC or ETH to calculate the perp hedge.',
    noAction: 'No action needed for this Greek.',
    gammaAction: 'Recheck and rebalance delta after spot moves.',
    thetaPays: 'Decay pays you; watch the short gamma that funds it.',
    thetaCosts: 'You need realized moves to out-earn this daily decay.',
    vannaAction: 'Recheck the perp hedge after a material IV move.',
    volgaAction: 'A perp cannot hedge this; offset it with options.',
    perpHedge: 'Perp hedge to flatten',
    practicalAction: 'Practical action',
    underlyingFallback: 'underlying',
    noLiveSpot: 'Live spot is missing, so the curve cannot be drawn.',
    selectOne: 'Select one underlying to draw its curve.',
    noLegIv: 'No leg in this expiry has a live IV to reprice with.',
    fullReprice: 'Full reprice',
    vegaOnly: 'Vega only',
    kicker: 'Options → perp translator',
    title: 'Where does my risk live?',
    riskLens: 'Risk lens',
    expiry: 'Expiry',
    emptyTitle: 'No strike risk to translate yet',
    emptyBody:
      'Add an option position or wait for live marks. This panel will convert its Greeks into scenario P&L and hedge actions.',
    rawAcross: 'Raw {greek} across {expiry}',
    rawSpotMissing: 'Raw exposure · live spot missing',
    ifScenario: 'If {scenario}',
    greekEstimate: 'Greek estimate, holding other inputs fixed',
    deltaFoot: 'Equivalent opposite delta, before fees and slippage',
    thetaFoot: 'Decay accelerates into expiry; this is today’s rate',
    otherFoot: 'Use the scenario grid above for combined shocks',
    spotMissingWarning: 'Live spot missing, so the chart is showing the raw Greek.',
    staleWarning: 'Marks stale—showing the last usable snapshot.',
    pnlAcrossIv: 'P&L across IV shocks',
    profileAcrossSpot: 'Risk profile across spot',
    modelNote: 'Black-76, each leg keeps its live IV (sticky strike)',
    excluded_one: ' · {n} leg without IV left out',
    excluded_other: ' · {n} legs without IV left out',
    byStrikeTitle: 'Risk concentration by strike',
    barsShow: 'Bars show',
    rawGreek: 'raw {greek}',
    gains: 'gains',
    loses: 'loses',
    chartView: 'Chart view',
    curve: 'Curve',
    byStrike: 'By strike',
    currentIv: 'CURRENT IV',
    spotLabel: 'SPOT {v}',
    strikeTitle: 'Strike {strike} · {value}',
    singleStrike:
      'One strike only—showing its exposure as a bucket; there is no curve to infer yet.',
    selectedBucket: 'Selected risk bucket',
    strikeLabel: '{v} strike',
    next24h: 'over the next 24 hours',
    underScenario: 'under {scenario}',
    grossShare: 'Share of gross risk',
    rawGreekLabel: 'Raw {greek}',
    openContracts: 'Open contracts',
    ivCheckpoints: 'IV checkpoints at {v}',
    noIvComparison: 'No entry/live IV comparison for this strike.',
    live: 'live {v}',
    entryBe: 'entry BE {v}',
    cushion: 'cushion {v}',
  },
  {
    delta_tab: 'Dirección',
    delta_question: '¿Cuánto vale mi posición si se mueve el spot?',
    delta_scenario: 'Spot +1%',
    delta_axis: 'P&L estimado para un movimiento del spot de +1%',
    delta_profileAxis:
      'Delta neta a cada precio spot: la posición en perp a la que equivalen tus opciones',
    delta_lesson: 'La delta es tu libro de opciones expresado como posición en perp ahora mismo.',
    vega_tab: 'IV',
    vega_question: '¿Qué pasa si sube la volatilidad implícita?',
    vega_scenario: 'IV +1 punto',
    vega_axis: 'P&L estimado para un movimiento de IV de +1 punto de vol',
    vega_profileAxis: 'Dólares ganados por cada +1 punto de vol de IV, a cada precio spot',
    vega_lesson: 'Un punto de vol significa que la IV pasa de 60% a 61%, no un cambio relativo de 1%.',
    gamma_tab: 'Grandes movimientos',
    gamma_question: '¿Un movimiento grande del spot ayuda o perjudica?',
    gamma_scenario: 'Spot ±5%',
    gamma_axis: 'P&L por curvatura para un movimiento del spot de ±5%',
    gamma_profileAxis: 'Cambio de delta para un movimiento del spot de 1%, a cada precio spot',
    gamma_lesson:
      'La gamma es la curvatura adicional más allá de tu delta actual. Tiene el mismo signo al subir o al bajar.',
    theta_tab: 'Decaimiento',
    theta_question: '¿Estoy pagando o cobrando decaimiento temporal?',
    theta_scenario: 'Pasan 24 horas',
    theta_axis: 'P&L estimado después de 24 horas con spot e IV sin cambios',
    theta_profileAxis: 'Dólares de decaimiento diario a cada precio spot',
    theta_lesson:
      'La theta es el alquiler de la convexidad: las opciones long la pagan cada día, las short la cobran. Una theta positiva suele implicar short gamma.',
    vanna_tab: 'Deriva de cobertura',
    vanna_question: '¿Cómo cambia mi cobertura en perp un movimiento de IV?',
    vanna_scenario: 'IV +5 puntos',
    vanna_axis: 'cambio en la delta del subyacente después de que la IV sube 5 puntos',
    vanna_profileAxis: 'Cambio de delta por cada +1 punto de vol de IV, a cada precio spot',
    vanna_lesson:
      'La vanna no muestra P&L directamente; muestra cuánto puede desviarse tu cobertura direccional cuando cambia la IV.',
    volga_tab: 'Convexidad de vol',
    volga_question: '¿Un movimiento grande de IV agrega curvatura oculta?',
    volga_scenario: 'IV ±5 puntos',
    volga_axis: 'P&L de segundo orden para un movimiento de IV de ±5 puntos de vol',
    volga_profileAxis:
      'P&L ante un desplazamiento paralelo de IV: revaloración completa frente a la línea solo vega. La diferencia es la volga.',
    volga_lesson:
      'La volga es a la volatilidad lo que la gamma es al spot: el efecto de segundo orden después de la vega.',
    perVolPt: '{v} / pt de vol',
    perDay: '{v} / día',
    deltaPerVolPt: '{v} Δ / pt de vol',
    ivNow: 'IV actual',
    ivPts: 'IV {v} pts',
    perVolPoint: '{v} / punto de vol',
    deltaPerOnePctSpot: '{v} {u} Δ / 1% de spot',
    deltaPerVolPoint: '{v} Δ / punto de vol',
    perVolPoint2: '{v} / punto de vol²',
    posture_flat: 'PLANO',
    posture_longDelta: 'LONG DELTA',
    posture_shortDelta: 'SHORT DELTA',
    posture_longVol: 'LONG VOL',
    posture_shortVol: 'SHORT VOL',
    posture_longConvexity: 'LONG CONVEXIDAD',
    posture_shortConvexity: 'SHORT CONVEXIDAD',
    posture_collectingTheta: 'COBRANDO THETA',
    posture_payingTheta: 'PAGANDO THETA',
    posture_hedgeGrows: 'LA COBERTURA CRECE CON LA IV',
    posture_hedgeShrinks: 'LA COBERTURA SE REDUCE CON LA IV',
    posture_longVolConvexity: 'LONG CONVEXIDAD DE VOL',
    posture_shortVolConvexity: 'SHORT CONVEXIDAD DE VOL',
    selectUnderlying: 'Selecciona BTC o ETH para calcular la cobertura en perp.',
    noAction: 'No se necesita ninguna acción para esta griega.',
    gammaAction: 'Revisa y rebalancea la delta después de que se mueva el spot.',
    thetaPays: 'El decaimiento te paga; vigila la short gamma que lo financia.',
    thetaCosts: 'Necesitas movimientos realizados que superen este decaimiento diario.',
    vannaAction: 'Revisa la cobertura en perp después de un movimiento relevante de IV.',
    volgaAction: 'Un perp no puede cubrir esto; compénsalo con opciones.',
    perpHedge: 'Cobertura en perp para neutralizar',
    practicalAction: 'Acción práctica',
    underlyingFallback: 'subyacente',
    noLiveSpot: 'Falta el spot en vivo, así que no se puede dibujar la curva.',
    selectOne: 'Selecciona un subyacente para dibujar su curva.',
    noLegIv: 'Ningún leg de este vencimiento tiene IV en vivo para revalorar.',
    fullReprice: 'Revaloración completa',
    vegaOnly: 'Solo vega',
    kicker: 'Traductor opciones → perp',
    title: '¿Dónde está mi riesgo?',
    riskLens: 'Lente de riesgo',
    expiry: 'Vencimiento',
    emptyTitle: 'Aún no hay riesgo por strike para traducir',
    emptyBody:
      'Agrega una posición de opciones o espera los marks en vivo. Este panel convertirá sus griegas en P&L por escenario y acciones de cobertura.',
    rawAcross: '{greek} bruta en {expiry}',
    rawSpotMissing: 'Exposición bruta · falta el spot en vivo',
    ifScenario: 'Si {scenario}',
    greekEstimate: 'Estimación por griegas, con los demás factores fijos',
    deltaFoot: 'Delta opuesta equivalente, antes de comisiones y slippage',
    thetaFoot: 'El decaimiento se acelera hacia el vencimiento; esta es la tasa de hoy',
    otherFoot: 'Usa la matriz de escenarios de arriba para shocks combinados',
    spotMissingWarning: 'Falta el spot en vivo, así que el gráfico muestra la griega bruta.',
    staleWarning: 'Marks desactualizados—mostrando el último snapshot utilizable.',
    pnlAcrossIv: 'P&L ante shocks de IV',
    profileAcrossSpot: 'Perfil de riesgo según el spot',
    modelNote: 'Black-76, cada leg mantiene su IV en vivo (sticky strike)',
    excluded_one: ' · {n} leg sin IV excluido',
    excluded_other: ' · {n} legs sin IV excluidos',
    byStrikeTitle: 'Concentración de riesgo por strike',
    barsShow: 'Las barras muestran',
    rawGreek: '{greek} bruta',
    gains: 'gana',
    loses: 'pierde',
    chartView: 'Vista del gráfico',
    curve: 'Curva',
    byStrike: 'Por strike',
    currentIv: 'IV ACTUAL',
    spotLabel: 'SPOT {v}',
    strikeTitle: 'Strike {strike} · {value}',
    singleStrike:
      'Un solo strike—mostrando su exposición como un bloque; todavía no hay curva que inferir.',
    selectedBucket: 'Bloque de riesgo seleccionado',
    strikeLabel: 'strike {v}',
    next24h: 'en las próximas 24 horas',
    underScenario: 'con {scenario}',
    grossShare: 'Parte del riesgo bruto',
    rawGreekLabel: '{greek} bruta',
    openContracts: 'Contratos abiertos',
    ivCheckpoints: 'Puntos de control de IV en {v}',
    noIvComparison: 'No hay comparación de IV de entrada/en vivo para este strike.',
    live: 'en vivo {v}',
    entryBe: 'BE de entrada {v}',
    cushion: 'colchón {v}',
  },
);

type T = Translate<typeof messages.en>;

function modeMeta(mode: StrikeRiskMode, t: T): ModeMeta {
  return {
    tab: t(`${mode}_tab`),
    greek: GREEK_LABELS[mode],
    question: t(`${mode}_question`),
    scenario: t(`${mode}_scenario`),
    axis: t(`${mode}_axis`),
    profileAxis: t(`${mode}_profileAxis`),
    lesson: t(`${mode}_lesson`),
  };
}

const WIDTH = 760;
const HEIGHT = 250;
const PADDING = { top: 24, right: 20, bottom: 38, left: 72 };

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function fmtNumber(value: number, digits = 4): string {
  const abs = Math.abs(value);
  if (abs >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 10) return trimTrailingZeros(value.toFixed(1));
  if (abs >= 1) return trimTrailingZeros(value.toFixed(2));
  if (abs === 0) return '0';
  const fixed = value.toFixed(digits);
  if (Number(fixed) === 0) return value.toPrecision(2);
  return trimTrailingZeros(fixed);
}

function fmtSignedNumber(value: number, digits = 4): string {
  return `${value > 0 ? '+' : ''}${fmtNumber(value, digits)}`;
}

function fmtUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = usdDigits(abs);
  return `${value >= 0 ? '+' : '-'}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function usdDigits(abs: number): number {
  return abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
}

function fmtAxisUsd(value: number, digits: number): string {
  if (value === 0) return '$0';
  return `${value > 0 ? '+' : '-'}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function fmtStrike(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function stepDigits(step: number): number {
  if (!(step > 0)) return 0;
  const magnitude = Math.floor(Math.log10(step));
  const fractionalMantissa = !Number.isInteger(Number((step / 10 ** magnitude).toFixed(6)));
  return Math.max(0, Math.min(8, -magnitude + (fractionalMantissa ? 1 : 0)));
}

function isUsdProfile(mode: StrikeRiskMode): boolean {
  return mode === 'vega' || mode === 'theta' || mode === 'volga';
}

function profileTick(mode: StrikeRiskMode, value: number, step: number): string {
  const digits = stepDigits(step);
  if (isUsdProfile(mode)) return fmtAxisUsd(value, digits);
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function profileValue(mode: StrikeRiskMode, value: number, underlying: string, t: T): string {
  switch (mode) {
    case 'delta':
      return `${fmtSignedNumber(value)} ${underlying}`;
    case 'gamma':
      return `${fmtSignedNumber(value)} Δ / 1%`;
    case 'vega':
      return t('perVolPt', { v: fmtUsd(value) });
    case 'theta':
      return t('perDay', { v: fmtUsd(value) });
    case 'vanna':
      return t('deltaPerVolPt', { v: fmtSignedNumber(value, 6) });
    case 'volga':
      return fmtUsd(value);
  }
}

function fmtVolShift(value: number, t: T): string {
  return value === 0 ? t('ivNow') : t('ivPts', { v: `${value > 0 ? '+' : ''}${fmtNumber(value)}` });
}

function fmtIv(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function scenarioDisplay(
  mode: StrikeRiskMode,
  value: number,
  underlying: string,
  spotUsd: number | null,
): string {
  if (spotUsd == null && mode === 'delta') {
    return `${fmtSignedNumber(value)} ${underlying} Δ`;
  }
  if (spotUsd == null && mode === 'gamma') {
    return `${fmtSignedNumber(value, 6)} Δ / $1`;
  }
  return mode === 'vanna' ? `${fmtSignedNumber(value)} ${underlying} Δ` : fmtUsd(value);
}

function rawDisplay(
  mode: StrikeRiskMode,
  value: number,
  underlying: string,
  spotUsd: number | null,
  t: T,
): string {
  switch (mode) {
    case 'delta':
      return `${fmtSignedNumber(value)} ${underlying}`;
    case 'vega':
      return t('perVolPoint', { v: fmtUsd(value) });
    case 'theta':
      return t('perDay', { v: fmtUsd(value) });
    case 'gamma':
      // Raw gamma per $1 is ~1e-7 on BTC; per 1% spot move is the readable unit.
      return spotUsd == null
        ? `${fmtSignedNumber(value, 6)} Δ / $1`
        : t('deltaPerOnePctSpot', { v: fmtSignedNumber(value * spotUsd * 0.01), u: underlying });
    case 'vanna':
      return t('deltaPerVolPoint', { v: fmtSignedNumber(value, 6) });
    case 'volga':
      return t('perVolPoint2', { v: fmtUsd(value) });
  }
}

function posture(mode: StrikeRiskMode, value: number, t: T): string {
  if (Math.abs(value) < 1e-12) return t('posture_flat');
  const long = value > 0;
  if (mode === 'delta') return t(long ? 'posture_longDelta' : 'posture_shortDelta');
  if (mode === 'vega') return t(long ? 'posture_longVol' : 'posture_shortVol');
  if (mode === 'gamma') return t(long ? 'posture_longConvexity' : 'posture_shortConvexity');
  if (mode === 'theta') return t(long ? 'posture_collectingTheta' : 'posture_payingTheta');
  if (mode === 'vanna') return t(long ? 'posture_hedgeGrows' : 'posture_hedgeShrinks');
  return t(long ? 'posture_longVolConvexity' : 'posture_shortVolConvexity');
}

function actionText(
  mode: StrikeRiskMode,
  rawValue: number,
  underlying: string,
  hasUnderlying: boolean,
  t: T,
): string {
  if (mode === 'delta' && !hasUnderlying) {
    return t('selectUnderlying');
  }
  if (Math.abs(rawValue) < 1e-12) return t('noAction');
  if (mode === 'delta') {
    const side = rawValue > 0 ? 'SHORT' : 'LONG';
    return `${side} ${fmtNumber(Math.abs(rawValue))} ${underlying}-PERP`;
  }
  if (mode === 'gamma') return t('gammaAction');
  if (mode === 'theta') {
    return rawValue > 0 ? t('thetaPays') : t('thetaCosts');
  }
  if (mode === 'vanna') return t('vannaAction');
  return t('volgaAction');
}

function actionLabel(mode: StrikeRiskMode, t: T): string {
  return mode === 'delta' ? t('perpHedge') : t('practicalAction');
}

export default function PortfolioVegaCurve({
  positions,
  byStrike,
  breakEven,
  spotUsd,
  underlying,
}: Props) {
  const t = useT(messages);
  const locale = useLocale();
  const [mode, setMode] = useState<StrikeRiskMode>('delta');
  const [view, setView] = useState<ChartView>('curve');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [stickyByStrike, setStickyByStrike] = useState<VegaByStrikeRow[] | null>(null);
  const [stickyBreakEven, setStickyBreakEven] = useState<BreakEvenIvRow[] | null>(null);
  const meta = modeMeta(mode, t);
  const hasUnderlying = underlying != null && underlying !== 'all';
  const asset = hasUnderlying ? underlying : t('underlyingFallback');

  useEffect(() => {
    if (byStrike.length === 0) {
      setStickyByStrike(null);
      return;
    }
    if (stickyByStrike != null && !sameLegSignature(byStrike, stickyByStrike)) {
      setStickyByStrike(null);
      return;
    }
    if (hasUsefulGreeks(byStrike)) setStickyByStrike(byStrike);
  }, [byStrike, stickyByStrike]);

  useEffect(() => {
    if (breakEven.length === 0) {
      setStickyBreakEven(null);
      return;
    }
    if (hasUsefulBreakEven(breakEven)) setStickyBreakEven(breakEven);
  }, [breakEven]);

  const displayByStrike =
    byStrike.length > 0 && (hasUsefulGreeks(byStrike) || stickyByStrike == null)
      ? byStrike
      : (stickyByStrike ?? byStrike);
  const displayBreakEven =
    breakEven.length > 0 && (hasUsefulBreakEven(breakEven) || stickyBreakEven == null)
      ? breakEven
      : (stickyBreakEven ?? breakEven);
  const isStale = displayByStrike !== byStrike || displayBreakEven !== breakEven;

  const expiries = useMemo(
    () => Array.from(new Set(displayByStrike.map((row) => row.expiry))).sort(),
    [displayByStrike],
  );
  const activeExpiry = expiry != null && expiries.includes(expiry) ? expiry : (expiries[0] ?? null);
  const buckets = useMemo(
    () => buildStrikeRiskBuckets(displayByStrike, activeExpiry, mode, spotUsd),
    [activeExpiry, displayByStrike, mode, spotUsd],
  );
  const totalRaw = buckets.reduce((sum, bucket) => sum + bucket.rawValue, 0);
  const totalScenario = buckets.reduce((sum, bucket) => sum + bucket.scenarioValue, 0);
  const defaultStrike =
    buckets.reduce<(typeof buckets)[number] | null>(
      (largest, bucket) =>
        largest == null || Math.abs(bucket.scenarioValue) > Math.abs(largest.scenarioValue)
          ? bucket
          : largest,
      null,
    )?.strike ?? null;
  const activeStrike = buckets.some((bucket) => bucket.strike === selectedStrike)
    ? selectedStrike
    : defaultStrike;
  const activeBucket = buckets.find((bucket) => bucket.strike === activeStrike) ?? null;
  const grossScenario = buckets.reduce((sum, bucket) => sum + Math.abs(bucket.scenarioValue), 0);
  const concentration =
    activeBucket == null || grossScenario === 0
      ? 0
      : (Math.abs(activeBucket.scenarioValue) / grossScenario) * 100;

  const chart = useMemo(() => {
    if (buckets.length === 0) return null;
    const maxAbs = Math.max(...buckets.map((bucket) => Math.abs(bucket.scenarioValue)), 0.000001);
    const yExtent = maxAbs * 1.2;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const strikes = buckets.map((bucket) => bucket.strike);
    const spot = spotUsd != null && Number.isFinite(spotUsd) && spotUsd > 0 ? spotUsd : null;
    const lo = Math.min(...strikes, spot ?? Infinity);
    const hi = Math.max(...strikes, spot ?? -Infinity);
    const pad = Math.max((hi - lo) * 0.1, ((hi + lo) / 2) * 0.03);
    const domainLo = lo - pad;
    const domainHi = hi + pad;
    const toX = (price: number) =>
      PADDING.left + ((price - domainLo) / (domainHi - domainLo)) * innerW;
    const xs = strikes.map(toX);
    let minGap = Infinity;
    for (let i = 1; i < xs.length; i += 1) minGap = Math.min(minGap, xs[i]! - xs[i - 1]!);
    const barWidth = Math.max(3, Math.min(24, minGap * 0.7));
    const hitEdges = xs.map((x, i) => ({
      left: i === 0 ? PADDING.left : (xs[i - 1]! + x) / 2,
      right: i === xs.length - 1 ? WIDTH - PADDING.right : (x + xs[i + 1]!) / 2,
    }));
    const zeroY = PADDING.top + innerH / 2;
    const toY = (value: number) => zeroY - (value / yExtent) * (innerH / 2);
    return { barWidth, hitEdges, maxAbs, spot, toX, toY, xs, zeroY };
  }, [buckets, spotUsd]);

  const visibleStrikeLabels = useMemo(() => {
    const visible = new Set<number>();
    if (chart == null) return visible;
    const minLabelGap = 52;
    const activeIndex = buckets.findIndex((bucket) => bucket.strike === activeStrike);
    const activeX = activeIndex >= 0 ? chart.xs[activeIndex]! : null;
    let lastX = -Infinity;
    buckets.forEach((bucket, index) => {
      const x = chart.xs[index]!;
      if (index === activeIndex) {
        visible.add(bucket.strike);
        return;
      }
      if (activeX != null && Math.abs(x - activeX) < minLabelGap) return;
      if (x - lastX < minLabelGap) return;
      visible.add(bucket.strike);
      lastX = x;
    });
    return visible;
  }, [activeStrike, buckets, chart]);
  const yTickDigits = chart == null ? 2 : usdDigits(chart.maxAbs);

  const profileLegs = useMemo(
    () => buildProfileLegs(positions, displayBreakEven, activeExpiry),
    [activeExpiry, displayBreakEven, positions],
  );
  const mixedUnderlyings =
    new Set(
      positions.filter((leg) => leg.expiry === activeExpiry).map((leg) => leg.underlying),
    ).size > 1;
  const curveUnavailableReason =
    spotUsd == null || !(spotUsd > 0)
      ? t('noLiveSpot')
      : mixedUnderlyings
        ? t('selectOne')
        : profileLegs.legs.length === 0
          ? t('noLegIv')
          : null;
  const activeView: ChartView = curveUnavailableReason == null ? view : 'strikes';

  const profile = useMemo(() => {
    if (curveUnavailableReason != null || spotUsd == null) return null;
    const nowMs = Date.now();
    if (mode === 'volga') {
      const shock = buildVolShockProfile(profileLegs.legs, spotUsd, nowMs);
      const lines: ProfileLine[] = [
        { label: t('fullReprice'), values: shock.fullPnlUsd, emphasis: 1 },
        { label: t('vegaOnly'), values: shock.vegaOnlyPnlUsd, emphasis: 0.5, dashed: true },
      ];
      return { xs: shock.shiftsVolPts, lines };
    }
    const spot = buildSpotProfile(profileLegs.legs, mode, spotUsd, nowMs, locale);
    const lines: ProfileLine[] = spot.series.map((series, index) => ({
      label: series.label,
      values: series.values,
      emphasis: index === 0 ? 1 : index === 1 ? 0.55 : 0.32,
      dashed: index > 0,
    }));
    return { xs: spot.prices, lines };
  }, [curveUnavailableReason, locale, mode, profileLegs, spotUsd, t]);

  const activeBreakEvenRows = useMemo(() => {
    if (activeExpiry == null || activeStrike == null) return [];
    return displayBreakEven
      .filter((row) => row.expiry === activeExpiry && row.strike === activeStrike)
      .sort((left, right) => left.optionRight.localeCompare(right.optionRight));
  }, [activeExpiry, activeStrike, displayBreakEven]);

  return (
    <section className={styles.wrap} style={{ '--risk-color': COLORS[mode] } as CSSProperties}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.kicker}>{t('kicker')}</span>
          <h3 className={styles.title}>{t('title')}</h3>
          <span className={styles.subtitle}>{meta.question}</span>
        </div>
        <div className={styles.controls}>
          <div className={styles.toggles} aria-label={t('riskLens')}>
            {MODES.map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={styles.toggle}
                aria-pressed={mode === nextMode}
                onClick={() => setMode(nextMode)}
              >
                <span>{t(`${nextMode}_tab`)}</span>
                <small>{GREEK_LABELS[nextMode]}</small>
              </button>
            ))}
          </div>
          {expiries.length > 0 && (
            <select
              value={activeExpiry ?? ''}
              onChange={(event) => setExpiry(event.target.value)}
              className={styles.select}
              aria-label={t('expiry')}
            >
              {expiries.map((exp) => (
                <option key={exp} value={exp}>
                  {exp}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t('emptyTitle')}</strong>
          <span>{t('emptyBody')}</span>
        </div>
      ) : (
        <>
          <div className={styles.readout}>
            <div
              className={styles.readoutPrimary}
              data-sign={totalRaw >= 0 ? 'positive' : 'negative'}
            >
              <span className={styles.readoutLabel}>{posture(mode, totalRaw, t)}</span>
              <strong>{rawDisplay(mode, totalRaw, asset, spotUsd, t)}</strong>
              <small>{t('rawAcross', { greek: meta.greek, expiry: activeExpiry ?? '' })}</small>
            </div>
            <div className={styles.readoutCell}>
              <span className={styles.readoutLabel}>
                {spotUsd == null && (mode === 'delta' || mode === 'gamma')
                  ? t('rawSpotMissing')
                  : t('ifScenario', { scenario: meta.scenario.toLowerCase() })}
              </span>
              <strong data-sign={totalScenario >= 0 ? 'positive' : 'negative'}>
                {scenarioDisplay(mode, totalScenario, asset, spotUsd)}
              </strong>
              <small>{t('greekEstimate')}</small>
            </div>
            <div className={styles.readoutCell}>
              <span className={styles.readoutLabel}>{actionLabel(mode, t)}</span>
              <strong className={styles.action}>
                {actionText(mode, totalRaw, asset, hasUnderlying, t)}
              </strong>
              <small>
                {mode === 'delta'
                  ? t('deltaFoot')
                  : mode === 'theta'
                    ? t('thetaFoot')
                    : t('otherFoot')}
              </small>
            </div>
          </div>

          <div className={styles.lesson}>
            <span className={styles.lessonGreek}>{meta.greek}</span>
            <span>{meta.lesson}</span>
            {spotUsd == null && (mode === 'delta' || mode === 'gamma') && (
              <span className={styles.warning}>{t('spotMissingWarning')}</span>
            )}
            {isStale && (
              <span className={styles.warning}>{t('staleWarning')}</span>
            )}
          </div>

          <div className={styles.chartHeader}>
            {activeView === 'curve' ? (
              <div>
                <span className={styles.chartTitle}>
                  {mode === 'volga' ? t('pnlAcrossIv') : t('profileAcrossSpot')}
                </span>
                <span className={styles.chartAxis}>{meta.profileAxis}</span>
                <span className={styles.chartAxis}>
                  {t('modelNote')}
                  {profileLegs.excluded > 0 &&
                    t(profileLegs.excluded === 1 ? 'excluded_one' : 'excluded_other', {
                      n: profileLegs.excluded,
                    })}
                </span>
              </div>
            ) : (
              <div>
                <span className={styles.chartTitle}>{t('byStrikeTitle')}</span>
                <span className={styles.chartAxis}>
                  {t('barsShow')}{' '}
                  {spotUsd == null && (mode === 'delta' || mode === 'gamma')
                    ? t('rawGreek', { greek: meta.greek })
                    : meta.axis}
                </span>
              </div>
            )}
            <div className={styles.chartControls}>
              <div className={styles.legend}>
                {activeView === 'curve' && profile != null ? (
                  profile.lines.map((line) => (
                    <span key={line.label}>
                      <i
                        className={styles.lineSwatch}
                        data-dashed={line.dashed || undefined}
                        style={{ opacity: line.emphasis }}
                      />
                      {line.label}
                    </span>
                  ))
                ) : (
                  <>
                    <span>
                      <i className={styles.gainSwatch} />
                      {t('gains')}
                    </span>
                    <span>
                      <i className={styles.lossSwatch} />
                      {t('loses')}
                    </span>
                  </>
                )}
              </div>
              <div className={styles.viewToggle} aria-label={t('chartView')}>
                <button
                  type="button"
                  aria-pressed={activeView === 'curve'}
                  disabled={curveUnavailableReason != null}
                  title={curveUnavailableReason ?? undefined}
                  onClick={() => setView('curve')}
                >
                  {t('curve')}
                </button>
                <button
                  type="button"
                  aria-pressed={activeView === 'strikes'}
                  onClick={() => setView('strikes')}
                >
                  {t('byStrike')}
                </button>
              </div>
            </div>
          </div>

          <div
            className={styles.chartWrap}
            data-single={(activeView === 'strikes' && buckets.length === 1) || undefined}
          >
            {activeView === 'curve' && profile != null && (
              <GreekProfileChart
                xs={profile.xs}
                lines={profile.lines}
                color={COLORS[mode]}
                lossColor={LOSS_COLOR}
                anchorX={mode === 'volga' ? 0 : spotUsd}
                anchorLabel={
                  mode === 'volga' || spotUsd == null
                    ? t('currentIv')
                    : t('spotLabel', { v: fmtStrike(Math.round(spotUsd)) })
                }
                markers={
                  mode === 'volga'
                    ? []
                    : buckets.map((bucket) => ({
                        strike: bucket.strike,
                        positive: bucket.scenarioValue >= 0,
                      }))
                }
                activeStrike={activeStrike}
                onSelectStrike={setSelectedStrike}
                formatX={
                  mode === 'volga'
                    ? (value) => fmtVolShift(value, t)
                    : (value) => fmtStrike(Math.round(value))
                }
                formatTick={(value, step) => profileTick(mode, value, step)}
                formatValue={(value) => profileValue(mode, value, asset, t)}
                stale={isStale}
              />
            )}
            {activeView === 'strikes' && chart != null && (
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className={`${styles.svg} ${isStale ? styles.svgStale : ''}`}
              >
                <rect
                  x={PADDING.left}
                  y={PADDING.top}
                  width={WIDTH - PADDING.left - PADDING.right}
                  height={chart.zeroY - PADDING.top}
                  fill="rgba(80, 210, 193, 0.025)"
                />
                <rect
                  x={PADDING.left}
                  y={chart.zeroY}
                  width={WIDTH - PADDING.left - PADDING.right}
                  height={HEIGHT - PADDING.bottom - chart.zeroY}
                  fill="rgba(239, 97, 119, 0.025)"
                />
                {[chart.maxAbs, 0, -chart.maxAbs].map((tick) => {
                  const y = chart.toY(tick);
                  return (
                    <g key={tick}>
                      <line
                        x1={PADDING.left}
                        x2={WIDTH - PADDING.right}
                        y1={y}
                        y2={y}
                        stroke={tick === 0 ? '#44504d' : '#1b2321'}
                        strokeWidth={1}
                        strokeDasharray={tick === 0 ? '4 4' : undefined}
                      />
                      <text
                        x={PADDING.left - 9}
                        y={y + 3}
                        textAnchor="end"
                        fontSize={10}
                        fill="#74807d"
                      >
                        {mode === 'vanna' ||
                        (spotUsd == null && (mode === 'delta' || mode === 'gamma'))
                          ? scenarioDisplay(mode, tick, asset, spotUsd)
                          : fmtAxisUsd(tick, yTickDigits)}
                      </text>
                    </g>
                  );
                })}
                {chart.spot != null && (
                  <g pointerEvents="none">
                    <line
                      x1={chart.toX(chart.spot)}
                      x2={chart.toX(chart.spot)}
                      y1={PADDING.top - 6}
                      y2={HEIGHT - PADDING.bottom}
                      stroke="#9aa8a4"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                    <text
                      x={chart.toX(chart.spot)}
                      y={PADDING.top - 10}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#9aa8a4"
                    >
                      {t('spotLabel', { v: fmtStrike(Math.round(chart.spot)) })}
                    </text>
                  </g>
                )}
                {buckets.map((bucket, index) => {
                  const x = chart.xs[index]!;
                  const edges = chart.hitEdges[index]!;
                  const valueY = chart.toY(bucket.scenarioValue);
                  const y = Math.min(valueY, chart.zeroY);
                  const height = Math.max(2, Math.abs(chart.zeroY - valueY));
                  const selected = activeStrike === bucket.strike;
                  const highlightWidth = chart.barWidth + 10;
                  return (
                    <g
                      key={bucket.strike}
                      className={styles.barGroup}
                      onMouseEnter={() => setSelectedStrike(bucket.strike)}
                      onClick={() => setSelectedStrike(bucket.strike)}
                    >
                      <title>
                        {t('strikeTitle', {
                          strike: fmtStrike(bucket.strike),
                          value: scenarioDisplay(mode, bucket.scenarioValue, asset, spotUsd),
                        })}
                      </title>
                      <rect
                        x={edges.left}
                        y={PADDING.top}
                        width={Math.max(0, edges.right - edges.left)}
                        height={HEIGHT - PADDING.top - PADDING.bottom}
                        fill="transparent"
                      />
                      {selected && (
                        <rect
                          x={x - highlightWidth / 2}
                          y={PADDING.top}
                          width={highlightWidth}
                          height={HEIGHT - PADDING.top - PADDING.bottom}
                          rx={3}
                          fill="rgba(255, 255, 255, 0.04)"
                        />
                      )}
                      <rect
                        x={x - chart.barWidth / 2}
                        y={y}
                        width={chart.barWidth}
                        height={height}
                        rx={2}
                        fill={bucket.scenarioValue >= 0 ? COLORS[mode] : LOSS_COLOR}
                        opacity={selected ? 1 : 0.68}
                        stroke={selected ? '#eef5f3' : 'none'}
                        strokeWidth={selected ? 1 : 0}
                      />
                      <line
                        x1={x}
                        x2={x}
                        y1={HEIGHT - PADDING.bottom}
                        y2={HEIGHT - PADDING.bottom + 4}
                        stroke="#44504d"
                      />
                      {visibleStrikeLabels.has(bucket.strike) && (
                        <text
                          x={x}
                          y={HEIGHT - PADDING.bottom + 18}
                          textAnchor="middle"
                          fontSize={10}
                          fill={selected ? '#dbe5e2' : '#74807d'}
                        >
                          {fmtStrike(bucket.strike)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
            {activeView === 'strikes' && buckets.length === 1 && (
              <span className={styles.singleNote}>{t('singleStrike')}</span>
            )}
          </div>

          {activeBucket != null && (
            <div className={styles.inspector}>
              <div className={styles.inspectorSummary}>
                <span className={styles.inspectorEyebrow}>{t('selectedBucket')}</span>
                <strong>{t('strikeLabel', { v: fmtStrike(activeBucket.strike) })}</strong>
                <span>
                  {scenarioDisplay(mode, activeBucket.scenarioValue, asset, spotUsd)}{' '}
                  {mode === 'theta'
                    ? t('next24h')
                    : t('underScenario', { scenario: meta.scenario.toLowerCase() })}
                </span>
              </div>
              <div className={styles.inspectorStat}>
                <span>{t('grossShare')}</span>
                <strong>{concentration.toFixed(0)}%</strong>
              </div>
              <div className={styles.inspectorStat}>
                <span>{t('rawGreekLabel', { greek: meta.greek })}</span>
                <strong>{rawDisplay(mode, activeBucket.rawValue, asset, spotUsd, t)}</strong>
              </div>
              <div className={styles.inspectorStat}>
                <span>{t('openContracts')}</span>
                <strong>{fmtNumber(activeBucket.contracts, 2)}</strong>
              </div>
            </div>
          )}

          {activeStrike != null && (
            <div className={styles.breakEvenRow}>
              <span className={styles.breakEvenLabel}>
                {t('ivCheckpoints', { v: fmtStrike(activeStrike) })}
              </span>
              {activeBreakEvenRows.length === 0 ? (
                <span className={styles.breakEvenEmpty}>{t('noIvComparison')}</span>
              ) : (
                activeBreakEvenRows.map((row) => (
                  <span key={row.legId} className={styles.breakEvenChip}>
                    <strong>{row.optionRight === 'call' ? 'CALL' : 'PUT'}</strong>
                    <span>{t('live', { v: fmtIv(row.currentIv) })}</span>
                    <span>{t('entryBe', { v: fmtIv(row.breakEvenIv) })}</span>
                    <span data-sign={(row.ivCushionPct ?? 0) >= 0 ? 'positive' : 'negative'}>
                      {t('cushion', { v: fmtPct(row.ivCushionPct) })}
                    </span>
                  </span>
                ))
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
