import { fmtIv, fmtPct, fmtUsdCompact } from '@lib/format';
import { fmtPercentile, fmtVolPts, fmtZ } from '@lib/vol-richness';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';

import styles from './AlphaContextStrip.module.css';

interface AlphaContextStripProps {
  context: AlphaMarketContextResponse | null;
  strategy:
    | 'call-credit'
    | 'put-credit'
    | 'call-debit'
    | 'put-debit'
    | 'long-call'
    | 'long-put'
    | 'short-straddle';
  loading: boolean;
}

function setupLabel(
  context: AlphaMarketContextResponse | null,
  strategy: AlphaContextStripProps['strategy'],
): string {
  if (context == null) return 'UNAVAILABLE';
  if (strategy.endsWith('debit')) return 'CHECK DIRECTION + PRICE';
  if (strategy === 'long-call') return context.setup.longCall.toUpperCase();
  if (strategy === 'long-put') return context.setup.protectivePut.toUpperCase();
  return context.setup.creditSpread.toUpperCase();
}

export default function AlphaContextStrip({ context, strategy, loading }: AlphaContextStripProps) {
  const move7d = context?.expectedMoves.find((move) => move.days === 7) ?? null;
  const vrp = context?.realized.vrp30d;
  const richness30d = context?.richness?.tenors['30d'] ?? null;
  const richness7d = context?.richness?.tenors['7d'] ?? null;
  const stateSource = context?.volatility.stateSource;
  return (
    <div className={styles.strip} aria-label="Alpha market context">
      <div
        className={styles.setup}
        data-fit={setupLabel(context, strategy).toLowerCase()}
        title="Broad market heuristic, not a trade verdict. Past realized volatility is not a forecast. An unfavorable selling setup does not imply buying is profitable."
      >
        <span>Setup heuristic ⓘ</span>
        <strong>{loading ? 'LOADING' : setupLabel(context, strategy)}</strong>
      </div>
      <div>
        <span>ATM IV 30D</span>
        <strong>{fmtIv(context?.volatility.atmIv30d ?? null)}</strong>
        <small
          title="Context only: IV against its own past (90-day window and 52-week DVOL), not against expected realized volatility."
        >
          90d {fmtPercentile(context?.volatility.ivPercentile30d)} · 1y{' '}
          {fmtPercentile(richness30d?.level.percentile1y)}
        </small>
      </div>
      <div
        title={`IV − matched-horizon realized forecast − usual premium (median IV − later RV). ±${((context?.richness?.fairBand ?? 0.02) * 100).toFixed(0)} pts reads as fair; thresholds are untested on BTC. Volatility state source: ${stateSource ?? 'unavailable'}.`}
      >
        <span>IV vs FCST 30D / 7D</span>
        <strong>
          {fmtVolPts(richness30d?.excessPremium)} / {fmtVolPts(richness7d?.excessPremium)}
        </strong>
        <small>
          {richness30d?.state.toUpperCase() ?? 'UNAVAILABLE'} · {fmtZ(richness30d?.excessHistory.zScore)}{' '}
          hist · 7D {fmtZ(richness7d?.intraday.zScore24h)} 24h
        </small>
      </div>
      <div>
        <span>RV 7D / 30D</span>
        <strong>
          {fmtIv(context?.realized.rv7d ?? null)} / {fmtIv(context?.realized.rv30d ?? null)}
        </strong>
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
        <small>
          {context?.sources.ivScope === 'mixed' ? '30D DVOL + venue IV' : 'cross-venue IV'}
        </small>
      </div>
    </div>
  );
}
