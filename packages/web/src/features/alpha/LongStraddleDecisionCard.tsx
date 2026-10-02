import InfoTip from '@components/ui/InfoTip';
import type {
  AlphaLongStraddleCandidate,
  AlphaLongStraddleFlag,
  AlphaLongStraddleVerdict,
} from '@oggregator/protocol';
import { fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';

import signal from './SignalCard.module.css';
import styles from './StraddleScannerPanel.module.css';

export const LONG_STRADDLE_STATUS: Record<
  AlphaLongStraddleVerdict,
  { label: string; tone: 'review' | 'neutral' | 'danger'; message: string }
> = {
  'buy-candidate': {
    label: 'CHECK SETUP',
    tone: 'review',
    message: 'Forecast vol is above the price · verify thesis',
  },
  watch: { label: 'WATCH', tone: 'neutral', message: 'Cheap on price · regime or edge caveat' },
  expensive: {
    label: "EXPENSIVE · DON'T BUY",
    tone: 'danger',
    message: 'The asks cost more than the forecast vol',
  },
  'no-forecast': { label: 'NO FORECAST', tone: 'neutral', message: 'Cannot judge the price' },
};

export const LONG_FLAG_TEXT: Record<AlphaLongStraddleFlag, string> = {
  iv_above_forecast:
    'Buy IV (asks plus fees) is not below the matched-horizon forecast. A hedged long straddle earns realized minus implied, so the forecast has to exceed the price (Sinclair p. 87).',
  edge_within_fair_band:
    'The forecast is above the buy IV by less than 2 vol points. That is inside forecast error, so it reads as fair, not cheap.',
  above_cone_median:
    'Buy IV is at or above the median realized vol for this horizon. That is not cheap against the vol cone (Sinclair pp. 39–41).',
  above_cone_p25:
    'Buy IV is above the 25th percentile of the vol cone. It is below the median, but not historically low for this horizon.',
  cone_unavailable: 'Not enough spot history to build the vol cone for this horizon.',
  realized_spike_fading:
    'Buy IV is more than 5 pts below trailing 7D realized vol. In our 2021–26 Deribit reconstruction, 7D straddles bought in that state lost about 40% of the debit on average: spikes fade, and the market prices the fade.',
  term_backwardation:
    'Front IV is above 30D IV. The market is already paying up for near-term movement.',
  theta_window:
    'Under two days to expiry. Time decay is steepest here, so the move has to come almost immediately.',
  size_below_minimum:
    'The max-loss budget or top-of-book size cannot cover the venue minimum.',
  forecast_unavailable: 'No realized-vol forecast is available, so the price cannot be judged.',
};

type GateState = 'pass' | 'fail' | 'warn';

function gates(candidate: AlphaLongStraddleCandidate) {
  const has = (flag: AlphaLongStraddleFlag) => candidate.flags.includes(flag);
  const regimeFlags: AlphaLongStraddleFlag[] = [
    'realized_spike_fading',
    'term_backwardation',
    'theta_window',
  ];
  const rows: Array<{ label: string; detail: string; state: GateState }> = [
    {
      label: 'IV below forecast',
      detail: `${fmtIv(candidate.buyIv)} vs ${fmtIv(candidate.forecastVol)}`,
      state: has('forecast_unavailable') || has('iv_above_forecast') ? 'fail' : 'pass',
    },
    {
      label: 'Edge beyond ±2pt',
      detail:
        candidate.volEdge == null ? 'unknown' : `${(candidate.volEdge * 100).toFixed(1)}pt`,
      state:
        has('forecast_unavailable') || has('iv_above_forecast')
          ? 'fail'
          : has('edge_within_fair_band')
            ? 'warn'
            : 'pass',
    },
    {
      label: 'Vol cone ≤ p25',
      detail:
        candidate.conePercentile == null ? 'no cone' : `p${candidate.conePercentile.toFixed(0)}`,
      state: has('above_cone_median')
        ? 'fail'
        : has('above_cone_p25') || has('cone_unavailable')
          ? 'warn'
          : 'pass',
    },
    {
      label: 'No regime trap',
      detail:
        regimeFlags.filter(has).length === 0 ? 'no flags' : `${regimeFlags.filter(has).length} flag(s)`,
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
          <span className={signal.eyebrow}>Straddle decision</span>
          <h2 className={signal.title}>Price · forecast · max loss</h2>
        </div>
        <InfoTip label="How to read this screen" title="A filter, not an instruction" align="end">
          <p>
            Green means the asks after fees imply less vol than the matched-horizon forecast, by more
            than the ±2 pt fair band, and the price is low on the vol cone. It still needs a thesis
            and an execution check.
          </p>
          <p>
            The loss is capped at the debit. Time decay costs money every day the move does not
            come.
          </p>
        </InfoTip>
      </header>
      {candidate == null ? (
        <div className={signal.emptyState}>
          <div className={signal.emptySignal} aria-hidden="true">
            <span>∿</span>
          </div>
          <div className={signal.emptyCopy}>
            <strong>No executable straddle</strong>
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
  const status = LONG_STRADDLE_STATUS[candidate.verdict];
  const sized = candidate.suggestedQuantity > 0;
  const quantity = sized ? candidate.suggestedQuantity : candidate.minQuantity;
  const maxLossUsd = quantity * candidate.netDebit;
  const budgetUse = budgetUsd > 0 ? (maxLossUsd / budgetUsd) * 100 : null;
  const rows = gates(candidate);
  const fair = candidate.fairValueAtForecast;
  const fairShare =
    fair == null ? 50 : (fair / (fair + candidate.netDebit)) * 100;

  return (
    <>
      <div className={signal.decisionRow}>
        <div className={signal.statusLockup} data-tone={status.tone}>
          <span className={signal.statusBeacon} aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <span>{status.message}</span>
          </div>
        </div>
        <div className={signal.contractLine}>
          <strong>{VENUES[candidate.venue]?.label ?? candidate.venue}</strong>
          <span>
            buy {candidate.strike.toLocaleString()} C + P · {formatExpiry(candidate.expiry)} ·{' '}
            {candidate.dte.toFixed(1)}D
          </span>
          <span>
            {quantity} {candidate.underlying}
            {sized ? '' : ' (venue min)'}
          </span>
          <span className={signal.direction}>long vol</span>
        </div>
      </div>

      <div className={signal.visualGrid}>
        <div className={`${signal.visualPanel} ${signal.payoffPanel}`}>
          <div className={signal.panelHeader}>
            <span>Expiry payoff</span>
            <strong>long straddle</strong>
          </div>
          <LongStraddlePayoff candidate={candidate} quantity={quantity} />
          <div className={signal.payoffLegend}>
            <span data-kind="loss">−{fmtUsd(maxLossUsd)} max loss at strike</span>
            <span data-kind="profit">
              ±{fmtPct(candidate.breakevenMovePct, 1)} to break even
            </span>
          </div>
        </div>

        <div className={signal.visualPanel}>
          <div className={signal.panelHeader}>
            <span>Loss budget used</span>
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
                +{(budgetUse - 100).toFixed(0)}% over limit
              </span>
            )}
          </div>
          <div className={signal.meterLabels}>
            <span>Debit {fmtUsd(maxLossUsd)}</span>
            <span>Limit {fmtUsd(budgetUsd)}</span>
          </div>
          <div className={signal.balanceBlock}>
            <span className={signal.miniLabel}>Debit / value at forecast</span>
            <div className={signal.balanceBar}>
              <span className={signal.lossBalance} style={{ width: `${100 - fairShare}%` }} />
              <span className={signal.profitBalance} style={{ width: `${fairShare}%` }} />
            </div>
            <div className={signal.meterLabels}>
              <span>
                exp. move {fmtPct(candidate.expectedMoveAtForecastPct, 1)} vs BE{' '}
                {fmtPct(candidate.breakevenMovePct, 1)}
              </span>
              <span>book {candidate.topOfBookQuantity}</span>
            </div>
          </div>
        </div>

        <div className={signal.visualPanel}>
          <div className={signal.panelHeader}>
            <span>Price gates</span>
            <strong>{rows.filter((gate) => gate.state === 'pass').length}/4 pass</strong>
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
        <Metric label="Debit (max loss)" value={fmtUsd(maxLossUsd)} />
        <Metric
          label="Breakevens"
          value={`${fmtUsdCompact(candidate.breakevenLow)}–${fmtUsdCompact(candidate.breakevenHigh)}`}
        />
        <Metric
          label="Buy IV / fcst"
          value={`${fmtIv(candidate.buyIv)} / ${fmtIv(candidate.forecastVol)}`}
        />
        <Metric
          label="Model edge"
          value={fmtUsd(candidate.modelEdgeUsd == null ? null : candidate.modelEdgeUsd * quantity)}
          tone={candidate.modelEdgeUsd != null && candidate.modelEdgeUsd > 0 ? 'profit' : 'loss'}
        />
        <Metric
          label="Outside BE (model)"
          value={
            candidate.probOutsideAtForecast == null
              ? '—'
              : fmtPct(candidate.probOutsideAtForecast * 100, 0)
          }
        />
        <Metric
          label="Theta / day"
          value={`−${fmtUsd(candidate.thetaUsdPerDay * quantity)}`}
          tone="loss"
        />
      </div>

      <details className={signal.review}>
        <summary>
          Why this verdict ·{' '}
          {candidate.flags.length === 0 ? 'all gates pass' : `${candidate.flags.length} flags`}
        </summary>
        {candidate.flags.length === 0 ? (
          <p className={styles.passNote}>
            The asks after fees imply less vol than the matched forecast by more than 2 pts, the
            price sits at or below p25 of the vol cone, and no regime trap is flagged. That supports a
            buy, but it is not proof of an edge. Record the thesis before trading.
          </p>
        ) : (
          <ul className={styles.flagList}>
            {candidate.flags.map((flag) => (
              <li key={flag}>{LONG_FLAG_TEXT[flag]}</li>
            ))}
          </ul>
        )}
        <p className={signal.footnote}>
          Daily breakeven move {fmtPct(candidate.dailyBreakevenMovePct, 2)} vs forecast{' '}
          {fmtPct(candidate.forecastDailyMovePct, 2)}. Entry fees {fmtUsd(candidate.entryFees * quantity)}.
          In our 2021–26 Deribit reconstruction, buying IV below this forecast was not yet a
          demonstrated edge (−2% to −14% of debit, CIs include zero). Treat green as a price check
          that needs your own move thesis.
        </p>
      </details>

      <button
        type="button"
        className={styles.builderButton}
        onClick={() => onOpenBuilder(candidate)}
      >
        <span>Open both legs in Builder V2</span>
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
        aria-label={`Long straddle expiry payoff from ${fmtUsd(from)} to ${fmtUsd(to)}`}
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
