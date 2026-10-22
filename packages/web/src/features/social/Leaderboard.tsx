import { EmptyState, Spinner } from '@components/ui';
import { fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import type { LeaderboardPeriod } from '@oggregator/protocol';
import { useState } from 'react';

import { useLeaderboard } from './hooks/queries';
import { socialMessages } from './i18n';
import styles from './Leaderboard.module.css';
import VenueTag from './VenueTag';

const messages = defineMessages(
  {
    title: 'Leaderboard',
    periodAll: 'All time',
    period30d: '30D',
    period7d: '7D',
    updated: 'Venue account equity · updated',
    loading: 'Loading leaderboard…',
    unavailable: 'Leaderboard unavailable',
    emptyTitle: 'No ranked traders yet',
    emptyDetail:
      'Members appear once their chosen venue account is connected and reports equity history.',
    trader: 'Trader',
    venue: 'Venue',
    return: 'Return',
    pnl: 'PnL',
    equity: 'Equity',
    open: 'Open',
    sharingSince: 'Sharing since {date}',
    measuredFrom: 'Measured from {date}',
    asOf: 'As of {date}',
  },
  {
    title: 'Ranking',
    periodAll: 'Histórico',
    period30d: '30D',
    period7d: '7D',
    updated: 'Equity de la cuenta del exchange · actualizado',
    loading: 'Cargando ranking…',
    unavailable: 'Ranking no disponible',
    emptyTitle: 'Aún no hay traders en el ranking',
    emptyDetail:
      'Los miembros aparecen cuando la cuenta del exchange elegida está conectada y reporta historial de equity.',
    trader: 'Trader',
    venue: 'Exchange',
    return: 'Retorno',
    pnl: 'PnL',
    equity: 'Equity',
    open: 'Abiertas',
    sharingSince: 'Comparte desde {date}',
    measuredFrom: 'Medido desde {date}',
    asOf: 'Al {date}',
  },
);

const PERIODS: ReadonlyArray<{ id: LeaderboardPeriod; label: keyof typeof messages.en }> = [
  { id: 'all', label: 'periodAll' },
  { id: '30d', label: 'period30d' },
  { id: '7d', label: 'period7d' },
];

function fmtReturn(fraction: number): string {
  const pct = fraction * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtSignedUsd(value: number): string {
  if (Math.abs(value) < 0.005) return '$0';
  return `${value > 0 ? '+' : ''}${fmtUsd(value)}`;
}

function tone(value: number): 'up' | 'down' | 'flat' {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

interface LeaderboardProps {
  selectedHandle: string | null;
  onSelect: (handle: string) => void;
}

export default function Leaderboard({ selectedHandle, onSelect }: LeaderboardProps) {
  const t = useT(messages);
  const ts = useT(socialMessages);
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const { data, isLoading, isError } = useLeaderboard(period);

  return (
    <section className={styles.board}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <div className={styles.periods} role="tablist">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === period}
              className={styles.periodBtn}
              data-active={p.id === period}
              onClick={() => setPeriod(p.id)}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
        {data && (
          <span className={styles.updated}>
            {t('updated')}{' '}
            {new Date(data.generatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </header>

      <div className={styles.tableWrap}>
        {isLoading ? (
          <Spinner size="md" label={t('loading')} />
        ) : isError ? (
          <EmptyState title={t('unavailable')} detail={ts('tryAgain')} />
        ) : !data || data.entries.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            detail={t('emptyDetail')}
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.rank}>#</th>
                <th>{t('trader')}</th>
                <th>{t('venue')}</th>
                <th className={styles.num}>{t('return')}</th>
                <th className={styles.num}>{t('pnl')}</th>
                <th className={styles.num}>{t('equity')}</th>
                <th className={styles.num}>{t('open')}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr
                  key={entry.handle}
                  data-me={entry.isMe}
                  data-selected={entry.handle === selectedHandle}
                  className={styles.row}
                  onClick={() => onSelect(entry.handle)}
                >
                  <td
                    className={styles.rank}
                    data-podium={entry.rank <= 3 ? entry.rank : undefined}
                  >
                    {entry.rank}
                  </td>
                  <td
                    className={styles.trader}
                    title={t('sharingSince', {
                      date: new Date(entry.sharingSince).toLocaleDateString(),
                    })}
                  >
                    <button
                      className={styles.traderBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(entry.handle);
                      }}
                    >
                      @{entry.handle}
                    </button>
                    {entry.isMe && <span className={styles.youTag}>{ts('you')}</span>}
                  </td>
                  <td>
                    <VenueTag venue={entry.venue} />
                  </td>
                  <td
                    className={styles.num}
                    data-tone={tone(entry.returnPct)}
                    title={t('measuredFrom', { date: new Date(entry.since).toLocaleDateString() })}
                  >
                    {fmtReturn(entry.returnPct)}
                  </td>
                  <td className={styles.num} data-tone={tone(entry.pnlUsd)}>
                    {fmtSignedUsd(entry.pnlUsd)}
                  </td>
                  <td
                    className={styles.num}
                    title={t('asOf', { date: new Date(entry.equityAsOf).toLocaleDateString() })}
                  >
                    {fmtUsd(entry.equityUsd)}
                  </td>
                  <td className={styles.num}>{entry.openPositions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
