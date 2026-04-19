import { useOrders, usePnl, usePositions } from './hooks/queries';
import { fmtUsd } from '@lib/format';
import styles from './TradingView.module.css';

export default function TradingView() {
  const { data: positions } = usePositions();
  const { data: pnl } = usePnl();
  const { data: ordersData } = useOrders(50);

  const openPositions = positions?.positions ?? [];
  const orders = ordersData?.orders ?? [];

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <HeaderStat label="Equity" value={fmtUsd(pnl?.equityUsd ?? null)} />
        <HeaderStat label="Cash" value={fmtUsd(pnl?.cashUsd ?? null)} />
        <HeaderStat
          label="Realized PnL"
          value={fmtUsd(pnl?.realizedUsd ?? null)}
          tone={tone(pnl?.realizedUsd)}
        />
        <HeaderStat
          label="Unrealized PnL"
          value={fmtUsd(pnl?.unrealizedUsd ?? null)}
          tone={tone(pnl?.unrealizedUsd)}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>Open positions</div>
        {openPositions.length === 0 ? (
          <div className={styles.empty}>
            No open positions. Build a strategy in the Builder tab and click{' '}
            <b>Send to paper</b>.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className={styles.rightAlign}>Qty</th>
                <th className={styles.rightAlign}>Avg entry</th>
                <th className={styles.rightAlign}>Mark</th>
                <th className={styles.rightAlign}>Unrealized</th>
                <th className={styles.rightAlign}>Realized</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map((p) => {
                const symbol = `${p.underlying} ${p.expiry} ${p.strike} ${p.optionRight.toUpperCase()}`;
                return (
                  <tr key={symbol}>
                    <td>{symbol}</td>
                    <td className={styles.rightAlign}>{p.netQuantity}</td>
                    <td className={styles.rightAlign}>{fmtUsd(p.avgEntryPriceUsd)}</td>
                    <td className={styles.rightAlign}>{fmtUsd(p.markPriceUsd)}</td>
                    <td
                      className={`${styles.rightAlign} ${
                        tone(p.unrealizedPnlUsd) === 'positive'
                          ? styles.positive
                          : tone(p.unrealizedPnlUsd) === 'negative'
                            ? styles.negative
                            : ''
                      }`}
                    >
                      {fmtUsd(p.unrealizedPnlUsd)}
                    </td>
                    <td className={styles.rightAlign}>{fmtUsd(p.realizedPnlUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>Orders</div>
        {orders.length === 0 ? (
          <div className={styles.empty}>No orders yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Legs</th>
                <th className={styles.rightAlign}>Debit</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{new Date(o.submittedAt).toLocaleTimeString()}</td>
                  <td>{o.status}</td>
                  <td>
                    {o.legs
                      .map(
                        (l) =>
                          `${l.side === 'buy' ? '+' : '-'}${l.quantity} ${l.strike}${l.optionRight === 'call' ? 'C' : 'P'}`,
                      )
                      .join(' / ')}
                  </td>
                  <td className={styles.rightAlign}>{fmtUsd(o.totalDebitUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone: toneVal,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div>
      <div className={styles.headerLabel}>{label}</div>
      <div
        className={`${styles.headerValue} ${
          toneVal === 'positive'
            ? styles.positive
            : toneVal === 'negative'
              ? styles.negative
              : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function tone(v: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (v == null || v === 0) return 'neutral';
  return v > 0 ? 'positive' : 'negative';
}
