import { Spinner } from '@components/ui';
import { fmtUsd, formatExpiry } from '@lib/format';
import type { PublicTraderDto } from '@oggregator/protocol';

import EquityChart from './EquityChart';
import OpenPositions from './OpenPositions';
import styles from './TraderPanel.module.css';
import VenueTag from './VenueTag';

interface TraderPanelProps {
  handle: string;
  trader: PublicTraderDto | null;
  unavailable: 'left' | 'waiting' | null;
  onClose: () => void;
}

function signedUsd(value: number | null): string {
  if (value == null) return '–';
  if (Math.abs(value) < 0.005) return '$0';
  return `${value > 0 ? '+' : ''}${fmtUsd(value)}`;
}

function tone(value: number | null): 'up' | 'down' | 'flat' {
  if (value == null || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function TraderPanel({ handle, trader, unavailable, onClose }: TraderPanelProps) {
  return (
    <section className={styles.panel} aria-label={`@${handle} book`}>
      <header className={styles.header}>
        <h3 className={styles.handle}>@{trader?.handle ?? handle}</h3>
        {trader?.isMe && <span className={styles.youTag}>you</span>}
        {trader && <VenueTag venue={trader.venue} />}
        {trader && (
          <span className={styles.live}>
            <span className={styles.liveDot} />
            live
          </span>
        )}
        <button className={styles.close} onClick={onClose} aria-label="Close trader">
          ×
        </button>
      </header>

      {unavailable === 'left' ? (
        <p className={styles.empty}>@{handle} is no longer sharing on the leaderboard.</p>
      ) : unavailable === 'waiting' ? (
        <p className={styles.empty}>
          Waiting for @{handle}'s venue account to connect. Their book streams again once it does.
        </p>
      ) : !trader ? (
        <Spinner size="md" label={`Loading @${handle}…`} />
      ) : (
        <div className={styles.body}>
          <div className={styles.stats}>
            <Stat
              label={`Equity · ${fmtDate(trader.equityAsOf)}`}
              value={fmtUsd(trader.equityUsd)}
            />
            <Stat
              label="PnL since start"
              value={signedUsd(trader.pnlUsd)}
              tone={tone(trader.pnlUsd)}
            />
            <Stat
              label="Return"
              value={`${trader.returnPct > 0 ? '+' : ''}${(trader.returnPct * 100).toFixed(2)}%`}
              tone={tone(trader.returnPct)}
            />
            <Stat label="Since" value={fmtDate(trader.startedAt)} />
          </div>

          <EquityChart
            points={trader.equityHistory}
            baselineUsd={
              trader.equityHistory.find((point) => point.equityUsd > 0)?.equityUsd ??
              trader.equityUsd
            }
          />

          <h4 className={styles.sectionTitle}>Open positions · {trader.openPositions.length}</h4>
          {trader.openPositions.length === 0 ? (
            <p className={styles.empty}>No open positions.</p>
          ) : (
            <OpenPositions positions={trader.openPositions} />
          )}

          <h4 className={styles.sectionTitle}>Closed trades · {trader.closedTrades.length}</h4>
          {!trader.closedTradesAvailable ? (
            <p className={styles.empty}>
              <VenueTag venue={trader.venue} /> does not report fill history.
            </p>
          ) : trader.closedTrades.length === 0 ? (
            <p className={styles.empty}>No closing fills yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Side</th>
                    <th className={styles.num}>Qty</th>
                    <th className={styles.num}>Price</th>
                    <th>Closed</th>
                    <th className={styles.num}>Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {trader.closedTrades.map((trade) => (
                    <tr key={trade.id}>
                      <td>
                        {trade.underlying} {formatExpiry(trade.expiry)}{' '}
                        {trade.strike.toLocaleString()}
                        <span className={styles.right} data-right={trade.optionRight}>
                          {trade.optionRight === 'call' ? 'C' : 'P'}
                        </span>
                      </td>
                      <td>{trade.direction}</td>
                      <td className={styles.num}>{trade.amount}</td>
                      <td className={styles.num}>{fmtUsd(trade.priceUsd)}</td>
                      <td>{fmtDate(trade.closedAt)}</td>
                      <td className={styles.num} data-tone={tone(trade.realizedPnlUsd)}>
                        {signedUsd(trade.realizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} data-tone={tone}>
        {value}
      </span>
    </div>
  );
}
