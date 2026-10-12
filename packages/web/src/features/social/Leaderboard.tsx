import { EmptyState, Spinner } from '@components/ui';
import { fmtUsd } from '@lib/format';
import type { LeaderboardPeriod } from '@oggregator/protocol';
import { useState } from 'react';

import { useLeaderboard } from './hooks/queries';
import styles from './Leaderboard.module.css';

const PERIODS: ReadonlyArray<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'all', label: 'All time' },
  { id: '30d', label: '30D' },
  { id: '7d', label: '7D' },
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
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const { data, isLoading, isError } = useLeaderboard(period);

  return (
    <section className={styles.board}>
      <header className={styles.header}>
        <h2 className={styles.title}>Leaderboard</h2>
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
              {p.label}
            </button>
          ))}
        </div>
        {data && (
          <span className={styles.updated}>
            Paper accounts · updated{' '}
            {new Date(data.generatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </header>

      <div className={styles.tableWrap}>
        {isLoading ? (
          <Spinner size="md" label="Loading leaderboard…" />
        ) : isError ? (
          <EmptyState title="Leaderboard unavailable" detail="Try again in a moment." />
        ) : !data || data.entries.length === 0 ? (
          <EmptyState
            title="No ranked traders yet"
            detail={
              period === 'all'
                ? 'Join above to be the first. Click any trader to watch their book live.'
                : 'Period returns build from daily equity snapshots taken at 00:05 UTC.'
            }
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.rank}>#</th>
                <th>Trader</th>
                <th className={styles.num}>Return</th>
                <th className={styles.num}>PnL</th>
                <th className={styles.num}>Equity</th>
                <th className={styles.num}>Open</th>
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
                  <td className={styles.trader}>
                    <button
                      className={styles.traderBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(entry.handle);
                      }}
                    >
                      @{entry.handle}
                    </button>
                    {entry.isMe && <span className={styles.youTag}>you</span>}
                  </td>
                  <td className={styles.num} data-tone={tone(entry.returnPct)}>
                    {fmtReturn(entry.returnPct)}
                  </td>
                  <td className={styles.num} data-tone={tone(entry.pnlUsd)}>
                    {fmtSignedUsd(entry.pnlUsd)}
                  </td>
                  <td className={styles.num}>{fmtUsd(entry.equityUsd)}</td>
                  <td className={styles.num}>
                    {entry.openPositions}
                    {entry.unmarkedPositions > 0 && (
                      <span
                        className={styles.unmarked}
                        title={`${entry.unmarkedPositions} leg(s) without a live mark, valued at entry price`}
                      >
                        *
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
