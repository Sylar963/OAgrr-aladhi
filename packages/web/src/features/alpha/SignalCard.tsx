import InfoTip from '@components/ui/InfoTip';
import { fmtStrikeShort, fmtUsd, fmtUsdPrice } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
import { memo } from 'react';
import { alphaMessages } from './i18n';
import styles from './SignalCard.module.css';
import type { RegimeResponse } from './useRegimeQuery';
import { expiryPnl, type VerticalEconomics } from './vertical-pricing';

export interface ExecutionRoute {
  sellVenue: VenueId;
  buyVenue: VenueId;
}

interface Props {
  candidate: VerticalEconomics | null;
  route: ExecutionRoute | null;
  underlying: string;
  spot: number | null;
  emptyReason: string;
  emptyState: 'equity' | 'market' | 'quote';
  riskBudgetPct: number;
  /** ATM IV × √T: one standard deviation of log return to expiry. */
  impliedMove?: number | null;
  regime?: RegimeResponse | null;
  onOpenBuilder?: () => void;
}

const messages = defineMessages(
  {
    reviewLabel: 'CHECK SETUP',
    reviewMessage: 'Model-positive · verify assumptions',
    noEdgeLabel: 'WAIT',
    noEdgeMessage: 'Price does not cover modeled risk',
    overBudgetLabel: 'TOO LARGE',
    overBudgetMessage: 'Loss exceeds your risk limit',
    noModelLabel: 'PRICE ONLY',
    noModelMessage: 'Payoff known · model unavailable',
    eyebrow: 'Spread decision',
    title: 'Price · payoff · account risk',
    tipGreen:
      'Green means the quote passes the current model and your loss limit. It still needs a thesis and an execution check.',
    tipProbability:
      'Probability is risk-neutral and model EV uses a simplified flat-volatility distribution. Neither is a forecast or a historical win rate.',
    crossRoute: '{sell} sell → {buy} buy',
    nonAtomic: 'non-atomic',
    bullish: 'bullish',
    bearish: 'bearish',
    maxLoss: 'max loss',
    riskBudgetUsed: 'Risk budget used',
    risk: 'Risk {value}',
    lossRewardBalance: 'Loss / reward balance',
    xRisk: '{n}× risk',
    oneReward: '1× reward',
    modelProbability: 'Model probability',
    notForecast: 'Not a forecast',
    profitZone: 'profit zone',
    lossZone: 'loss zone',
    cashPaid: 'Cash paid',
    breakeven: 'Breakeven',
    modelEv: 'Model EV',
    accountAtRisk: 'Account at risk',
    roundTrip: 'Round trip est.',
    beforeTrading: 'Before trading · 3 checks',
    thesis: 'Thesis',
    thesisText: 'What must {underlying} do by expiry? What proves you wrong?',
    account: 'Account',
    accountText: 'Check free margin and overlapping Portfolio risk.',
    exit: 'Exit',
    exitText: 'Set price, time limit and invalidation before entry.',
    feesFootnote:
      'Fees {fees} + reserve {reserve} included. Expiry bounds require both legs to fill and remain paired. Confirm venue margin and final order price.',
    crossFootnote:
      ' Cross-venue: legs fill independently, so one can fill without the other, and {venue} margins the short leg as a naked short — collateral can far exceed max loss.',
    stepLivePair: 'Live pair',
    pairNotExecutable: 'Selected pair is not executable',
    payoffAria: 'Expiry payoff from {from} to {to}',
    spot: 'spot',
    riskBudgetAria: 'Risk budget used {value}%',
    unknown: 'unknown',
    moveAtExpiry: '{underlying} move at expiry',
    breakevenNeeds: 'Breakeven {price} needs {move}',
    sigmaDef: '1σ = ATM IV × √T = {pct}% to expiry. ',
    noAtmIv: 'ATM IV unavailable, so moves are fixed ±5/10%. ',
    expiryOnly: 'Expiry payoff only. Before expiry, time and IV also move the price.',
  },
  {
    reviewLabel: 'REVISAR SETUP',
    reviewMessage: 'Modelo positivo · verifica los supuestos',
    noEdgeLabel: 'ESPERAR',
    noEdgeMessage: 'El precio no cubre el riesgo modelado',
    overBudgetLabel: 'DEMASIADO GRANDE',
    overBudgetMessage: 'La pérdida supera tu límite de riesgo',
    noModelLabel: 'SOLO PRECIO',
    noModelMessage: 'Payoff conocido · modelo no disponible',
    eyebrow: 'Decisión de spread',
    title: 'Precio · payoff · riesgo de la cuenta',
    tipGreen:
      'Verde significa que la cotización pasa el modelo actual y tu límite de pérdida. Aún necesita una tesis y una revisión de ejecución.',
    tipProbability:
      'La probabilidad es neutral al riesgo y el EV del modelo usa una distribución simplificada de volatilidad plana. Ninguno es un pronóstico ni una tasa de acierto histórica.',
    crossRoute: '{sell} venta → {buy} compra',
    nonAtomic: 'no atómico',
    bullish: 'alcista',
    bearish: 'bajista',
    maxLoss: 'pérdida máx.',
    riskBudgetUsed: 'Presupuesto de riesgo usado',
    risk: 'Riesgo {value}',
    lossRewardBalance: 'Balance pérdida / ganancia',
    xRisk: '{n}× riesgo',
    oneReward: '1× ganancia',
    modelProbability: 'Probabilidad del modelo',
    notForecast: 'No es un pronóstico',
    profitZone: 'zona de ganancia',
    lossZone: 'zona de pérdida',
    cashPaid: 'Efectivo pagado',
    breakeven: 'Breakeven',
    modelEv: 'EV del modelo',
    accountAtRisk: 'Cuenta en riesgo',
    roundTrip: 'Ida y vuelta est.',
    beforeTrading: 'Antes de operar · 3 revisiones',
    thesis: 'Tesis',
    thesisText: '¿Qué debe hacer {underlying} antes del vencimiento? ¿Qué demuestra que te equivocas?',
    account: 'Cuenta',
    accountText: 'Revisa el margen libre y el riesgo superpuesto en Portafolio.',
    exit: 'Salida',
    exitText: 'Define precio, límite de tiempo e invalidación antes de entrar.',
    feesFootnote:
      'Incluye comisiones {fees} + reserva {reserve}. Los límites al vencimiento requieren que ambas patas se ejecuten y sigan emparejadas. Confirma el margen del exchange y el precio final de la orden.',
    crossFootnote:
      ' Entre exchanges: las patas se ejecutan por separado, así que una puede ejecutarse sin la otra, y {venue} margina la pata short como short descubierto; el colateral puede superar con creces la pérdida máx.',
    stepLivePair: 'Par en vivo',
    pairNotExecutable: 'El par seleccionado no es ejecutable',
    payoffAria: 'Payoff al vencimiento de {from} a {to}',
    spot: 'spot',
    riskBudgetAria: 'Presupuesto de riesgo usado {value}%',
    unknown: 'desconocido',
    moveAtExpiry: 'Movimiento de {underlying} al vencimiento',
    breakevenNeeds: 'Breakeven {price} requiere {move}',
    sigmaDef: '1σ = ATM IV × √T = {pct}% al vencimiento. ',
    noAtmIv: 'ATM IV no disponible, así que los movimientos son fijos ±5/10%. ',
    expiryOnly: 'Solo payoff al vencimiento. Antes del vencimiento, el tiempo y la IV también mueven el precio.',
  },
);

const STATUS = {
  review: { label: 'reviewLabel', tone: 'review', message: 'reviewMessage' },
  'no-edge': { label: 'noEdgeLabel', tone: 'avoid', message: 'noEdgeMessage' },
  'over-budget': { label: 'overBudgetLabel', tone: 'danger', message: 'overBudgetMessage' },
  'no-model': { label: 'noModelLabel', tone: 'neutral', message: 'noModelMessage' },
} as const;

function SignalCard({
  candidate,
  route,
  underlying,
  spot,
  emptyReason,
  emptyState,
  riskBudgetPct,
  impliedMove = null,
  regime,
  onOpenBuilder,
}: Props) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const dominant = regime?.dominant ?? null;
  const direction = regime?.direction ?? null;

  return (
    <section className={styles.card} data-state={candidate?.status ?? 'empty'}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('eyebrow')}</span>
          <h2 className={styles.title}>{t('title')}</h2>
        </div>
        <InfoTip label={ta('howToRead')} title={ta('filterNotInstruction')} align="end">
          <p>{t('tipGreen')}</p>
          <p>{t('tipProbability')}</p>
        </InfoTip>
      </header>

      {!candidate || !route ? (
        <EmptyDecisionState state={emptyState} reason={emptyReason} />
      ) : (
        <CandidateDashboard
          candidate={candidate}
          route={route}
          underlying={underlying}
          spot={spot}
          riskBudgetPct={riskBudgetPct}
          impliedMove={impliedMove}
          dominant={dominant}
          direction={direction}
          onOpenBuilder={onOpenBuilder}
        />
      )}
    </section>
  );
}

function CandidateDashboard({
  candidate,
  route,
  underlying,
  spot,
  riskBudgetPct,
  impliedMove,
  dominant,
  direction,
  onOpenBuilder,
}: {
  candidate: VerticalEconomics;
  route: ExecutionRoute;
  underlying: string;
  spot: number | null;
  riskBudgetPct: number;
  impliedMove: number | null;
  dominant: RegimeResponse['dominant'] | null;
  direction: RegimeResponse['direction'] | null;
  onOpenBuilder: (() => void) | undefined;
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const status = STATUS[candidate.status];
  const debit = candidate.kind.endsWith('debit');
  const cross = route.buyVenue !== route.sellVenue;
  const sellLabel = VENUES[route.sellVenue]?.label ?? route.sellVenue;
  const buyLabel = VENUES[route.buyVenue]?.label ?? route.buyVenue;
  const netCash = candidate.grossPremium - candidate.entryFee - candidate.costReserve;
  const probability = candidate.probability == null ? null : candidate.probability * 100;
  const budgetUsd =
    candidate.riskPct > 0 && riskBudgetPct > 0
      ? (candidate.maxLoss * riskBudgetPct) / candidate.riskPct
      : null;
  const budgetUse = budgetUsd == null ? null : (candidate.maxLoss / budgetUsd) * 100;
  const rewardShare = (candidate.maxProfit / (candidate.maxProfit + candidate.maxLoss)) * 100;

  return (
    <>
      <div className={styles.decisionRow}>
        <div className={styles.statusLockup} data-tone={status.tone}>
          <span className={styles.statusBeacon} aria-hidden="true" />
          <div>
            <strong>{t(status.label)}</strong>
            <span>{t(status.message)}</span>
          </div>
        </div>
        <div className={styles.contractLine}>
          <strong>{cross ? t('crossRoute', { sell: sellLabel, buy: buyLabel }) : sellLabel}</strong>
          {cross && <span>{t('nonAtomic')}</span>}
          <span>
            {candidate.quantity} {underlying}
          </span>
          <span className={styles.direction} data-direction={candidate.direction}>
            {t(candidate.direction)}
          </span>
          {dominant && <span>{dominant}</span>}
          {direction && <span>{direction}</span>}
        </div>
      </div>

      <div className={styles.visualGrid}>
        <div className={`${styles.visualPanel} ${styles.payoffPanel}`}>
          <div className={styles.panelHeader}>
            <span>{ta('expiryPayoff')}</span>
            <strong>{candidate.kind.replace('-', ' ')}</strong>
          </div>
          <PayoffChart candidate={candidate} spot={spot} />
          <div className={styles.payoffLegend}>
            <span data-kind="loss">
              −{fmtUsd(candidate.maxLoss)} {t('maxLoss')}
            </span>
            <span data-kind="profit">
              +{fmtUsd(candidate.maxProfit)} {ta('maxProfit')}
            </span>
          </div>
        </div>

        <div className={styles.visualPanel}>
          <div className={styles.panelHeader}>
            <span>{t('riskBudgetUsed')}</span>
            <strong data-kind={budgetUse != null && budgetUse > 100 ? 'loss' : 'profit'}>
              {budgetUse == null ? '—' : `${budgetUse.toFixed(0)}%`}
            </strong>
          </div>
          <RiskMeter value={budgetUse} />
          <div className={styles.meterLabels}>
            <span>{t('risk', { value: fmtUsd(candidate.maxLoss) })}</span>
            <span>{ta('limit', { value: fmtUsd(budgetUsd) })}</span>
          </div>
          <div className={styles.balanceBlock}>
            <span className={styles.miniLabel}>{t('lossRewardBalance')}</span>
            <div className={styles.balanceBar}>
              <span className={styles.lossBalance} style={{ width: `${100 - rewardShare}%` }} />
              <span className={styles.profitBalance} style={{ width: `${rewardShare}%` }} />
            </div>
            <div className={styles.meterLabels}>
              <span>{t('xRisk', { n: (candidate.maxLoss / candidate.maxProfit).toFixed(2) })}</span>
              <span>{t('oneReward')}</span>
            </div>
          </div>
        </div>

        <div className={`${styles.visualPanel} ${styles.probabilityPanel}`}>
          <div className={styles.panelHeader}>
            <span>{t('modelProbability')}</span>
            <strong>{t('notForecast')}</strong>
          </div>
          <ProbabilityDial value={probability} />
          <div className={styles.probabilityLegend}>
            <span data-kind="profit">{t('profitZone')}</span>
            <span data-kind="loss">{t('lossZone')}</span>
          </div>
        </div>
      </div>

      <div className={styles.metricsStrip}>
        <Metric
          label={debit ? t('cashPaid') : ta('creditKept')}
          value={fmtUsd(Math.abs(netCash))}
        />
        <Metric label={t('breakeven')} value={fmtUsdPrice(candidate.breakeven)} />
        <Metric
          label={t('modelEv')}
          value={fmtUsd(candidate.modelEdge)}
          tone={candidate.modelEdge != null && candidate.modelEdge > 0 ? 'profit' : 'loss'}
        />
        <Metric
          label={t('accountAtRisk')}
          value={`${candidate.riskPct.toFixed(2)}%`}
          tone="loss"
        />
        <Metric label={ta('entryFees')} value={fmtUsd(candidate.entryFee)} />
        <Metric label={t('roundTrip')} value={fmtUsd(candidate.roundTrip)} />
      </div>

      {spot != null && spot > 0 && (
        <ScenarioMeter
          candidate={candidate}
          spot={spot}
          underlying={underlying}
          impliedMove={impliedMove}
        />
      )}

      <details className={styles.review}>
        <summary>{t('beforeTrading')}</summary>
        <div className={styles.reviewGrid}>
          <ReviewStep number="01" title={t('thesis')} text={t('thesisText', { underlying })} />
          <ReviewStep number="02" title={t('account')} text={t('accountText')} />
          <ReviewStep number="03" title={t('exit')} text={t('exitText')} />
        </div>
        <p className={styles.footnote}>
          {t('feesFootnote', {
            fees: fmtUsd(candidate.entryFee),
            reserve: fmtUsd(candidate.costReserve),
          })}
          {cross && t('crossFootnote', { venue: sellLabel })}
        </p>
      </details>

      {onOpenBuilder && (
        <button type="button" className={styles.builderButton} onClick={onOpenBuilder}>
          <span>{ta('openInBuilder')}</span>
          <span aria-hidden="true">↗</span>
        </button>
      )}
    </>
  );
}

function EmptyDecisionState({ state, reason }: { state: Props['emptyState']; reason: string }) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const steps = [
    { label: ta('stepAccountSize'), state: state === 'equity' ? 'active' : 'done' },
    {
      label: t('stepLivePair'),
      state:
        state === 'equity'
          ? 'waiting'
          : state === 'quote' || state === 'market'
            ? 'blocked'
            : 'done',
    },
    { label: ta('stepRiskMap'), state: 'waiting' },
  ] as const;
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptySignal} aria-hidden="true">
        <span>∿</span>
      </div>
      <div className={styles.emptyCopy}>
        <strong>
          {state === 'equity'
            ? ta('setAccountSize')
            : state === 'market'
              ? ta('marketUnavailable')
              : t('pairNotExecutable')}
        </strong>
        <p>{reason}</p>
      </div>
      <div className={styles.pipeline}>
        {steps.map((step, index) => (
          <div className={styles.pipelineStep} data-state={step.state} key={step.label}>
            <span className={styles.pipelineNode}>
              {step.state === 'done' ? '✓' : step.state === 'blocked' ? '!' : index + 1}
            </span>
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayoffChart({ candidate, spot }: { candidate: VerticalEconomics; spot: number | null }) {
  const lowStrike = Math.min(candidate.buyStrike, candidate.sellStrike);
  const highStrike = Math.max(candidate.buyStrike, candidate.sellStrike);
  const width = highStrike - lowStrike;
  const pad = width * 0.8;
  const from = Math.max(
    0,
    Math.min(lowStrike - pad, spot != null && spot > 0 ? spot - pad : Infinity),
  );
  const to = Math.max(highStrike + pad, spot != null && spot > 0 ? spot + pad : 0);
  const chartWidth = 520;
  const chartHeight = 132;
  const padding = 10;
  const scaleX = (price: number) =>
    padding + ((price - from) / (to - from)) * (chartWidth - padding * 2);
  const scaleY = (pnl: number) =>
    padding +
    ((candidate.maxProfit - pnl) / (candidate.maxProfit + candidate.maxLoss)) *
      (chartHeight - padding * 2);
  const points = Array.from({ length: 41 }, (_, index) => {
    const price = from + ((to - from) * index) / 40;
    return `${scaleX(price)},${scaleY(expiryPnl(candidate, price))}`;
  }).join(' ');
  const zeroY = scaleY(0);
  const spotX = spot != null && spot >= from && spot <= to ? scaleX(spot) : null;
  const t = useT(messages);

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.payoffChart}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={t('payoffAria', { from: fmtUsdPrice(from), to: fmtUsdPrice(to) })}
      >
        <rect x="0" y="0" width={chartWidth} height={zeroY} className={styles.profitZone} />
        <rect
          x="0"
          y={zeroY}
          width={chartWidth}
          height={chartHeight - zeroY}
          className={styles.lossZone}
        />
        <line x1="0" x2={chartWidth} y1={zeroY} y2={zeroY} className={styles.zeroLine} />
        {[candidate.buyStrike, candidate.sellStrike].map((strike) => (
          <line
            key={strike}
            x1={scaleX(strike)}
            x2={scaleX(strike)}
            y1="0"
            y2={chartHeight}
            className={styles.strikeLine}
          />
        ))}
        {spotX != null && (
          <line x1={spotX} x2={spotX} y1="0" y2={chartHeight} className={styles.spotLine} />
        )}
        <polyline points={points} className={styles.payoffPathGlow} />
        <polyline points={points} className={styles.payoffPath} />
      </svg>
      <span
        className={styles.axisLabel}
        style={{ left: `${(scaleX(lowStrike) / chartWidth) * 100}%` }}
      >
        {fmtStrikeShort(lowStrike)}
      </span>
      <span
        className={styles.axisLabel}
        style={{ left: `${(scaleX(highStrike) / chartWidth) * 100}%` }}
      >
        {fmtStrikeShort(highStrike)}
      </span>
      {spotX != null && (
        <span className={styles.spotLabel} style={{ left: `${(spotX / chartWidth) * 100}%` }}>
          {t('spot')}
        </span>
      )}
    </div>
  );
}

function RiskMeter({ value }: { value: number | null }) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const fill = value == null ? 0 : Math.min(value, 100);
  return (
    <div
      className={styles.riskMeter}
      aria-label={t('riskBudgetAria', { value: value?.toFixed(0) ?? t('unknown') })}
    >
      <div className={styles.riskScale}>
        <span>0</span>
        <span>50</span>
        <span>100%</span>
      </div>
      <div className={styles.riskTrack}>
        <span
          className={styles.riskFill}
          data-over={value != null && value > 100}
          style={{ width: `${fill}%` }}
        />
        <i className={styles.riskMarker} />
      </div>
      {value != null && value > 100 && (
        <span className={styles.overflowLabel}>
          {ta('overLimit', { pct: (value - 100).toFixed(0) })}
        </span>
      )}
    </div>
  );
}

function ProbabilityDial({ value }: { value: number | null }) {
  const t = useT(messages);
  const normalized = value == null ? 0 : Math.max(0, Math.min(value, 100));
  const circumference = 226.2;
  return (
    <div className={styles.dialWrap}>
      <svg viewBox="0 0 96 96" className={styles.dial} aria-hidden="true">
        <circle cx="48" cy="48" r="36" className={styles.dialTrack} />
        <circle
          cx="48"
          cy="48"
          r="36"
          className={styles.dialValue}
          strokeDasharray={`${(normalized / 100) * circumference} ${circumference}`}
        />
      </svg>
      <div className={styles.dialText}>
        <strong>{value == null ? '—' : `${value.toFixed(0)}%`}</strong>
        <span>{t('profitZone')}</span>
      </div>
    </div>
  );
}

const FALLBACK_MOVES = [-10, -5, 0, 5, 10].map((pct) => ({ label: null, ret: pct / 100 }));
const SIGMA_STEPS = [-2, -1, 0, 1, 2];

function ScenarioMeter({
  candidate,
  spot,
  underlying,
  impliedMove,
}: {
  candidate: VerticalEconomics;
  spot: number;
  underlying: string;
  impliedMove: number | null;
}) {
  const t = useT(messages);
  const sigma = impliedMove != null && impliedMove > 0 ? impliedMove : null;
  // Lognormal steps keep −2σ above zero for high-IV names, where a linear −2σ can pass −100%.
  const moves =
    sigma == null
      ? FALLBACK_MOVES
      : SIGMA_STEPS.map((step) => ({
          label: step === 0 ? t('spot') : `${step > 0 ? '+' : '−'}${Math.abs(step)}σ`,
          ret: Math.exp(step * sigma) - 1,
        }));
  const breakevenMove = candidate.breakeven / spot - 1;
  const breakevenSigma = sigma == null ? null : Math.log(candidate.breakeven / spot) / sigma;
  return (
    <details className={styles.scenarios}>
      <summary>{t('moveAtExpiry', { underlying })}</summary>
      <div className={styles.scenarioGrid}>
        {moves.map(({ label, ret }) => {
          const price = spot * (1 + ret);
          const pnl = expiryPnl(candidate, price);
          const magnitude =
            pnl >= 0 ? pnl / candidate.maxProfit : Math.abs(pnl) / candidate.maxLoss;
          return (
            <div className={styles.scenario} key={label ?? ret}>
              <span>
                {label && <b>{label} </b>}
                {fmtPct(ret)} · {fmtUsdPrice(price)}
              </span>
              <div className={styles.scenarioTrack}>
                <i
                  data-kind={pnl >= 0 ? 'profit' : 'loss'}
                  style={{ height: `${Math.max(4, magnitude * 100)}%` }}
                />
              </div>
              <strong data-kind={pnl >= 0 ? 'profit' : 'loss'}>{fmtUsd(pnl)}</strong>
            </div>
          );
        })}
      </div>
      <p className={styles.footnote}>
        {t('breakevenNeeds', {
          price: fmtUsdPrice(candidate.breakeven),
          move: fmtPct(breakevenMove),
        })}
        {breakevenSigma != null && ` (${Math.abs(breakevenSigma).toFixed(1)}σ)`}.{' '}
        {sigma != null ? t('sigmaDef', { pct: (sigma * 100).toFixed(1) }) : t('noAtmIv')}
        {t('expiryOnly')}
      </p>
    </details>
  );
}

function fmtPct(ret: number): string {
  const pct = ret * 100;
  if (Math.abs(pct) < 0.05) return '0%';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'profit' | 'loss';
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong data-kind={tone}>{value}</strong>
    </div>
  );
}

function ReviewStep({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className={styles.reviewStep}>
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}


export default memo(SignalCard);
