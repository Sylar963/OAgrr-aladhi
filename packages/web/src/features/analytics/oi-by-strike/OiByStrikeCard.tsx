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
                <strong>OI profile:</strong> bars show OI at significant strikes
                (contracts or notional; calls green, puts red). Legend toggles
                expiries. Dashed yellow <strong>MP</strong> = max pain.
              </p>
              <p>
                <strong>EM cone:</strong> one expiry, chosen in
                <strong> Cone</strong> (defaults to nearest). Fans from spot to
                <strong> ±1σ</strong> (dense) and <strong>±2σ</strong> (faint)
                at expiry. EM = ATM straddle mid ×1.25. Falls back to ATM IV when
                the spread exceeds 5% of mid or the straddle deviates over 50%
                from IV — shown as a dashed outline and <code>·iv</code> tag.
              </p>
              <p>
                <strong>A3</strong> (default): top 5 OI strikes per expiry within ±2σ.
                <br />
                <strong>A4 BETA</strong>: strikes within ±2σ whose |GEX| exceeds
                mean + 1.5σ. Green = dealers long gamma (pinning), red = short
                gamma (acceleration). Adds γ flip and call/put walls. Uses tracked
                dealer inventory, else assumes dealers long calls / short puts.
                Label <strong>%</strong> = gamma share signed by observed taker
                flow; faded bars rely on the assumption. Block trades excluded.
              </p>
              <p>
                <strong>Block bubbles:</strong> block-trade volume per strike per
                candle; size scales with volume, colour shows call/put dominance.
              </p>
              <p>
                <strong>Timeframes:</strong> 5m (1d/3d), 30m (7d), 1h (30d), 4h
                (90d); about 3 windows of history to scroll back.
              </p>
              <p>
                Hover a strike for EM zone, venue/expiry breakdown, session
                OI sparkline. BTC, ETH, and HYPE only.
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
