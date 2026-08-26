import type { AlphaMarketContextResponse } from '@oggregator/protocol';

import { fmtIv, fmtPct, fmtUsdCompact } from '@lib/format';

import styles from './AlphaContextStrip.module.css';

interface AlphaContextStripProps {
  context: AlphaMarketContextResponse | null;
  strategy: 'call-credit' | 'put-credit' | 'long-call';
  loading: boolean;
}

function setupLabel(
  context: AlphaMarketContextResponse | null,
  strategy: AlphaContextStripProps['strategy'],
): string {
  if (context == null) return 'UNAVAILABLE';
  return strategy === 'long-call'
    ? context.setup.longCall.toUpperCase()
    : context.setup.creditSpread.toUpperCase();
}

export default function AlphaContextStrip({ context, strategy, loading }: AlphaContextStripProps) {
  const move7d = context?.expectedMoves.find((move) => move.days === 7) ?? null;
  const vrp = context?.realized.vrp30d;
  return (
    <div className={styles.strip} aria-label="Alpha market context">
      <div className={styles.setup} data-fit={setupLabel(context, strategy).toLowerCase()}>
        <span>Setup</span>
        <strong>{loading ? 'LOADING' : setupLabel(context, strategy)}</strong>
      </div>
      <div>
        <span>ATM IV 30D</span>
        <strong>{fmtIv(context?.volatility.atmIv30d ?? null)}</strong>
        <small>{context?.volatility.ivPercentile30d == null ? 'no rank' : `p${context.volatility.ivPercentile30d.toFixed(0)}`}</small>
      </div>
      <div>
        <span>RV 7D / 30D</span>
        <strong>{fmtIv(context?.realized.rv7d ?? null)} / {fmtIv(context?.realized.rv30d ?? null)}</strong>
      </div>
      <div>
        <span>VRP 30D</span>
        <strong>{vrp == null ? '—' : `${(vrp * 100).toFixed(1)}pp`}</strong>
      </div>
      <div>
        <span>7D IMPLIED</span>
        <strong>{fmtPct(move7d?.movePct ?? null, 1)}</strong>
        <small>{fmtUsdCompact(move7d?.moveUsd ?? null)}</small>
      </div>
      <div>
        <span>RANGE</span>
        <strong>{context?.range.state.toUpperCase() ?? '—'}</strong>
        <small>{fmtPct(context?.range.width14dPct ?? null, 1)} / 14d</small>
      </div>
      <div>
        <span>SPOT STATE</span>
        <strong>{context?.spotState.state.replaceAll('-', ' ').toUpperCase() ?? '—'}</strong>
        <small>{context?.sources.ivScope === 'cross-venue' ? 'cross-venue IV' : ''}</small>
      </div>
    </div>
  );
}
