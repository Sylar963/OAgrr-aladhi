import { EmptyState, Spinner } from '@components/ui';
import { fmtUsd } from '@lib/format';
import type { LeaderboardPeriod } from '@oggregator/protocol';
import { useState } from 'react';

import { useLeaderboard } from './hooks/queries';
import styles from './Leaderboard.module.css';
import VenueTag from './VenueTag';

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
            Venue account equity · updated{' '}
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
            detail="Members appear once their chosen venue account is connected and reports equity history."
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.rank}>#</th>
                <th>Trader</th>
                <th>Venue</th>
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
                  <td
                    className={styles.trader}
                    title={`Sharing since ${new Date(entry.sharingSince).toLocaleDateString()}`}
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
                    {entry.isMe && <span className={styles.youTag}>you</span>}
                  </td>
                  <td>
                    <VenueTag venue={entry.venue} />
                  </td>
                  <td
                    className={styles.num}
                    data-tone={tone(entry.returnPct)}
                    title={`Measured from ${new Date(entry.since).toLocaleDateString()}`}
                  >
                    {fmtReturn(entry.returnPct)}
                  </td>
                  <td className={styles.num} data-tone={tone(entry.pnlUsd)}>
                    {fmtSignedUsd(entry.pnlUsd)}
                  </td>
                  <td
                    className={styles.num}
                    title={`As of ${new Date(entry.equityAsOf).toLocaleDateString()}`}
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
