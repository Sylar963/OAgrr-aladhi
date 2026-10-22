import type { PortfolioMetrics, PositionLeg } from '@features/portfolio';
import {
  ThalexNetworkBadge,
  usePortfolioMetrics,
  usePortfolioPositions,
  usePortfolioWs,
  venueStatus,
} from '@features/portfolio';
import { fmtDelta, fmtNum, fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { useEffect, useState } from 'react';
import LiquidityCard from './LiquidityCard';
import styles from './ThalexLivePanel.module.css';

const messages = defineMessages(
  {
    account: 'Thalex Account',
    connect: 'Connect your Thalex key to view your live funded account.',
    orderEntry: 'For order entry and execution, visit',
    tradeOnThalex: 'Trade on Thalex ↗',
    noPositions: 'No open positions.',
    instrument: 'Instrument',
    size: 'Size',
    entry: 'Entry',
    realizedPnl: 'Realized PnL',
    source: 'Source',
    unrealizedPnl: 'Unrealized PnL',
    challengeMetrics: 'Challenge metrics (read-only)',
    profitTarget: 'Profit target',
    drawdownFloor: 'Max drawdown floor',
    profitSplit: 'Profit split',
    livePnl: 'Live PnL',
  },
  {
    account: 'Cuenta Thalex',
    connect: 'Conecta tu key de Thalex para ver tu cuenta fondeada real.',
    orderEntry: 'Para ingresar y ejecutar órdenes, visita',
    tradeOnThalex: 'Operar en Thalex ↗',
    noPositions: 'No hay posiciones abiertas.',
    instrument: 'Instrumento',
    size: 'Tamaño',
    entry: 'Entrada',
    realizedPnl: 'PnL realizado',
    source: 'Fuente',
    unrealizedPnl: 'PnL no realizado',
    challengeMetrics: 'Métricas del desafío (solo lectura)',
    profitTarget: 'Objetivo de ganancia',
    drawdownFloor: 'Piso de drawdown máx.',
    profitSplit: 'Reparto de ganancias',
    livePnl: 'PnL en vivo',
  },
);

const THALEX_URL = import.meta.env.VITE_THALEX_REF_URL ?? 'https://thalex.com';

export default function ThalexLivePanel() {
  const t = useT(messages);
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
          <span className={styles.headerTitle}>
            {t('account')} <ThalexNetworkBadge />
          </span>
          <span>{connectionState}</span>
        </div>

        {!isConnected ? (
          <div className={styles.empty}>
            {t('connect')}
          </div>
        ) : (
          <PositionsTable positions={positions} />
        )}

        {metrics && <GreeksSummary metrics={metrics} />}

        <div className={styles.note}>
          <span>{t('orderEntry')}</span>
          <a
            href={THALEX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.noteLink}
          >
            {t('tradeOnThalex')}
          </a>
        </div>
      </div>

      <LiquidityCard positions={positions} />

      {metrics && <ChallengeMetrics metrics={metrics} />}
    </div>
  );
}

function PositionsTable({ positions }: { positions: PositionLeg[] }) {
  const t = useT(messages);
  if (positions.length === 0) {
    return <div className={styles.empty}>{t('noPositions')}</div>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('instrument')}</th>
          <th className={styles.rightAlign}>{t('size')}</th>
          <th className={styles.rightAlign}>{t('entry')}</th>
          <th className={styles.rightAlign}>{t('realizedPnl')}</th>
          <th>{t('source')}</th>
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
  const tr = useT(messages);
  const t = metrics.totals;
  return (
    <div className={styles.metricGrid}>
      <MetricCard label="Δ Delta" value={fmtDelta(t.netDeltaCoin)} />
      <MetricCard label="Γ Gamma" value={fmtNum(t.netGammaUsd, 4)} />
      <MetricCard label="Θ Theta" value={fmtUsd(t.netThetaUsd)} />
      <MetricCard label="V Vega" value={fmtUsd(t.netVegaUsd)} />
      <MetricCard
        label={tr('unrealizedPnl')}
        value={fmtUsd(t.unrealizedPnlUsd)}
        tone={toneClass(t.unrealizedPnlUsd)}
      />
    </div>
  );
}

function ChallengeMetrics({ metrics }: { metrics: PortfolioMetrics }) {
  const t = useT(messages);
  const unrealized = metrics.totals.unrealizedPnlUsd;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>{t('challengeMetrics')}</div>
      <div className={styles.challengeRow}>
        <div>
          <div className={styles.challengeLabel}>{t('profitTarget')}</div>
          <div className={styles.challengeValue}>10%</div>
        </div>
        <div>
          <div className={styles.challengeLabel}>{t('drawdownFloor')}</div>
          <div className={styles.challengeValue}>80%</div>
        </div>
        <div>
          <div className={styles.challengeLabel}>{t('profitSplit')}</div>
          <div className={styles.challengeValue}>80%</div>
        </div>
        <div>
          <div className={styles.challengeLabel}>{t('livePnl')}</div>
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
