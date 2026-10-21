import type { PortfolioCloseNow, PortfolioMetrics, PositionLeg } from '@oggregator/protocol';

import {
  CLOSE_NOW_COMBO_NOTE,
  CLOSE_NOW_TOOLTIP,
  coverageNote,
  fmtAge,
  giveBackLevel,
} from './close-now';
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
function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtCashFlow(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.005) return '$0';
  return fmtUsdSigned(value);
}

function exposureSide(value: number | null | undefined, positive: string, negative: string): string {
  if (value == null || Math.abs(value) < 1e-9) return 'Flat';
  return value > 0 ? positive : negative;
}

interface PremiumRowProps {
  label: string;
  note: string;
  debitUsd: number | null;
  creditUsd: number | null;
}

// Cash-flow signs: premium paid is money out (−), premium received is money in (+).
function PremiumRow({ label, note, debitUsd, creditUsd }: PremiumRowProps) {
  const net = debitUsd == null || creditUsd == null ? null : creditUsd - debitUsd;
  const netSide =
    net == null ? null : net > 0.005 ? 'credit' : net < -0.005 ? 'debit' : 'flat';
  return (
    <div className={styles.premiumRow} role="row">
      <span role="rowheader">
        {label}
        <small>{note}</small>
      </span>
      <strong role="cell">{fmtCashFlow(debitUsd == null ? null : -debitUsd)}</strong>
      <strong role="cell">{fmtCashFlow(creditUsd)}</strong>
      <strong
        role="cell"
        data-sign={netSide === 'credit' ? 'positive' : netSide === 'debit' ? 'negative' : undefined}
      >
        {fmtCashFlow(net)}
        {netSide != null && <small>net {netSide}</small>}
      </strong>
    </div>
  );
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function CloseNowMetric({ closeNow }: { closeNow: PortfolioCloseNow | null | undefined }) {
  if (closeNow == null) {
    return (
      <div className={styles.closeNow} title={CLOSE_NOW_TOOLTIP}>
        <span className={styles.metricLabel}>Close-now P&amp;L</span>
        <span className={styles.metricFoot}>order books off</span>
      </div>
    );
  }
  const total = closeNow.portfolio;
  const level = giveBackLevel(total.giveBackPct);
  const coverage = coverageNote(total);
  const staleAge = total.stale
    ? Math.max(0, ...closeNow.legs.filter((l) => l.stale).map((l) => l.bookAgeMs ?? 0))
    : null;
  const foot = [
    staleAge != null ? `stale · book ${fmtAge(staleAge)} old` : null,
    coverage,
    total.feesUsd > 0 ? `fees ${fmtUsdSigned(-total.feesUsd)}` : null,
  ].filter((part): part is string => part != null);
  return (
    <div
      className={styles.closeNow}
      data-stale={total.stale || undefined}
      title={`${CLOSE_NOW_TOOLTIP}\n${CLOSE_NOW_COMBO_NOTE}`}
    >
      <span className={styles.metricLabel}>Close-now P&amp;L</span>
      <div className={styles.closeNowRow}>
        <strong
          className={styles.closeNowValue}
          data-sign={(total.closeNowPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'}
        >
          {fmtUsdSigned(total.closeNowPnlUsd)}
        </strong>
        <span className={styles.closeNowStat}>
          <small>Exit cost</small>
          {total.exitCostUsd == null ? '—' : fmtUsdSigned(-total.exitCostUsd)}
        </span>
        <span className={styles.closeNowStat} data-giveback={level ?? undefined}>
          <small>Give-back</small>
          {total.giveBackPct == null ? '—' : `${total.giveBackPct.toFixed(0)}%`}
        </span>
      </div>
      {total.peak != null && (
        <span className={styles.metricFoot}>
          peak {fmtUsdSigned(total.peak.closeNowPnlUsd)} at {fmtTime(total.peak.atMs)}
          {total.peak.markPnlUsd != null ? ` (mark ${fmtUsdSigned(total.peak.markPnlUsd)})` : ''}
        </span>
      )}
      <span className={styles.metricFoot}>
        {foot.length > 0 ? foot.join(' · ') : 'taker close on holding venue, after fees'}
      </span>
    </div>
  );
}

export default function RiskCockpit({ metrics, positions }: Props) {
  const totals = metrics?.totals ?? null;
  const accounting = metrics?.accounting ?? null;
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
            <CloseNowMetric closeNow={metrics?.closeNow} />
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
      <div className={styles.accounting} aria-label="Premium and venue ledger">
        <div className={styles.ledgerBody}>
          <div className={styles.premiumTable} role="table" aria-label="Premium paid and received">
            <div className={styles.premiumRow} role="row" data-head>
              <span role="columnheader">Premium</span>
              <span role="columnheader">Paid</span>
              <span role="columnheader">Received</span>
              <span role="columnheader">Net</span>
            </div>
            <PremiumRow
              label="Open book"
              note="legs still open"
              debitUsd={accounting?.openGrossDebitUsd ?? null}
              creditUsd={accounting?.openGrossCreditUsd ?? null}
            />
            <PremiumRow
              label="Lifetime"
              note={
                accounting?.lifetimeGrossDebitUsd == null
                  ? 'no fill history for this source'
                  : 'every persisted fill, closed legs included'
              }
              debitUsd={accounting?.lifetimeGrossDebitUsd ?? null}
              creditUsd={accounting?.lifetimeGrossCreditUsd ?? null}
            />
          </div>
          <div className={styles.accountingGrid}>
            <article className={styles.accountingCell}>
              <span>Known fees</span>
              <strong>{fmtUsd(accounting?.knownFeesUsd)}</strong>
              <small>persisted venue fills</small>
            </article>
            <article className={styles.accountingCell}>
              <span>Realized P&amp;L</span>
              <strong data-sign={(accounting?.realizedPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'}>
                {fmtUsdSigned(accounting?.realizedPnlUsd)}
              </strong>
              <small>venue-reported</small>
            </article>
          </div>
        </div>
        <div className={styles.ledgerStatus} data-state={metrics?.accounting.persistence ?? 'unavailable'}>
          <span>
            {metrics?.accounting.persistence === 'venue_history'
              ? `${metrics.accounting.persistedTradeCount ?? 0} venue fills persisted`
              : metrics?.accounting.persistence === 'position_snapshot'
                ? 'Position snapshot persisted; venue fill history pending'
                : 'Venue fill persistence unavailable'}
          </span>
          <span>
            {metrics?.accounting.lastSyncedAtMs == null
              ? 'Not synced'
              : `Synced ${new Date(metrics.accounting.lastSyncedAtMs).toLocaleString()}`}
          </span>
        </div>
      </div>


      <div className={styles.exposureGrid}>
        <article className={styles.exposureCard} data-accent="delta">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>Direction</span>
            <span className={styles.greek}>Delta</span>
          </div>
          <strong className={styles.exposureValue}>{fmtNum(totals?.netDeltaCoin)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netDeltaCoin, 'Long delta', 'Short delta')}
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
