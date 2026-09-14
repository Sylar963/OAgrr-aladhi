import type { PortfolioMetrics, PositionLeg } from '@oggregator/protocol';

import { fmtNum, fmtUsdSigned } from './format';
import {
  calculateIvEdge,
  classifyBook,
  getParallelVolShock,
  getSpotShock,
  type BookMode,
} from './risk-profile';
import styles from './RiskCockpit.module.css';

interface Props {
  metrics: PortfolioMetrics | null;
  positions: PositionLeg[];
}

interface ModeMeta {
  eyebrow: string;
  label: string;
  summary: string;
  pressure: string;
}

const MODE_META: Record<BookMode, ModeMeta> = {
  flat: {
    eyebrow: 'Waiting for a position',
    label: 'NO OPEN RISK',
    summary: 'Add or connect a position to map the book into direction, volatility, convexity and carry.',
    pressure: 'No active risk',
  },
  long_vol: {
    eyebrow: 'Optionality buyer',
    label: 'LONG VOL',
    summary: 'You pay daily decay for convexity. The trade needs a large move, higher implied vol, or both.',
    pressure: 'Main pressure: vol crush + theta',
  },
  short_vol: {
    eyebrow: 'Risk-premia seller',
    label: 'SHORT VOL',
    summary: 'You collect daily decay while warehousing jump risk. A large move or vol expansion hurts.',
    pressure: 'Main pressure: convexity + vol expansion',
  },
  vega_neutral: {
    eyebrow: 'Balanced volatility',
    label: 'VEGA NEUTRAL',
    summary: 'Net vol exposure is close to flat. Direction, skew and convexity can still drive the book.',
    pressure: 'Check delta + skew',
  },
};

function fmtIv(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtVolPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} vol`;
}

function exposureSide(value: number | null | undefined, positive: string, negative: string): string {
  if (value == null || Math.abs(value) < 1e-9) return 'Flat';
  return value > 0 ? positive : negative;
}

export default function RiskCockpit({ metrics, positions }: Props) {
  const totals = metrics?.totals ?? null;
  const mode = classifyBook(totals, positions.length);
  const modeMeta = MODE_META[mode];
  const ivEdge = calculateIvEdge(positions, metrics?.breakEven ?? []);
  const spotDown = metrics == null ? null : getSpotShock(metrics.pnlCurve, -0.05);
  const spotUp = metrics == null ? null : getSpotShock(metrics.pnlCurve, 0.05);
  const volDown = getParallelVolShock(metrics?.shockGrid ?? [], -5);
  const volUp = getParallelVolShock(metrics?.shockGrid ?? [], 5);

  return (
    <section className={styles.cockpit} aria-label="Portfolio risk cockpit">
      <div className={styles.posture} data-mode={mode}>
        <div className={styles.postureCopy}>
          <span className={styles.kicker}>Book posture / {modeMeta.eyebrow}</span>
          <div className={styles.modeRow}>
            <h2 className={styles.mode}>{modeMeta.label}</h2>
            <span className={styles.pressure}>{modeMeta.pressure}</span>
          </div>
          <p className={styles.summary}>{modeMeta.summary}</p>
        </div>

        <div className={styles.headlineMetrics}>
          <div className={styles.headlineMetric}>
            <span className={styles.metricLabel}>Unrealized P&amp;L</span>
            <strong className={styles.pnl} data-sign={(totals?.unrealizedPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'}>
              {fmtUsdSigned(totals?.unrealizedPnlUsd)}
            </strong>
            <span className={styles.metricFoot}>mark to entry</span>
          </div>
          <div className={styles.headlineMetric}>
            <span className={styles.metricLabel}>IV edge</span>
            <strong className={styles.ivEdge} data-sign={(ivEdge?.edgeVolPts ?? 0) >= 0 ? 'positive' : 'negative'}>
              {fmtVolPoints(ivEdge?.edgeVolPts)}
            </strong>
            <span className={styles.metricFoot}>
              {ivEdge == null
                ? 'entry and live IV needed'
                : `${ivEdge.exposure} · ${fmtIv(ivEdge.entryIv)} entry → ${fmtIv(ivEdge.liveIv)} live`}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.exposureGrid}>
        <article className={styles.exposureCard} data-accent="delta">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>Direction</span>
            <span className={styles.greek}>Delta</span>
          </div>
          <strong className={styles.exposureValue}>{fmtNum(totals?.netDeltaUsd)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netDeltaUsd, 'Long delta', 'Short delta')}
          </span>
          <p>Synthetic perp exposure right now.</p>
        </article>

        <article className={styles.exposureCard} data-accent="vega">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>Volatility</span>
            <span className={styles.greek}>Vega</span>
          </div>
          <strong className={styles.exposureValue}>{fmtUsdSigned(totals?.netVegaUsd)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netVegaUsd, 'Long vol', 'Short vol')}
          </span>
          <p>P&amp;L when implied vol rises 1 point.</p>
        </article>

        <article className={styles.exposureCard} data-accent="gamma">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>Convexity</span>
            <span className={styles.greek}>Gamma</span>
          </div>
          <strong className={styles.exposureValue}>{fmtNum(totals?.netGammaUsd, 4)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netGammaUsd, 'Long convexity', 'Short convexity')}
          </span>
          <p>How quickly your delta changes on a move.</p>
        </article>

        <article className={styles.exposureCard} data-accent="theta">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>Daily carry</span>
            <span className={styles.greek}>Theta</span>
          </div>
          <strong className={styles.exposureValue}>{fmtUsdSigned(totals?.netThetaUsd)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netThetaUsd, 'Collecting decay', 'Paying decay')}
          </span>
          <p>Funding-like time decay for one unchanged day.</p>
        </article>
      </div>

      <div className={styles.stressSection}>
        <div className={styles.sectionLead}>
          <span className={styles.kicker}>Translate risk into P&amp;L</span>
          <span className={styles.secondaryGreeks}>
            Skew / Vanna {fmtNum(totals?.netVannaUsd, 4)} · Vol convexity / Volga {fmtNum(totals?.netVolgaUsd, 4)}
          </span>
        </div>
        <div className={styles.stressGrid}>
          <div className={styles.stressCard}>
            <span>Spot -5%</span>
            <strong data-sign={(spotDown ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(spotDown)}</strong>
            <small>delta + gamma</small>
          </div>
          <div className={styles.stressCard}>
            <span>Spot +5%</span>
            <strong data-sign={(spotUp ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(spotUp)}</strong>
            <small>delta + gamma</small>
          </div>
          <div className={styles.stressCard}>
            <span>IV -5 vol</span>
            <strong data-sign={(volDown ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(volDown)}</strong>
            <small>vol crush</small>
          </div>
          <div className={styles.stressCard}>
            <span>IV +5 vol</span>
            <strong data-sign={(volUp ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(volUp)}</strong>
            <small>vol expansion</small>
          </div>
          <div className={styles.stressCard}>
            <span>Hold 1 day</span>
            <strong data-sign={(totals?.netThetaUsd ?? 0) >= 0 ? 'positive' : 'negative'}>
              {fmtUsdSigned(totals?.netThetaUsd)}
            </strong>
            <small>theta estimate</small>
          </div>
        </div>
      </div>
    </section>
  );
}
