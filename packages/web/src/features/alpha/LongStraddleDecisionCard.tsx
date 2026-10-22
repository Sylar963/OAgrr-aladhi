import InfoTip from '@components/ui/InfoTip';
import type {
  AlphaLongStraddleCandidate,
  AlphaLongStraddleFlag,
  AlphaLongStraddleVerdict,
} from '@oggregator/protocol';
import { fmtIv, fmtPct, fmtStrike, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';

import { alphaMessages, type AlphaT } from './i18n';
import signal from './SignalCard.module.css';
import styles from './StraddleScannerPanel.module.css';

export const longStraddleMessages = defineMessages(
  {
    buyCandidateLabel: 'CHECK SETUP',
    buyCandidateMessage: 'Forecast vol is above the price · verify thesis',
    watchLabel: 'WATCH',
    watchMessage: 'Cheap on price · regime or edge caveat',
    expensiveLabel: "EXPENSIVE · DON'T BUY",
    expensiveMessage: 'The asks cost more than the forecast vol',
    noForecastLabel: 'NO FORECAST',
    noForecastMessage: 'Cannot judge the price',
    iv_above_forecast:
      'Buy IV (asks plus fees) is not below the matched-horizon forecast. A hedged long straddle earns realized minus implied, so the forecast has to exceed the price (Sinclair p. 87).',
    edge_within_fair_band:
      'The forecast is above the buy IV by less than 2 vol points. That is inside forecast error, so it reads as fair, not cheap.',
    above_cone_median:
      'Buy IV is at or above the median realized vol for this horizon. That is not cheap against the vol cone (Sinclair pp. 39–41).',
    above_cone_p25:
      'Buy IV is above the 25th percentile of the vol cone. It is below the median, but not historically low for this horizon.',
    cone_unavailable: 'Not enough spot history to build the vol cone for this horizon.',
    iv_far_below_realized:
      'Buy IV is more than 5 pts below both 7D and 30D trailing realized vol. In our 2021–26 Deribit reconstruction, 7D straddles bought in that state lost about 40% of the debit on average: realized vol fades, and the market prices the fade.',
    term_backwardation:
      'Front IV is above 30D IV. The market is already paying up for near-term movement.',
    theta_window:
      'Under two days to expiry. Time decay is steepest here, so the move has to come almost immediately.',
    size_below_minimum: 'The max-loss budget or top-of-book size cannot cover the venue minimum.',
    forecast_unavailable: 'No realized-vol forecast is available, so the price cannot be judged.',
    gateIvBelowForecast: 'IV below forecast',
    gateEdge: 'Edge beyond ±2pt',
    gateCone: 'Vol cone ≤ p25',
    gateNoTrap: 'No regime trap',
    title: 'Price · forecast · max loss',
    tipGreen:
      'Green means the asks after fees imply less vol than the matched-horizon forecast, by more than the ±2 pt fair band, and the price is low on the vol cone. It still needs a thesis and an execution check.',
    tipLoss:
      'The loss is capped at the debit. Time decay costs money every day the move does not come.',
    buyContract: 'buy {strike} C + P · {expiry} ·',
    longVol: 'long vol',
    longStraddle: 'long straddle',
    maxLossAtStrike: 'max loss at strike',
    toBreakEven: '±{pct} to break even',
    lossBudgetUsed: 'Loss budget used',
    debit: 'Debit {value}',
    debitVsValue: 'Debit / value at forecast',
    expMove: 'exp. move {move} vs BE {be}',
    priceGates: 'Price gates',
    debitMaxLoss: 'Debit (max loss)',
    buyIvFcst: 'Buy IV / fcst',
    outsideBe: 'Outside BE (model)',
    thetaDay: 'Theta / day',
    passNote:
      'The asks after fees imply less vol than the matched forecast by more than 2 pts, the price sits at or below p25 of the vol cone, and no regime trap is flagged. That supports a buy, but it is not proof of an edge. Record the thesis before trading.',
    footnote:
      '{weekend} of the remaining life is weekend, weighted at 0.52× weekday variance (BTC 2021–26), so the forecast is {forecast} against {calendar} in calendar time. Daily breakeven move {daily} vs forecast {forecastDaily}. Entry fees {fees}. In our 2021–26 Deribit reconstruction, buying IV below this forecast was not yet a demonstrated edge (−3% to −15% of debit, CIs include zero). Treat green as a price check that needs your own move thesis.',
    payoffAria: 'Long straddle expiry payoff from {from} to {to}',
  },
  {
    buyCandidateLabel: 'REVISAR SETUP',
    buyCandidateMessage: 'La vol pronosticada supera el precio · verifica la tesis',
    watchLabel: 'VIGILAR',
    watchMessage: 'Barato en precio · advertencia de régimen o edge',
    expensiveLabel: 'CARO · NO COMPRAR',
    expensiveMessage: 'Los asks cuestan más que la vol pronosticada',
    noForecastLabel: 'SIN PRONÓSTICO',
    noForecastMessage: 'No se puede juzgar el precio',
    iv_above_forecast:
      'La IV de compra (asks más comisiones) no está por debajo del pronóstico al mismo horizonte. Un long straddle cubierto gana la realizada menos la implícita, así que el pronóstico debe superar el precio (Sinclair p. 87).',
    edge_within_fair_band:
      'El pronóstico supera la IV de compra por menos de 2 puntos de vol. Eso está dentro del error de pronóstico, así que se considera justo, no barato.',
    above_cone_median:
      'La IV de compra está en o por encima de la vol realizada mediana para este horizonte. No es barata frente al cono de vol (Sinclair pp. 39–41).',
    above_cone_p25:
      'La IV de compra está por encima del percentil 25 del cono de vol. Está bajo la mediana, pero no es históricamente baja para este horizonte.',
    cone_unavailable: 'No hay suficiente historial de spot para construir el cono de vol en este horizonte.',
    iv_far_below_realized:
      'La IV de compra está más de 5 pts por debajo de la vol realizada 7D y 30D. En nuestra reconstrucción de Deribit 2021–26, los straddles 7D comprados en ese estado perdieron en promedio cerca del 40% del débito: la vol realizada se desvanece y el mercado lo descuenta.',
    term_backwardation:
      'La IV de corto plazo está por encima de la IV 30D. El mercado ya paga de más por el movimiento de corto plazo.',
    theta_window:
      'Menos de dos días al vencimiento. El decaimiento temporal es máximo aquí, así que el movimiento tiene que llegar casi de inmediato.',
    size_below_minimum:
      'El presupuesto de pérdida máx. o el tamaño del top of book no cubren el mínimo del exchange.',
    forecast_unavailable: 'No hay pronóstico de vol realizada disponible, así que no se puede juzgar el precio.',
    gateIvBelowForecast: 'IV bajo el pronóstico',
    gateEdge: 'Edge más allá de ±2pt',
    gateCone: 'Cono de vol ≤ p25',
    gateNoTrap: 'Sin trampa de régimen',
    title: 'Precio · pronóstico · pérdida máx.',
    tipGreen:
      'Verde significa que los asks después de comisiones implican menos vol que el pronóstico al mismo horizonte, por más de la banda justa de ±2 pt, y que el precio está bajo en el cono de vol. Aún necesita una tesis y una revisión de ejecución.',
    tipLoss:
      'La pérdida está limitada al débito. El decaimiento temporal cuesta dinero cada día que el movimiento no llega.',
    buyContract: 'comprar {strike} C + P · {expiry} ·',
    longVol: 'long vol',
    longStraddle: 'long straddle',
    maxLossAtStrike: 'pérdida máx. en el strike',
    toBreakEven: '±{pct} para breakeven',
    lossBudgetUsed: 'Presupuesto de pérdida usado',
    debit: 'Débito {value}',
    debitVsValue: 'Débito / valor al pronóstico',
    expMove: 'mov. esp. {move} vs BE {be}',
    priceGates: 'Filtros de precio',
    debitMaxLoss: 'Débito (pérdida máx.)',
    buyIvFcst: 'IV compra / pron.',
    outsideBe: 'Fuera de BE (modelo)',
    thetaDay: 'Theta / día',
    passNote:
      'Los asks después de comisiones implican menos vol que el pronóstico equivalente por más de 2 pts, el precio está en o por debajo de p25 del cono de vol y no se marca ninguna trampa de régimen. Eso respalda una compra, pero no prueba un edge. Registra la tesis antes de operar.',
    footnote:
      '{weekend} de la vida restante es fin de semana, ponderado a 0.52× la varianza de días hábiles (BTC 2021–26), así que el pronóstico es {forecast} frente a {calendar} en tiempo calendario. Movimiento diario de breakeven {daily} vs pronóstico {forecastDaily}. Comisiones de entrada {fees}. En nuestra reconstrucción de Deribit 2021–26, comprar IV por debajo de este pronóstico aún no fue un edge demostrado (−3% a −15% del débito, los IC incluyen cero). Trata el verde como una revisión de precio que necesita tu propia tesis de movimiento.',
    payoffAria: 'Payoff al vencimiento del long straddle de {from} a {to}',
  },
);

type LongStraddleKey = keyof typeof longStraddleMessages.en;

export const LONG_STRADDLE_STATUS: Record<
  AlphaLongStraddleVerdict,
  { label: LongStraddleKey; tone: 'review' | 'neutral' | 'danger'; message: LongStraddleKey }
> = {
  'buy-candidate': {
    label: 'buyCandidateLabel',
    tone: 'review',
    message: 'buyCandidateMessage',
  },
  watch: { label: 'watchLabel', tone: 'neutral', message: 'watchMessage' },
  expensive: {
    label: 'expensiveLabel',
    tone: 'danger',
    message: 'expensiveMessage',
  },
  'no-forecast': { label: 'noForecastLabel', tone: 'neutral', message: 'noForecastMessage' },
};

type GateState = 'pass' | 'fail' | 'warn';

function gates(
  candidate: AlphaLongStraddleCandidate,
  t: (key: LongStraddleKey) => string,
  ta: AlphaT,
) {
  const has = (flag: AlphaLongStraddleFlag) => candidate.flags.includes(flag);
  const regimeFlags: AlphaLongStraddleFlag[] = [
    'iv_far_below_realized',
    'term_backwardation',
    'theta_window',
  ];
  const rows: Array<{ label: string; detail: string; state: GateState }> = [
    {
      label: t('gateIvBelowForecast'),
      detail: `${fmtIv(candidate.buyIv)} vs ${fmtIv(candidate.forecastVol)}`,
      state: has('forecast_unavailable') || has('iv_above_forecast') ? 'fail' : 'pass',
    },
    {
      label: t('gateEdge'),
      detail:
        candidate.volEdge == null ? ta('unknown') : `${(candidate.volEdge * 100).toFixed(1)}pt`,
      state:
        has('forecast_unavailable') || has('iv_above_forecast')
          ? 'fail'
          : has('edge_within_fair_band')
            ? 'warn'
            : 'pass',
    },
    {
      label: t('gateCone'),
      detail:
        candidate.conePercentile == null ? ta('noCone') : `p${candidate.conePercentile.toFixed(0)}`,
      state: has('above_cone_median')
        ? 'fail'
        : has('above_cone_p25') || has('cone_unavailable')
          ? 'warn'
          : 'pass',
    },
    {
      label: t('gateNoTrap'),
      detail:
        regimeFlags.filter(has).length === 0
          ? ta('noFlags')
          : ta('flagCount', { n: regimeFlags.filter(has).length }),
      state: regimeFlags.some(has) ? 'warn' : 'pass',
    },
  ];
  return rows;
}

interface LongStraddleDecisionCardProps {
  candidate: AlphaLongStraddleCandidate | null;
  emptyReason: string;
  budgetUsd: number;
  onOpenBuilder: (candidate: AlphaLongStraddleCandidate) => void;
}

export default function LongStraddleDecisionCard({
  candidate,
  emptyReason,
  budgetUsd,
  onOpenBuilder,
}: LongStraddleDecisionCardProps) {
  const t = useT(longStraddleMessages);
  const ta = useT(alphaMessages);
  return (
    <section
      className={signal.card}
      data-state={
        candidate == null
          ? 'empty'
          : candidate.verdict === 'buy-candidate'
            ? 'review'
            : candidate.verdict === 'expensive'
              ? 'no-edge'
              : 'no-model'
      }
    >
      <header className={signal.header}>
        <div>
          <span className={signal.eyebrow}>{ta('straddleDecision')}</span>
          <h2 className={signal.title}>{t('title')}</h2>
        </div>
        <InfoTip label={ta('howToRead')} title={ta('filterNotInstruction')} align="end">
          <p>{t('tipGreen')}</p>
          <p>{t('tipLoss')}</p>
        </InfoTip>
      </header>
      {candidate == null ? (
        <div className={signal.emptyState}>
          <div className={signal.emptySignal} aria-hidden="true">
            <span>∿</span>
          </div>
          <div className={signal.emptyCopy}>
            <strong>{ta('noExecutableStraddle')}</strong>
            <p>{emptyReason}</p>
          </div>
        </div>
      ) : (
        <Dashboard candidate={candidate} budgetUsd={budgetUsd} onOpenBuilder={onOpenBuilder} />
      )}
    </section>
  );
}

function Dashboard({
  candidate,
  budgetUsd,
  onOpenBuilder,
}: Omit<LongStraddleDecisionCardProps, 'candidate' | 'emptyReason'> & {
  candidate: AlphaLongStraddleCandidate;
}) {
  const t = useT(longStraddleMessages);
  const ta = useT(alphaMessages);
  const status = LONG_STRADDLE_STATUS[candidate.verdict];
  const sized = candidate.suggestedQuantity > 0;
  const quantity = sized ? candidate.suggestedQuantity : candidate.minQuantity;
  const maxLossUsd = quantity * candidate.netDebit;
  const budgetUse = budgetUsd > 0 ? (maxLossUsd / budgetUsd) * 100 : null;
  const rows = gates(candidate, t, ta);
  const fair = candidate.fairValueAtForecast;
  const fairShare =
    fair == null ? 50 : (fair / (fair + candidate.netDebit)) * 100;

  return (
    <>
      <div className={signal.decisionRow}>
        <div className={signal.statusLockup} data-tone={status.tone}>
          <span className={signal.statusBeacon} aria-hidden="true" />
          <div>
            <strong>{t(status.label)}</strong>
            <span>{t(status.message)}</span>
          </div>
        </div>
        <div className={signal.contractLine}>
          <strong>{VENUES[candidate.venue]?.label ?? candidate.venue}</strong>
          <span>
            {t('buyContract', {
              strike: fmtStrike(candidate.strike),
              expiry: formatExpiry(candidate.expiry),
            })}{' '}
            {candidate.dte.toFixed(1)}D
          </span>
          <span>
            {quantity} {candidate.underlying}
            {sized ? '' : ta('venueMin')}
          </span>
          <span className={signal.direction}>{t('longVol')}</span>
        </div>
      </div>

      <div className={signal.visualGrid}>
        <div className={`${signal.visualPanel} ${signal.payoffPanel}`}>
          <div className={signal.panelHeader}>
            <span>{ta('expiryPayoff')}</span>
            <strong>{t('longStraddle')}</strong>
          </div>
          <LongStraddlePayoff candidate={candidate} quantity={quantity} />
          <div className={signal.payoffLegend}>
            <span data-kind="loss">
              −{fmtUsd(maxLossUsd)} {t('maxLossAtStrike')}
            </span>
            <span data-kind="profit">
              {t('toBreakEven', { pct: fmtPct(candidate.breakevenMovePct, 1) })}
            </span>
          </div>
        </div>

        <div className={signal.visualPanel}>
          <div className={signal.panelHeader}>
            <span>{t('lossBudgetUsed')}</span>
            <strong data-kind={budgetUse != null && budgetUse > 100 ? 'loss' : 'profit'}>
              {budgetUse == null ? '—' : `${budgetUse.toFixed(0)}%`}
            </strong>
          </div>
          <div className={signal.riskMeter}>
            <div className={signal.riskScale}>
              <span>0</span>
              <span>50</span>
              <span>100%</span>
            </div>
            <div className={signal.riskTrack}>
              <span
                className={signal.riskFill}
                data-over={budgetUse != null && budgetUse > 100}
                style={{ width: `${Math.min(budgetUse ?? 0, 100)}%` }}
              />
              <i className={signal.riskMarker} />
            </div>
            {budgetUse != null && budgetUse > 100 && (
              <span className={signal.overflowLabel}>
                {ta('overLimit', { pct: (budgetUse - 100).toFixed(0) })}
              </span>
            )}
          </div>
          <div className={signal.meterLabels}>
            <span>{t('debit', { value: fmtUsd(maxLossUsd) })}</span>
            <span>{ta('limit', { value: fmtUsd(budgetUsd) })}</span>
          </div>
          <div className={signal.balanceBlock}>
            <span className={signal.miniLabel}>{t('debitVsValue')}</span>
            <div className={signal.balanceBar}>
              <span className={signal.lossBalance} style={{ width: `${100 - fairShare}%` }} />
              <span className={signal.profitBalance} style={{ width: `${fairShare}%` }} />
            </div>
            <div className={signal.meterLabels}>
              <span>
                {t('expMove', {
                  move: fmtPct(candidate.expectedMoveAtForecastPct, 1),
                  be: fmtPct(candidate.breakevenMovePct, 1),
                })}
              </span>
              <span>{ta('book', { n: candidate.topOfBookQuantity })}</span>
            </div>
          </div>
        </div>

        <div className={signal.visualPanel}>
          <div className={signal.panelHeader}>
            <span>{t('priceGates')}</span>
            <strong>{ta('gatesPass', { n: rows.filter((gate) => gate.state === 'pass').length })}</strong>
          </div>
          <ul className={styles.gateList}>
            {rows.map((gate) => (
              <li key={gate.label} data-state={gate.state}>
                <span aria-hidden="true">
                  {gate.state === 'pass' ? '✓' : gate.state === 'fail' ? '✕' : '!'}
                </span>
                <strong>{gate.label}</strong>
                <small>{gate.detail}</small>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={signal.metricsStrip}>
        <Metric label={t('debitMaxLoss')} value={fmtUsd(maxLossUsd)} />
        <Metric
          label={ta('breakevens')}
          value={`${fmtUsdCompact(candidate.breakevenLow)}–${fmtUsdCompact(candidate.breakevenHigh)}`}
        />
        <Metric
          label={t('buyIvFcst')}
          value={`${fmtIv(candidate.buyIv)} / ${fmtIv(candidate.forecastVol)}`}
        />
        <Metric
          label={ta('modelEdge')}
          value={fmtUsd(candidate.modelEdgeUsd == null ? null : candidate.modelEdgeUsd * quantity)}
          tone={candidate.modelEdgeUsd != null && candidate.modelEdgeUsd > 0 ? 'profit' : 'loss'}
        />
        <Metric
          label={t('outsideBe')}
          value={
            candidate.probOutsideAtForecast == null
              ? '—'
              : fmtPct(candidate.probOutsideAtForecast * 100, 0)
          }
        />
        <Metric
          label={t('thetaDay')}
          value={`−${fmtUsd(candidate.thetaUsdPerDay * quantity)}`}
          tone="loss"
        />
      </div>

      <details className={signal.review}>
        <summary>
          {ta('whyVerdict')} ·{' '}
          {candidate.flags.length === 0
            ? ta('allGatesPass')
            : ta('flagsCount', { n: candidate.flags.length })}
        </summary>
        {candidate.flags.length === 0 ? (
          <p className={styles.passNote}>{t('passNote')}</p>
        ) : (
          <ul className={styles.flagList}>
            {candidate.flags.map((flag) => (
              <li key={flag}>{t(flag)}</li>
            ))}
          </ul>
        )}
        <p className={signal.footnote}>
          {t('footnote', {
            weekend: fmtPct(candidate.weekendShare * 100, 0),
            forecast: fmtIv(candidate.forecastVol),
            calendar: fmtIv(candidate.calendarForecastVol),
            daily: fmtPct(candidate.dailyBreakevenMovePct, 2),
            forecastDaily: fmtPct(candidate.forecastDailyMovePct, 2),
            fees: fmtUsd(candidate.entryFees * quantity),
          })}
        </p>
      </details>

      <button
        type="button"
        className={styles.builderButton}
        onClick={() => onOpenBuilder(candidate)}
      >
        <span>{ta('openInBuilder')}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </>
  );
}

function LongStraddlePayoff({
  candidate,
  quantity,
}: {
  candidate: AlphaLongStraddleCandidate;
  quantity: number;
}) {
  const K = candidate.strike;
  const reach = (candidate.breakevenMovePct / 100) * 2.5;
  const from = K * (1 - reach);
  const to = K * (1 + reach);
  const pnl = (price: number) => quantity * (Math.abs(price - K) - candidate.netDebit);
  const bottom = pnl(K);
  const top = Math.max(pnl(from), pnl(to));
  const chartWidth = 520;
  const chartHeight = 132;
  const padding = 10;
  const scaleX = (price: number) =>
    padding + ((price - from) / (to - from)) * (chartWidth - padding * 2);
  const scaleY = (value: number) =>
    padding + ((top - value) / (top - bottom)) * (chartHeight - padding * 2);
  const points = [from, K, to].map((price) => `${scaleX(price)},${scaleY(pnl(price))}`).join(' ');
  const zeroY = scaleY(0);
  const forwardX = scaleX(candidate.forwardPrice);
  const t = useT(longStraddleMessages);
  const labels = [
    { price: candidate.breakevenLow, text: fmtUsdCompact(candidate.breakevenLow) },
    { price: K, text: fmtUsdCompact(K) },
    { price: candidate.breakevenHigh, text: fmtUsdCompact(candidate.breakevenHigh) },
  ];

  return (
    <div className={signal.chartWrap}>
      <svg
        className={signal.payoffChart}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={t('payoffAria', { from: fmtUsd(from), to: fmtUsd(to) })}
      >
        <rect x="0" y="0" width={chartWidth} height={zeroY} className={signal.profitZone} />
        <rect
          x="0"
          y={zeroY}
          width={chartWidth}
          height={chartHeight - zeroY}
          className={signal.lossZone}
        />
        <line x1="0" x2={chartWidth} y1={zeroY} y2={zeroY} className={signal.zeroLine} />
        {labels.map(({ price }) => (
          <line
            key={price}
            x1={scaleX(price)}
            x2={scaleX(price)}
            y1="0"
            y2={chartHeight}
            className={signal.strikeLine}
          />
        ))}
        <line x1={forwardX} x2={forwardX} y1="0" y2={chartHeight} className={signal.spotLine} />
        <polyline points={points} className={signal.payoffPathGlow} />
        <polyline points={points} className={signal.payoffPath} />
      </svg>
      {labels.map(({ price, text }) => (
        <span
          key={price}
          className={signal.axisLabel}
          style={{ left: `${(scaleX(price) / chartWidth) * 100}%` }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'profit' | 'loss' }) {
  return (
    <div className={signal.metric}>
      <span>{label}</span>
      <strong data-kind={tone}>{value}</strong>
    </div>
  );
}
