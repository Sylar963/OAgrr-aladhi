import type { PortfolioMetrics, PositionLeg } from '@features/portfolio';
import {
  usePortfolioMetrics,
  usePortfolioPositions,
  usePortfolioWs,
  venueStatus,
} from '@features/portfolio';
import { fmtDelta, fmtNum, fmtUsd } from '@lib/format';
import { useEffect, useState } from 'react';
import styles from './ThalexLivePanel.module.css';

const THALEX_URL = import.meta.env.VITE_THALEX_REF_URL ?? 'https://thalex.com';

export default function ThalexLivePanel() {
  const { connectionState } = usePortfolioWs('thalex');
  const { data: positionsData } = usePortfolioPositions('thalex', { wsLive: true });
  const { data: metricsData } = usePortfolioMetrics(0, 'thalex', { wsLive: true });

  const positions: PositionLeg[] = positionsData?.positions ?? [];
  const metrics: PortfolioMetrics | null = metricsData?.metrics ?? null;

  const [connected, setConnected] = useState<boolean>(positions.length > 0);

  useEffect(() => {
    venueStatus('thalex')
      .then((status) => setConnected(status.connected))
      .catch(() => setConnected(false));
  }, []);

  const isConnected = connected || positions.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Thalex Live Account</span>
          <span>{connectionState}</span>
        </div>

        {!isConnected ? (
          <div className={styles.empty}>
            Connect your Thalex key to view your live funded account.
          </div>
        ) : (
          <PositionsTable positions={positions} />
        )}

        {metrics && <GreeksSummary metrics={metrics} />}

        <div className={styles.note}>
          <span>For order entry and execution, visit</span>
          <a
            href={THALEX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.noteLink}
          >
            Trade on Thalex ↗
          </a>
        </div>
      </div>

      {metrics && <ChallengeMetrics metrics={metrics} />}
    </div>
  );
}

function PositionsTable({ positions }: { positions: PositionLeg[] }) {
  if (positions.length === 0) {
    return <div className={styles.empty}>No open positions.</div>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Instrument</th>
          <th className={styles.rightAlign}>Size</th>
          <th className={styles.rightAlign}>Entry</th>
          <th className={styles.rightAlign}>Realized PnL</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((leg) => (
          <tr key={leg.legId}>
            <td>
              {leg.underlying ?? ''} {leg.expiry ?? ''} {leg.strike ?? ''}{' '}
              {leg.optionRight ? leg.optionRight.toUpperCase() : ''}
            </td>
            <td className={styles.rightAlign}>{fmtNum(leg.size, 2)}</td>
            <td className={styles.rightAlign}>{fmtUsd(leg.entryPriceUsd)}</td>
            <td
              className={`${styles.rightAlign} ${toneClass(leg.realizedPnlUsd) ? styles[toneClass(leg.realizedPnlUsd) as 'positive' | 'negative'] : ''}`}
            >
              {fmtUsd(leg.realizedPnlUsd)}
            </td>
            <td>{leg.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GreeksSummary({ metrics }: { metrics: PortfolioMetrics }) {
  const t = metrics.totals;
  return (
    <div className={styles.metricGrid}>
      <MetricCard label="Δ Delta" value={fmtDelta(t.netDeltaUsd)} />
      <MetricCard label="Γ Gamma" value={fmtNum(t.netGammaUsd, 4)} />
      <MetricCard label="Θ Theta" value={fmtUsd(t.netThetaUsd)} />
      <MetricCard label="V Vega" value={fmtUsd(t.netVegaUsd)} />
      <MetricCard
        label="Unrealized PnL"
        value={fmtUsd(t.unrealizedPnlUsd)}
        tone={toneClass(t.unrealizedPnlUsd)}
      />
    </div>
  );
}

function ChallengeMetrics({ metrics }: { metrics: PortfolioMetrics }) {
  const unrealized = metrics.totals.unrealizedPnlUsd;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>Challenge metrics (read-only)</div>
      <div className={styles.challengeRow}>
        <div>
          <div className={styles.challengeLabel}>Profit target</div>
          <div className={styles.challengeValue}>10%</div>
        </div>
        <div>
          <div className={styles.challengeLabel}>Max drawdown floor</div>
          <div className={styles.challengeValue}>80%</div>
        </div>
        <div>
          <div className={styles.challengeLabel}>Profit split</div>
          <div className={styles.challengeValue}>80%</div>
        </div>
        <div>
          <div className={styles.challengeLabel}>Live PnL</div>
          <div
            className={`${styles.challengeValue} ${toneClass(unrealized) ? styles[toneClass(unrealized) as 'positive' | 'negative'] : ''}`}
          >
            {fmtUsd(unrealized)}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | null;
}) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${tone ? styles[tone] : ''}`}>{value}</div>
    </div>
  );
}

function toneClass(value: number | null | undefined): 'positive' | 'negative' | null {
  if (value == null || value === 0) return null;
  return value > 0 ? 'positive' : 'negative';
}
