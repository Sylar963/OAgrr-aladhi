import { Spinner } from '@components/ui';
import { fmtUsd, formatExpiry } from '@lib/format';
import type { PublicTraderDto } from '@oggregator/protocol';

import EquityChart from './EquityChart';
import styles from './TraderPanel.module.css';

interface TraderPanelProps {
  handle: string;
  trader: PublicTraderDto | null;
  unavailable: boolean;
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

      {unavailable ? (
        <p className={styles.empty}>@{handle} is no longer sharing on the leaderboard.</p>
      ) : !trader ? (
        <Spinner size="md" label={`Loading @${handle}…`} />
      ) : (
        <div className={styles.body}>
          <div className={styles.stats}>
            <Stat label="Equity" value={fmtUsd(trader.equityUsd)} />
            <Stat
              label="All-time PnL"
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

          <EquityChart points={trader.equityHistory} baselineUsd={trader.initialCashUsd} />

          <h4 className={styles.sectionTitle}>Open positions · {trader.openPositions.length}</h4>
          {trader.openPositions.length === 0 ? (
            <p className={styles.empty}>No open positions.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th className={styles.num}>Qty</th>
                    <th className={styles.num}>Entry</th>
                    <th className={styles.num}>Mark</th>
                    <th className={styles.num}>uPnL</th>
                  </tr>
                </thead>
                <tbody>
                  {trader.openPositions.map((pos) => (
                    <tr key={`${pos.underlying}|${pos.expiry}|${pos.strike}|${pos.optionRight}`}>
                      <td>
                        {pos.underlying} {formatExpiry(pos.expiry)} {pos.strike.toLocaleString()}
                        <span className={styles.right} data-right={pos.optionRight}>
                          {pos.optionRight === 'call' ? 'C' : 'P'}
                        </span>
                      </td>
                      <td className={styles.num} data-tone={tone(pos.netQuantity)}>
                        {pos.netQuantity > 0 ? '+' : ''}
                        {pos.netQuantity}
                      </td>
                      <td className={styles.num}>{fmtUsd(pos.avgEntryPriceUsd)}</td>
                      <td className={styles.num}>{fmtUsd(pos.markPriceUsd)}</td>
                      <td className={styles.num} data-tone={tone(pos.unrealizedPnlUsd)}>
                        {signedUsd(pos.unrealizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 className={styles.sectionTitle}>Closed trades · {trader.closedTrades.length}</h4>
          {trader.closedTrades.length === 0 ? (
            <p className={styles.empty}>No closed trades yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Trade</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th className={styles.num}>Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {trader.closedTrades.map((trade) => (
                    <tr key={trade.id}>
                      <td>
                        {trade.underlying} · {trade.label}
                      </td>
                      <td>{fmtDate(trade.openedAt)}</td>
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
