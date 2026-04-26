// packages/web/src/features/analytics/oi-by-strike/OiByStrikeCard.tsx
import { useMemo, useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency } from '@shared/common';

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
  return c === 'BTC' || c === 'ETH';
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
              title={v2Available ? undefined : 'V2 supports BTC/ETH only'}
            >
              V2
            </button>
          </div>
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
