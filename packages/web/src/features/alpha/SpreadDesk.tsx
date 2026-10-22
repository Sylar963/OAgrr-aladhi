import { useEffect, useMemo, useRef, useState } from 'react';
import { VENUE_IDS, type VenueId } from '@oggregator/protocol';
import { useChainQuery, useExpiries } from '@features/chain';
import { AlphaPortfolioContext } from '@features/portfolio';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { alphaMessages, humanizeRejection, VERTICAL_LABEL_KEYS } from './i18n';
import { scanSpreads, type SpreadCandidate } from './spread-scanner';
import { expiryPnl, type VerticalKind } from './vertical-pricing';
import styles from './SpreadDesk.module.css';

const money = (n: number | null) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const price = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const messages = defineMessages(
  {
    statusReview: 'Review assumptions',
    statusNoEdge: 'No model edge',
    statusOverBudget: 'Over budget',
    statusNoModel: 'Model unavailable',
    defineEyebrow: '01 / DEFINE THE TRADE',
    defineTitle: 'Find a spread that fits.',
    defineLead: 'One venue. Both legs. Risk shown for your actual size.',
    lossBudget: 'YOUR LOSS BUDGET / TRADE',
    setEquityBelow: 'Set equity below',
    manualBalance: 'Manual planning balance · not free margin',
    settingsAria: 'Spread scan settings',
    executionVenue: 'Execution venue',
    compareEach: 'Compare each venue',
    expiry: 'Expiry',
    noListedExpiry: 'No listed expiry',
    accountEquity: 'Account equity · USD',
    enterEquity: 'Enter current equity',
    riskBudget: 'Risk budget · %',
    sizePerLeg: 'Size per leg · {underlying}',
    extraReserve: 'Extra cost reserve · USD',
    rememberedNote:
      'Equity, risk and reserve are remembered on this browser; update equity before each session. Entry fees use public estimates. The extra reserve allows for settlement, exit fees or slippage; it is not a verified fee cap. Expiry payoff risk is not the exchange margin requirement.',
    modelAssumptions: 'Model assumptions · {mode}',
    yourForecast: 'Your forecast',
    marketBenchmark: 'Market benchmark',
    benchmarkNote:
      'The market benchmark uses this venue’s forward and the mean mark IV of the two legs in a flat-volatility lognormal model. It is a price comparison, not a prediction. A positive difference is a review candidate, not a buy/sell instruction.',
    evaluateForecast: 'Evaluate my expiry forecast',
    expectedMove: 'Expected mean price move by expiry · %',
    forecastVol: 'Forecast annual volatility · %',
    scenarioNote:
      'Scenario EV depends entirely on these assumptions. Changing them does not establish an edge. Fat tails, volatility changes and forecast error are not modeled.',
    resultsAria: 'Same-venue spread candidates',
    compareEyebrow: '02 / COMPARE CANDIDATES',
    setBudgetToScan: 'Set your account budget to scan',
    marketUnavailable: 'Market data unavailable',
    loadingQuotes: 'Loading venue quotes',
    noExpiryOnVenue: 'No listed expiry on this venue',
    noEligibleAtSize: 'No eligible quotes at this size',
    candidatesToInvestigate: '{n} candidates to investigate',
    noPositiveEdge: 'No positive model edge within budget',
    chooseExpiry: 'Choose an expiry',
    allPairsRefresh: 'All strike pairs in this expiry · Refreshes every 5 seconds',
    structure: 'Structure',
    allFour: 'All four verticals',
    withinBudgetOnly: 'Within budget only',
    marketAlert:
      'Market data unavailable. Refresh or choose another venue; no cached quote is presented as current.',
    loadingQuotesEllipsis: 'Loading venue quotes…',
    invalidInputs:
      'Enter positive equity, risk and quantity, plus a nonnegative cost reserve. These fields size the analysis; they do not submit an order.',
    matchesRanked:
      '{n} matches · ranked by budget, then model difference ÷ expiry P&L standard deviation',
    colStructure: 'Structure / bias',
    colStrikes: 'Buy / sell strike',
    colMaxGain: 'Max gain*',
    colMaxLoss: 'Max loss*',
    colEquityRisk: 'Equity risk',
    colScenarioEv: 'Scenario EV*',
    colModelDiff: 'Model difference*',
    colAssessment: 'Assessment',
    bullish: 'bullish',
    bearish: 'bearish',
    expirySettled: 'This expiry has settled or inputs are invalid.',
    noFilterMatch:
      'No spreads match the structure and risk filters. Adjust size or inspect over-budget candidates.',
    noEligiblePairs: 'No eligible pairs at this size and expiry.',
    showMore: 'Show 12 more {venue} spreads',
    quoteChecks: 'Quote checks and exclusions',
    showingTop: ' · showing top {n} matches',
    pairsCount: '{reason}: {n} pairs',
    checksNote:
      'Requires known fees, matching settlement on both legs, valid minimum/step, sufficient displayed size, quotes ≤15s old and timestamps ≤2s apart. Exclusion counts show the first failed check per pair. Same venue alone does not guarantee atomic execution.',
    footnote:
      '* Position dollars after estimated entry fees and your cost reserve. No trade is a valid result. A better rank does not mean positive expected profit. Coin-settled (inverse) spreads assume the net coin premium is hedged at the expiry forward; unhedged, it moves with the coin price. Their margin is posted in the coin.',
    staleSelection:
      'The selected spread no longer passes the current quote checks or filters. Select a current candidate.',
    quickRef: 'Credit or debit? A quick reference',
    putCreditTitle: 'Put credit · bullish',
    putCreditText: 'Sell the higher put, buy the lower put. Profit if price stays high enough.',
    callDebitTitle: 'Call debit · bullish',
    callDebitText: 'Buy the lower call, sell the higher call. Pay for upside with a capped gain.',
    callCreditTitle: 'Call credit · bearish',
    callCreditText: 'Sell the lower call, buy the higher call. Profit if price stays low enough.',
    putDebitTitle: 'Put debit · bearish',
    putDebitText: 'Buy the higher put, sell the lower put. Pay for downside with a capped gain.',
    winProbNote:
      'High win probability is not the same as good value. Buying is not automatically attractive when selling looks unfavorable. Both sides pay trading costs.',
    reviewAria: 'Selected spread review',
    reviewEyebrow: '03 / REVIEW BEFORE EXECUTION',
    buyLeg: 'BUY {q} {underlying}',
    sellLeg: 'SELL {q} {underlying}',
    grossCredit: 'Gross credit',
    grossDebit: 'Gross debit',
    entryFee: 'Estimated entry fee',
    extraReserveShort: 'Extra cost reserve',
    expiryBreakeven: 'Expiry breakeven*',
    probProfit: 'Model probability of profit*',
    roundTrip: 'Immediate round-trip estimate',
    netPremiumSettled: 'Net premium settled in {underlying}',
    evMarket:
      'EV values each leg at its own mark IV; probability is risk-neutral at the IV nearest breakeven.',
    evForecast: 'Probability and EV use your forecast distribution.',
    reserveNote:
      '* Includes the chosen reserve. Round-trip estimate uses reverse bid/ask quotes and estimated fees, excludes the reserve, and is not a guaranteed exit fill.',
    hedgedAssume: 'USD figures assume the {underlying} premium is hedged with the same-expiry future',
    unhedgedMove: '; unhedged, each 10% {underlying} move changes P&L by about {value}',
    quoteAge: 'Quote age {age}s · displayed entry capacity {capacity} {underlying}.',
    payoffAtPrice: 'Expiry payoff at a given settlement price',
    myReason: 'My reason for this trade',
    reasonPlaceholder: 'What do I expect, and why is this price attractive?',
    myExit: 'My exit / invalidation / review time',
    exitPlaceholder: 'Write the plan before opening the venue',
    checkedPositions:
      'I checked existing positions, free margin and the complete combo in the venue preview.',
    notesComplete: 'Review notes complete. Recheck the live venue price before deciding.',
    notesIncomplete:
      'Complete the three review fields before deciding. Notes remain only while this page is open.',
    thalexNote:
      'Thalex estimate assumes Tier 1 and an atomic combo: only the highest-fee leg is charged. Use the strategy builder’s net limit price and verify both legs. Combos are immediate-or-cancel; they cannot rest in the book. USDt daily settlement and portfolio margin still apply.',
    comboRules: 'Combo rules',
    fees: 'Fees',
    otherVenueNote:
      'Fee estimate assumes separate taker fees on both legs. Verify this venue’s combination-order support and margin before execution; separate orders can leave one leg unfilled.',
  },
  {
    statusReview: 'Revisar supuestos',
    statusNoEdge: 'Sin edge del modelo',
    statusOverBudget: 'Sobre el presupuesto',
    statusNoModel: 'Modelo no disponible',
    defineEyebrow: '01 / DEFINE EL TRADE',
    defineTitle: 'Encuentra un spread que encaje.',
    defineLead: 'Un exchange. Ambas patas. Riesgo mostrado para tu tamaño real.',
    lossBudget: 'TU PRESUPUESTO DE PÉRDIDA / TRADE',
    setEquityBelow: 'Define el capital abajo',
    manualBalance: 'Saldo de planificación manual · no es margen libre',
    settingsAria: 'Ajustes del escaneo de spreads',
    executionVenue: 'Exchange de ejecución',
    compareEach: 'Comparar cada exchange',
    expiry: 'Vencimiento',
    noListedExpiry: 'Sin vencimiento listado',
    accountEquity: 'Capital de la cuenta · USD',
    enterEquity: 'Ingresa el capital actual',
    riskBudget: 'Presupuesto de riesgo · %',
    sizePerLeg: 'Tamaño por pata · {underlying}',
    extraReserve: 'Reserva de costos extra · USD',
    rememberedNote:
      'El capital, el riesgo y la reserva se recuerdan en este navegador; actualiza el capital antes de cada sesión. Las comisiones de entrada usan estimaciones públicas. La reserva extra cubre liquidación, comisiones de salida o slippage; no es un tope de comisiones verificado. El riesgo de payoff al vencimiento no es el requisito de margen del exchange.',
    modelAssumptions: 'Supuestos del modelo · {mode}',
    yourForecast: 'Tu pronóstico',
    marketBenchmark: 'Referencia de mercado',
    benchmarkNote:
      'La referencia de mercado usa el forward de este exchange y la IV mark promedio de las dos patas en un modelo lognormal de volatilidad plana. Es una comparación de precios, no una predicción. Una diferencia positiva es un candidato a revisar, no una instrucción de compra/venta.',
    evaluateForecast: 'Evaluar mi pronóstico al vencimiento',
    expectedMove: 'Movimiento medio esperado del precio al vencimiento · %',
    forecastVol: 'Volatilidad anual pronosticada · %',
    scenarioNote:
      'El EV del escenario depende por completo de estos supuestos. Cambiarlos no establece un edge. No se modelan colas gruesas, cambios de volatilidad ni error de pronóstico.',
    resultsAria: 'Candidatos de spread en un solo exchange',
    compareEyebrow: '02 / COMPARA CANDIDATOS',
    setBudgetToScan: 'Define el presupuesto de tu cuenta para escanear',
    marketUnavailable: 'Datos de mercado no disponibles',
    loadingQuotes: 'Cargando cotizaciones del exchange',
    noExpiryOnVenue: 'Sin vencimiento listado en este exchange',
    noEligibleAtSize: 'Sin cotizaciones elegibles a este tamaño',
    candidatesToInvestigate: '{n} candidatos para investigar',
    noPositiveEdge: 'Sin edge positivo del modelo dentro del presupuesto',
    chooseExpiry: 'Elige un vencimiento',
    allPairsRefresh: 'Todos los pares de strikes de este vencimiento · Se actualiza cada 5 segundos',
    structure: 'Estructura',
    allFour: 'Los cuatro verticales',
    withinBudgetOnly: 'Solo dentro del presupuesto',
    marketAlert:
      'Datos de mercado no disponibles. Actualiza o elige otro exchange; no se presenta ninguna cotización en caché como actual.',
    loadingQuotesEllipsis: 'Cargando cotizaciones del exchange…',
    invalidInputs:
      'Ingresa capital, riesgo y cantidad positivos, además de una reserva de costos no negativa. Estos campos dimensionan el análisis; no envían una orden.',
    matchesRanked:
      '{n} coincidencias · ordenadas por presupuesto, luego diferencia del modelo ÷ desviación estándar del P&L al vencimiento',
    colStructure: 'Estructura / sesgo',
    colStrikes: 'Strike compra / venta',
    colMaxGain: 'Ganancia máx.*',
    colMaxLoss: 'Pérdida máx.*',
    colEquityRisk: 'Riesgo del capital',
    colScenarioEv: 'EV del escenario*',
    colModelDiff: 'Diferencia del modelo*',
    colAssessment: 'Evaluación',
    bullish: 'alcista',
    bearish: 'bajista',
    expirySettled: 'Este vencimiento ya liquidó o los datos son inválidos.',
    noFilterMatch:
      'Ningún spread coincide con los filtros de estructura y riesgo. Ajusta el tamaño o revisa los candidatos sobre el presupuesto.',
    noEligiblePairs: 'Sin pares elegibles a este tamaño y vencimiento.',
    showMore: 'Mostrar 12 spreads más de {venue}',
    quoteChecks: 'Controles de cotizaciones y exclusiones',
    showingTop: ' · mostrando las primeras {n} coincidencias',
    pairsCount: '{reason}: {n} pares',
    checksNote:
      'Requiere comisiones conocidas, liquidación coincidente en ambas patas, mínimo/paso válidos, tamaño mostrado suficiente, cotizaciones de ≤15s y timestamps a ≤2s entre sí. Los conteos de exclusión muestran el primer control fallido por par. Un solo exchange por sí solo no garantiza ejecución atómica.',
    footnote:
      '* Dólares de la posición después de comisiones de entrada estimadas y tu reserva de costos. No operar es un resultado válido. Un mejor ranking no implica ganancia esperada positiva. Los spreads liquidados en moneda (inversos) suponen que la prima neta en moneda se cubre al forward del vencimiento; sin cobertura, se mueve con el precio de la moneda. Su margen se deposita en la moneda.',
    staleSelection:
      'El spread seleccionado ya no pasa los controles de cotización o filtros actuales. Selecciona un candidato vigente.',
    quickRef: '¿Crédito o débito? Referencia rápida',
    putCreditTitle: 'Put credit · alcista',
    putCreditText: 'Vende el put más alto, compra el put más bajo. Ganas si el precio se mantiene suficientemente alto.',
    callDebitTitle: 'Call debit · alcista',
    callDebitText: 'Compra el call más bajo, vende el call más alto. Pagas por el alza con ganancia limitada.',
    callCreditTitle: 'Call credit · bajista',
    callCreditText: 'Vende el call más bajo, compra el call más alto. Ganas si el precio se mantiene suficientemente bajo.',
    putDebitTitle: 'Put debit · bajista',
    putDebitText: 'Compra el put más alto, vende el put más bajo. Pagas por la baja con ganancia limitada.',
    winProbNote:
      'Una alta probabilidad de ganar no equivale a buen valor. Comprar no es automáticamente atractivo cuando vender parece desfavorable. Ambos lados pagan costos de trading.',
    reviewAria: 'Revisión del spread seleccionado',
    reviewEyebrow: '03 / REVISA ANTES DE EJECUTAR',
    buyLeg: 'COMPRAR {q} {underlying}',
    sellLeg: 'VENDER {q} {underlying}',
    grossCredit: 'Crédito bruto',
    grossDebit: 'Débito bruto',
    entryFee: 'Comisión de entrada estimada',
    extraReserveShort: 'Reserva de costos extra',
    expiryBreakeven: 'Breakeven al vencimiento*',
    probProfit: 'Probabilidad de ganancia del modelo*',
    roundTrip: 'Estimación de ida y vuelta inmediata',
    netPremiumSettled: 'Prima neta liquidada en {underlying}',
    evMarket:
      'El EV valora cada pata a su propia IV mark; la probabilidad es neutral al riesgo a la IV más cercana al breakeven.',
    evForecast: 'La probabilidad y el EV usan tu distribución pronosticada.',
    reserveNote:
      '* Incluye la reserva elegida. La estimación de ida y vuelta usa cotizaciones bid/ask inversas y comisiones estimadas, excluye la reserva y no es una ejecución de salida garantizada.',
    hedgedAssume:
      'Las cifras en USD suponen que la prima en {underlying} se cubre con el futuro del mismo vencimiento',
    unhedgedMove:
      '; sin cobertura, cada movimiento de 10% en {underlying} cambia el P&L en aprox. {value}',
    quoteAge: 'Antigüedad de la cotización {age}s · capacidad de entrada mostrada {capacity} {underlying}.',
    payoffAtPrice: 'Payoff al vencimiento a un precio de liquidación dado',
    myReason: 'Mi razón para este trade',
    reasonPlaceholder: '¿Qué espero y por qué este precio es atractivo?',
    myExit: 'Mi salida / invalidación / momento de revisión',
    exitPlaceholder: 'Escribe el plan antes de abrir el exchange',
    checkedPositions:
      'Revisé las posiciones existentes, el margen libre y el combo completo en la vista previa del exchange.',
    notesComplete: 'Notas de revisión completas. Vuelve a revisar el precio en vivo del exchange antes de decidir.',
    notesIncomplete:
      'Completa los tres campos de revisión antes de decidir. Las notas solo se mantienen mientras esta página esté abierta.',
    thalexNote:
      'La estimación de Thalex supone Tier 1 y un combo atómico: solo se cobra la pata con mayor comisión. Usa el precio límite neto del builder de estrategias y verifica ambas patas. Los combos son immediate-or-cancel; no pueden quedar en el libro. Aún aplican la liquidación diaria en USDt y el margen de portafolio.',
    comboRules: 'Reglas de combos',
    fees: 'Comisiones',
    otherVenueNote:
      'La estimación de comisiones supone comisiones taker separadas en ambas patas. Verifica el soporte de órdenes combinadas y el margen de este exchange antes de ejecutar; las órdenes separadas pueden dejar una pata sin ejecutar.',
  },
);

type MessageKey = keyof typeof messages.en;

const labels: Record<SpreadCandidate['status'], MessageKey> = {
  review: 'statusReview',
  'no-edge': 'statusNoEdge',
  'over-budget': 'statusOverBudget',
  'no-model': 'statusNoModel',
};

function usePlanningInput(key: string, fallback: string) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem('alpha-plan:' + key);
      return saved != null && Number.isFinite(Number(saved)) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('alpha-plan:' + key, value);
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

export default function SpreadDesk({ underlying }: { underlying: string }) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const locale = useLocale();
  const [venue, setVenue] = useState<VenueId | 'all'>('thalex');
  const [expiryChoice, setExpiry] = useState('');
  const [equity, setEquity] = usePlanningInput('equity', '');
  const [risk, setRisk] = usePlanningInput('risk', '1');
  const [quantity, setQuantity] = useState(underlying === 'ETH' ? '0.1' : '0.01');
  const [reserve, setReserve] = usePlanningInput('reserve', '0.25');
  const [kind, setKind] = useState<VerticalKind | 'all'>('all');
  const [withinBudget, setWithinBudget] = useState(true);
  const [visibleRows, setVisibleRows] = useState(12);
  const [forecast, setForecast] = useState(false);
  const [move, setMove] = useState('0');
  const [vol, setVol] = useState('40');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const { data: expiryData, isError: expiryError } = useExpiries(underlying);
  const expiries =
    venue === 'all'
      ? (expiryData?.expiries ?? [])
      : (expiryData?.byVenue.find((v) => v.venue === venue)?.expiries ?? []);
  const expiry = expiries.includes(expiryChoice)
    ? expiryChoice
    : (expiries.find((e) => Date.parse(e + 'T08:00:00Z') - now >= 4 * 86_400_000) ??
      expiries[0] ??
      '');
  const venues = useMemo(() => (venue === 'all' ? [...VENUE_IDS] : [venue]), [venue]);
  const chain = useChainQuery(underlying, expiry, venues, { refetchInterval: 5_000 });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setQuantity(underlying === 'ETH' ? '0.1' : '0.01');
    setSelectedId(null);
  }, [underlying]);
  const valid =
    Number(equity) > 0 &&
    Number(risk) > 0 &&
    Number(risk) <= 100 &&
    Number(quantity) > 0 &&
    reserve !== '' &&
    Number(reserve) >= 0 &&
    (!forecast || (move !== '' && Number(move) > -100 && Number(vol) > 0));
  const scans = useMemo(
    () =>
      chain.data && !chain.isError && valid
        ? scanSpreads({
            chain: chain.data,
            venues,
            quantity: Number(quantity),
            equity: Number(equity),
            riskPct: Number(risk),
            costReserve: Number(reserve),
            nowMs: Date.now(),
            ...(forecast
              ? { forecast: { movePct: Number(move), volatility: Number(vol) / 100 } }
              : {}),
          })
        : [],
    [
      chain.data,
      chain.isError,
      venues,
      quantity,
      equity,
      risk,
      reserve,
      now,
      forecast,
      move,
      vol,
      valid,
    ],
  );
  const filtered = scans.map((scan) => ({
    ...scan,
    candidates: scan.candidates.filter(
      (c) => (kind === 'all' || c.kind === kind) && (!withinBudget || c.status !== 'over-budget'),
    ),
  }));
  const candidates = filtered.flatMap((s) => s.candidates);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const positive = candidates.filter((c) => c.status === 'review').length;
  const spot = chain.data?.stats.indexPriceUsd ?? null;
  return (
    <div className={styles.desk}>
      <header className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>{t('defineEyebrow')}</span>
          <h1>{t('defineTitle')}</h1>
          <p>{t('defineLead')}</p>
        </div>
        <div className={styles.budget}>
          <span>{t('lossBudget')}</span>
          <strong>
            {valid ? money((Number(equity) * Number(risk)) / 100) : t('setEquityBelow')}
          </strong>
          <small>{t('manualBalance')}</small>
        </div>
      </header>
      <section className={styles.controls} aria-label={t('settingsAria')}>
        <label>
          {t('executionVenue')}
          <select
            value={venue}
            onChange={(e) => {
              setVenue(e.target.value as VenueId | 'all');
              setSelectedId(null);
            }}
          >
            <option value="all">{t('compareEach')}</option>
            {VENUE_IDS.map((v) => (
              <option key={v} value={v}>
                {VENUES[v]?.label ?? v}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('expiry')}
          <select
            value={expiry}
            onChange={(e) => {
              setExpiry(e.target.value);
              setSelectedId(null);
            }}
          >
            {expiries.length === 0 && <option value="">{t('noListedExpiry')}</option>}
            {expiries.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('accountEquity')}
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={t('enterEquity')}
            value={equity}
            onChange={(e) => setEquity(e.target.value)}
          />
        </label>
        <label>
          {t('riskBudget')}
          <input
            type="number"
            min="0.01"
            max="100"
            step="0.25"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
          />
        </label>
        <label>
          {t('sizePerLeg', { underlying })}
          <input
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label>
          {t('extraReserve')}
          <input
            type="number"
            min="0"
            step="0.05"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
          />
        </label>
      </section>
      <p className={styles.note}>
        {t('rememberedNote')}
      </p>
      <details className={styles.assumptions}>
        <summary>
          {t('modelAssumptions', { mode: t(forecast ? 'yourForecast' : 'marketBenchmark') })}
        </summary>
        <p>{t('benchmarkNote')}</p>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={forecast}
            onChange={(e) => setForecast(e.target.checked)}
          />{' '}
          {t('evaluateForecast')}
        </label>
        {forecast && (
          <div className={styles.forecast}>
            <label>
              {t('expectedMove')}
              <input
                type="number"
                step="0.5"
                min="-99"
                value={move}
                onChange={(e) => setMove(e.target.value)}
              />
            </label>
            <label>
              {t('forecastVol')}
              <input
                type="number"
                min="0.1"
                step="1"
                value={vol}
                onChange={(e) => setVol(e.target.value)}
              />
            </label>
            <p>{t('scenarioNote')}</p>
          </div>
        )}
      </details>
      <section className={styles.results} aria-label={t('resultsAria')}>
        <div className={styles.resultHeader}>
          <div>
            <span className={styles.eyebrow}>{t('compareEyebrow')}</span>
            <h2>
              {!valid
                ? t('setBudgetToScan')
                : chain.isError || expiryError
                  ? t('marketUnavailable')
                  : chain.isLoading
                    ? t('loadingQuotes')
                    : !expiry
                      ? t('noExpiryOnVenue')
                      : scans.every((scan) => scan.candidates.length === 0)
                        ? t('noEligibleAtSize')
                        : positive > 0
                          ? t('candidatesToInvestigate', { n: positive })
                          : t('noPositiveEdge')}
            </h2>
            <p>
              {expiry || t('chooseExpiry')} · {t('allPairsRefresh')}
            </p>
          </div>
          <div className={styles.filters}>
            <label>
              {t('structure')}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as VerticalKind | 'all')}
              >
                <option value="all">{t('allFour')}</option>
                {Object.entries(VERTICAL_LABEL_KEYS).map(([id, key]) => (
                  <option key={id} value={id}>
                    {ta(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={withinBudget}
                onChange={(e) => setWithinBudget(e.target.checked)}
              />{' '}
              {t('withinBudgetOnly')}
            </label>
          </div>
        </div>
        {(chain.isError || expiryError) && (
          <p role="alert">{t('marketAlert')}</p>
        )}
        {chain.isLoading && <p role="status">{t('loadingQuotesEllipsis')}</p>}
        {!valid && <p>{t('invalidInputs')}</p>}
        {filtered.map((scan) => (
          <div key={scan.venue} className={styles.venueGroup}>
            <div className={styles.venueHeading}>
              <h3>{VENUES[scan.venue]?.label ?? scan.venue}</h3>
              <span>{t('matchesRanked', { n: scan.candidates.length })}</span>
            </div>
            {scan.candidates.length > 0 ? (
              <div className={styles.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      <th>{t('colStructure')}</th>
                      <th>{t('colStrikes')}</th>
                      <th>{t('colMaxGain')}</th>
                      <th>{t('colMaxLoss')}</th>
                      <th>{t('colEquityRisk')}</th>
                      <th>{t(forecast ? 'colScenarioEv' : 'colModelDiff')}</th>
                      <th>{t('colAssessment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.candidates.slice(0, visibleRows).map((c) => (
                      <tr key={c.id} data-selected={selectedId === c.id}>
                        <td>
                          <button
                            type="button"
                            aria-pressed={selectedId === c.id}
                            onClick={() => setSelectedId(c.id)}
                          >
                            {ta(VERTICAL_LABEL_KEYS[c.kind])} <span>↗</span>
                          </button>
                          <small>
                            {t(c.direction)} · {c.quantity} {underlying}
                          </small>
                        </td>
                        <td>
                          {price(c.buyStrike)} / {price(c.sellStrike)}
                        </td>
                        <td className={styles.profit}>{money(c.maxProfit)}</td>
                        <td className={styles.loss}>{money(c.maxLoss)}</td>
                        <td>{c.riskPct.toFixed(2)}%</td>
                        <td>{money(c.modelEdge)}</td>
                        <td>
                          <span className={styles.badge} data-status={c.status}>
                            {t(labels[c.status])}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {scan.rejected['Enter valid sizing and an unexpired expiry']
                  ? t('expirySettled')
                  : scan.candidates.length === 0 &&
                      scan.rejected &&
                      scans.find((s) => s.venue === scan.venue)?.candidates.length
                    ? t('noFilterMatch')
                    : t('noEligiblePairs')}
              </p>
            )}
            {scan.candidates.length > visibleRows && (
              <button
                className={styles.more}
                type="button"
                onClick={() => setVisibleRows((count) => count + 12)}
              >
                {t('showMore', { venue: VENUES[scan.venue]?.label ?? scan.venue })}
              </button>
            )}
            <details className={styles.diagnostics}>
              <summary>
                {t('quoteChecks')}
                {scan.candidates.length > visibleRows ? t('showingTop', { n: visibleRows }) : ''}
              </summary>
              {Object.entries(scan.rejected).map(([reason, count]) => (
                <p key={reason}>
                  {t('pairsCount', {
                    reason: locale === 'en' ? reason : humanizeRejection(reason, ta),
                    n: count,
                  })}
                </p>
              ))}
              <p>{t('checksNote')}</p>
            </details>
          </div>
        ))}
        <p className={styles.note}>{t('footnote')}</p>
      </section>
      {selectedId && !selected && (
        <p role="status" className={styles.note}>
          {t('staleSelection')}
        </p>
      )}
      {selected && <SpreadReview candidate={selected} spot={spot} underlying={underlying} />}
      {venue !== 'all' && <AlphaPortfolioContext venue={venue} underlying={underlying} />}
      <details className={styles.assumptions}>
        <summary>{t('quickRef')}</summary>
        <div className={styles.education}>
          <p>
            <strong>{t('putCreditTitle')}</strong>
            <br />
            {t('putCreditText')}
          </p>
          <p>
            <strong>{t('callDebitTitle')}</strong>
            <br />
            {t('callDebitText')}
          </p>
          <p>
            <strong>{t('callCreditTitle')}</strong>
            <br />
            {t('callCreditText')}
          </p>
          <p>
            <strong>{t('putDebitTitle')}</strong>
            <br />
            {t('putDebitText')}
          </p>
        </div>
        <p>{t('winProbNote')}</p>
      </details>
    </div>
  );
}

function SpreadReview({
  candidate: c,
  spot,
  underlying,
}: {
  candidate: SpreadCandidate;
  spot: number | null;
  underlying: string;
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const panel = useRef<HTMLElement>(null);
  const [thesis, setThesis] = useState('');
  const [exit, setExit] = useState('');
  const [checks, setChecks] = useState(false);
  useEffect(() => {
    setChecks(false);
    setThesis('');
    setExit('');
  }, [c.id]);
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [c.id]);
  return (
    <section ref={panel} className={styles.review} aria-label={t('reviewAria')}>
      <span className={styles.eyebrow}>{t('reviewEyebrow')}</span>
      <h2>
        {ta(VERTICAL_LABEL_KEYS[c.kind])} · {VENUES[c.venue]?.label ?? c.venue} · {c.expiry}
      </h2>
      <div className={styles.legs}>
        <p>
          <span>{t('buyLeg', { q: c.quantity, underlying })}</span>
          <strong>{c.buySymbol}</strong>
        </p>
        <p>
          <span>{t('sellLeg', { q: c.quantity, underlying })}</span>
          <strong>{c.sellSymbol}</strong>
        </p>
      </div>
      <div className={styles.reviewStats}>
        <div>
          <span>{t(c.grossPremium > 0 ? 'grossCredit' : 'grossDebit')}</span>
          <strong>{money(Math.abs(c.grossPremium))}</strong>
        </div>
        <div>
          <span>{t('entryFee')}</span>
          <strong>{money(c.entryFee)}</strong>
        </div>
        <div>
          <span>{t('extraReserveShort')}</span>
          <strong>{money(c.costReserve)}</strong>
        </div>
        <div>
          <span>{t('expiryBreakeven')}</span>
          <strong>{money(c.breakeven)}</strong>
        </div>
        <div>
          <span>{t('probProfit')}</span>
          <strong>{c.probability == null ? '—' : (c.probability * 100).toFixed(1) + '%'}</strong>
        </div>
        <div>
          <span>{t('roundTrip')}</span>
          <strong>{money(c.roundTrip)}</strong>
        </div>
        {c.basePremium != null && (
          <div>
            <span>{t('netPremiumSettled', { underlying })}</span>
            <strong>
              {c.basePremium > 0 ? '+' : ''}
              {c.basePremium.toFixed(4)} {underlying}
            </strong>
          </div>
        )}
      </div>
      <p className={styles.note}>
        {c.model === 'market'
          ? t('evMarket')
          : t('evForecast')}{' '}
        {t('reserveNote')}{' '}
        {c.basePremium != null &&
          `${t('hedgedAssume', { underlying })}${
            spot != null && spot > 0
              ? t('unhedgedMove', {
                  underlying,
                  value: money(Math.abs(c.basePremium) * spot * 0.1),
                })
              : ''
          }. `}
        {t('quoteAge', { age: (c.ageMs / 1000).toFixed(1), capacity: c.capacity, underlying })}
      </p>
      {spot != null && spot > 0 && (
        <div className={styles.scenarios}>
          <span>{t('payoffAtPrice')}</span>
          <div>
            {[-10, -5, 0, 5, 10].map((pct) => (
              <div key={pct}>
                <small>
                  {pct > 0 ? '+' : ''}
                  {pct}% · {price(spot * (1 + pct / 100))}
                </small>
                <strong>{money(expiryPnl(c, spot * (1 + pct / 100)))}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.forecast}>
        <label>
          {t('myReason')}
          <input
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder={t('reasonPlaceholder')}
          />
        </label>
        <label>
          {t('myExit')}
          <input
            value={exit}
            onChange={(e) => setExit(e.target.value)}
            placeholder={t('exitPlaceholder')}
          />
        </label>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={checks} onChange={(e) => setChecks(e.target.checked)} />{' '}
        {t('checkedPositions')}
      </label>
      <p className={styles.note}>
        {thesis && exit && checks
          ? t('notesComplete')
          : t('notesIncomplete')}
      </p>
      {c.venue === 'thalex' ? (
        <p className={styles.note}>
          {t('thalexNote')}{' '}
          <a
            href="https://thalex.com/trading-information/combination-orders"
            target="_blank"
            rel="noreferrer"
          >
            {t('comboRules')}
          </a>{' '}
          ·{' '}
          <a href="https://thalex.com/trading-information/fees" target="_blank" rel="noreferrer">
            {t('fees')}
          </a>
        </p>
      ) : (
        <p className={styles.note}>
          {t('otherVenueNote')}
        </p>
      )}
    </section>
  );
}
