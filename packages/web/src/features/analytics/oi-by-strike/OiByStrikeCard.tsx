// packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.tsx
import { useMemo, useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency } from '@shared/common';

import InfoTip from '@components/ui/InfoTip';

import styles from '../AnalyticsView.module.css';
import OiByStrikeChart from './OiByStrikeChart';
import OiHeatmap from './OiHeatmap';
import { computeMaxPain } from './oi-heatmap-utils';

type Version = 'v1' | 'v2';

interface Props {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  currency: string;
}

function isHeatmapCurrency(c: string): c is SpotCandleCurrency {
  return c === 'BTC' || c === 'ETH' || c === 'HYPE';
}

export default function OiByStrikeCard({ chains, spotPrice, currency }: Props) {
  const [version, setVersion] = useState<Version>('v1');
  const maxPain = useMemo(() => computeMaxPain(chains), [chains]);
  const v2Available = isHeatmapCurrency(currency);
  const effectiveVersion: Version = version === 'v2' && v2Available ? 'v2' : 'v1';

  return (
    <div className={`${styles.card} ${styles.oiCardRelative}`}>
      <div className={styles.oiHeader}>
        <div className={styles.cardTitle}>Open Interest by Strike</div>
        <div className={styles.oiControls}>
          <div className={styles.oiToggle}>
            <button
              className={styles.oiToggleBtn}
              data-active={effectiveVersion === 'v1' || undefined}
              onClick={() => setVersion('v1')}
            >
              V1
            </button>
            <button
              className={styles.oiToggleBtn}
              data-active={effectiveVersion === 'v2' || undefined}
              onClick={() => v2Available && setVersion('v2')}
              disabled={!v2Available}
              title={v2Available ? undefined : 'V2 supports BTC/ETH/HYPE only'}
            >
              V2
            </button>
          </div>
          {effectiveVersion === 'v2' && (
            <InfoTip label="V2 OI Heatmap" title="V2 — EM-Anchored OI Heatmap" align="end">
              <p>
                <strong>OI profile:</strong> horizontal bars on the right show
                open interest at each significant strike, in contracts or USD
                notional, split by calls (green) and puts (red), or filtered to
                one side. Only expiries enabled in the legend count; click an
                expiry to hide it. The yellow dashed <strong>MP</strong> line
                is max pain for the visible expiries.
              </p>
              <p>
                <strong>EM cone:</strong> one expiry at a time, picked in the
                <strong> Cone</strong> menu. It defaults to the nearest expiry
                that has an expected move (EM), and hiding expiries in the
                legend doesn't change it. The fan opens from spot at
                <em> now</em> to <strong>spot ± 1σ</strong> (dense) and
                <strong> spot ± 2σ</strong> (faint) at that expiry. EM is the
                ATM straddle mid ×1.25 (Brenner–Subrahmanyam). If the best
                bid/ask is wider than 5% of mid, or the straddle EM is more
                than 50% away from the ATM-IV estimate, the IV estimate is used
                instead. Those expiries get a dashed cone outline and an
                <code> ·iv </code> tag in the legend.
              </p>
              <p>
                <strong>Significance toggle (A3 / A4):</strong> both look only
                at strikes inside each expiry's ±2σ band and combine the
                results across visible expiries.
                <br />
                <strong>A3</strong> (default): the 5 strikes with the most OI
                per expiry.
                <br />
                <strong>A4 BETA</strong>: dealer-gamma levels. These are
                strikes whose |GEX| is above mean + 1.5σ for that expiry.
                Bars and labels are coloured by net dealer gamma across visible
                expiries: green = dealers long gamma (price tends to pin), red =
                short gamma (moves tend to accelerate). A4 also draws the γ
                flip and the call/put walls. GEX uses tracked dealer inventory
                where it's available; otherwise it assumes dealers are long
                calls and short puts. The <strong>%</strong> on each label is
                the share of that strike's gamma whose dealer side came from
                observed taker flow. Faded bars rely more on the long-calls /
                short-puts assumption. Block trades aren't counted in this
                share because their aggressor side is ambiguous.
              </p>
              <p>
                <strong>Block bubbles:</strong> each bubble is block-trade
                volume at one strike in one candle. Size and opacity scale with
                the amount traded, and colour shows whether calls or puts
                dominate. They use the same contracts/notional, side, and
                legend filters as the bars.
              </p>
              <p>
                <strong>Timeframe tabs (1d / 3d / 7d / 30d / 90d):</strong>
                5m candles on 1d/3d, 30m on 7d, 1h on 30d, 4h on 90d. The chart
                opens from one window before now to one window after, leaving
                room on the right for the cone. About 3 windows of history are
                loaded, so you can scroll left.
              </p>
              <p>
                The bars are a <strong>live snapshot</strong> of current OI.
                Hover a strike to see where it sits against each expiry's ±1σ
                and ±2σ, its OI by venue and expiry with EM badges, and a
                session OI sparkline. The sparkline lives in memory only and
                clears on refresh. Hover a bubble to see its block-trade
                details. BTC, ETH, and HYPE only.
              </p>
            </InfoTip>
          )}
          {maxPain != null && (
            <div className={styles.maxPainBadge}>
              Max Pain: <strong>{maxPain.toLocaleString()}</strong>
            </div>
          )}
        </div>
      </div>

      {effectiveVersion === 'v1' || !v2Available
        ? <OiByStrikeChart chains={chains} spotPrice={spotPrice} />
        : <OiHeatmap chains={chains} spotPrice={spotPrice} currency={currency} />}
    </div>
  );
}
