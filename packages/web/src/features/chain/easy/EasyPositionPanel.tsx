import type { Leg, StrategyMetrics } from '@features/architect';
import { fmtUsd } from '@lib/format';
import { describeLeg, describeStrategy, legTitle } from './easy-explain';
import styles from './EasyChain.module.css';

interface EasyPositionPanelProps {
  underlying: string;
  legs: Leg[];
  metrics: StrategyMetrics | null;
  strategyName: string;
  chance: number | null;
  mixedExpiries: boolean;
  notice: string | null;
  onQuantity: (leg: Leg, quantity: number) => void;
  onFlip: (leg: Leg) => void;
  onRemove: (leg: Leg) => void;
  onClear: () => void;
  onOpenBuilder: () => void;
}

function fmtBound(v: number | null, unbounded: string): string {
  return v == null ? unbounded : fmtUsd(Math.abs(v));
}

export default function EasyPositionPanel({
  underlying,
  legs,
  metrics,
  strategyName,
  chance,
  mixedExpiries,
  notice,
  onQuantity,
  onFlip,
  onRemove,
  onClear,
  onOpenBuilder,
}: EasyPositionPanelProps) {
  if (legs.length === 0) {
    return (
      <div className={styles.panel}>
        {notice && <div className={styles.notice}>{notice}</div>}
        <ol className={styles.steps}>
          <li>
            <b>Pick a direction.</b> Use the <span data-side="up">▲ UP</span> list if you think{' '}
            {underlying} will rise and the <span data-side="down">▼ DOWN</span> list if you think
            it will fall.
          </li>
          <li>
            <b>Pick a target price.</b> Targets further away are cheaper, but less likely to pay.{' '}
            <em>Odds</em> is the market's estimate of the chance it pays out.
          </li>
          <li>
            <b>Drag it onto the chart.</b> Green shows where you win at expiry and red where you
            lose. Combine several options to shape the trade.
          </li>
        </ol>
      </div>
    );
  }

  const debit = metrics ? -metrics.netDebit : 0;
  const maxLossUnbounded = metrics != null && metrics.maxLoss == null;

  return (
    <div className={styles.panel}>
      {notice && <div className={styles.notice}>{notice}</div>}

      <div className={styles.summary}>
        <div className={styles.summaryHead}>
          <div className={styles.strategyName}>{strategyName}</div>
          <div className={styles.strategyBlurb}>{describeStrategy(strategyName)}</div>
        </div>
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <span>{debit >= 0 ? 'You pay now' : 'You receive now'}</span>
            <b>{fmtUsd(Math.abs(debit)) === '–' ? '$0' : fmtUsd(Math.abs(debit))}</b>
          </div>
          <div className={styles.kpi} data-tone="profit">
            <span>Most you can win</span>
            <b>{fmtBound(metrics?.maxProfit ?? null, 'Unlimited')}</b>
          </div>
          <div className={styles.kpi} data-tone="loss" data-alert={maxLossUnbounded}>
            <span>Most you can lose</span>
            <b>{fmtBound(metrics?.maxLoss ?? null, 'Unlimited ⚠')}</b>
          </div>
          <div className={styles.kpi}>
            <span>Breakeven</span>
            <b>
              {metrics && metrics.breakevens.length > 0
                ? metrics.breakevens.map((b) => fmtUsd(b)).join(' / ')
                : '–'}
            </b>
          </div>
          <div className={styles.kpi}>
            <span title="Rough market-implied estimate; it assumes one flat volatility">
              Chance of profit
            </span>
            <b>{chance != null ? `~${Math.round(chance * 100)}%` : '–'}</b>
          </div>
        </div>
      </div>

      {mixedExpiries && (
        <div className={styles.notice}>
          This trade mixes expiry dates, and the chart treats every option as if it expires at the
          same time. Open it in Builder for an accurate view.
        </div>
      )}
      {maxLossUnbounded && (
        <div className={styles.notice} data-tone="loss">
          Selling options without a protective option can lose more than you collect. Consider
          buying a further-out option on the same side to cap the risk.
        </div>
      )}

      <ul className={styles.legs}>
        {legs.map((leg) => (
          <li key={leg.id} className={styles.leg} data-side={leg.type === 'call' ? 'up' : 'down'}>
            <div className={styles.legTop}>
              <span className={styles.legTitle} data-direction={leg.direction}>
                {legTitle(leg)}
              </span>
              <span className={styles.legMeta}>
                {fmtUsd(leg.entryPrice)} each · {leg.venue}
              </span>
              <span className={styles.qty}>
                <button
                  type="button"
                  onClick={() => onQuantity(leg, leg.quantity - 1)}
                  disabled={leg.quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <b>{leg.quantity}</b>
                <button
                  type="button"
                  onClick={() => onQuantity(leg, leg.quantity + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </span>
              <button
                type="button"
                className={styles.flipBtn}
                onClick={() => onFlip(leg)}
                title={leg.direction === 'buy' ? 'Switch to sell' : 'Switch to buy'}
              >
                {leg.direction === 'buy' ? '→ sell' : '→ buy'}
              </button>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => onRemove(leg)}
                aria-label="Remove option"
              >
                ✕
              </button>
            </div>
            <div className={styles.legText}>{describeLeg(leg, underlying)}</div>
          </li>
        ))}
      </ul>

      <div className={styles.panelActions}>
        <button type="button" className={styles.ghostBtn} onClick={onClear}>
          Clear
        </button>
        <button type="button" className={styles.primaryBtn} onClick={onOpenBuilder}>
          Open in Builder to trade →
        </button>
      </div>
    </div>
  );
}
