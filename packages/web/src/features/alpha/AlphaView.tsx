import { useState } from 'react';
import { useAppStore } from '@stores/app-store';
import { useOpenPalette } from '@components/layout/palette-context';
import AlphaContextStrip from './AlphaContextStrip';
import LottoScannerPanel from './LottoScannerPanel';
import SpreadDesk from './SpreadDesk';
import { useAlphaMarketContext } from './useAlphaMarketContext';
import styles from './AlphaView.module.css';

export default function AlphaView() {
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const openPalette = useOpenPalette();
  const [strategy, setStrategy] = useState<'spreads' | 'long-call'>('spreads');
  const context = useAlphaMarketContext(underlying);
  return (
    <div className={styles.view}>
      <div className={styles.strategyBar}>
        <button type="button" className={styles.assetButton} onClick={openPalette}>
          <span>ALPHA</span>
          <strong>{underlying}</strong>
        </button>
        <div className={styles.strategyTabs} role="tablist" aria-label="Alpha workspace">
          <button
            type="button"
            role="tab"
            aria-selected={strategy === 'spreads'}
            data-active={strategy === 'spreads'}
            onClick={() => setStrategy('spreads')}
          >
            Spread scanner
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={strategy === 'long-call'}
            data-active={strategy === 'long-call'}
            onClick={() => setStrategy('long-call')}
          >
            Long calls
          </button>
        </div>
        <span className={styles.venueScope}>RESEARCH → REVIEW → VENUE</span>
      </div>
      <AlphaContextStrip
        context={context.data ?? null}
        strategy={strategy}
        loading={context.isLoading}
      />
      <div className={styles.scannerWorkspace}>
        {strategy === 'spreads' ? (
          <SpreadDesk underlying={underlying} />
        ) : (
          <LottoScannerPanel underlying={underlying} venues={activeVenues} />
        )}
      </div>
    </div>
  );
}
