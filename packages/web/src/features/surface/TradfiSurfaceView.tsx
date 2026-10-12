import { Suspense, lazy } from 'react';

import { Spinner } from '@components/ui';
import { useTradfiSelection } from '@features/tradfi';
import AtmTermStructure from './AtmTermStructure';
import { useTradfiIvHistoryUnderlyings } from './queries';
import RealizedVsImplied from './RealizedVsImplied';
import SkewHistory from './SkewHistory';
import TradfiIvRankPanel from './TradfiIvRankPanel';
import VolSmile from './VolSmile';
import styles from './SurfaceView.module.css';

const VolSurface3D = lazy(() => import('./VolSurface3D'));

function TradfiSkewPanel() {
  const { underlying } = useTradfiSelection();
  const { data: recorded } = useTradfiIvHistoryUnderlyings();
  if (recorded?.includes(underlying)) {
    return (
      <div className={`${styles.chartPanel} ${styles.tallChartPanel}`}>
        <SkewHistory underlying={underlying} market="tradfi" />
      </div>
    );
  }
  if (!recorded) return null;
  return (
    <div className={styles.note}>
      Skew history is recorded every 5 minutes during regular hours for {recorded.join(', ')}.
    </div>
  );
}

export default function TradfiSurfaceView() {
  return (
    <div className={styles.view}>
      <div className={styles.body}>
        <div className={styles.surfacePanel}>
          <Suspense fallback={<Spinner size="md" label="Loading 3D surface..." />}>
            <VolSurface3D market="tradfi" />
          </Suspense>
        </div>
        <div className={styles.chartsRow}>
          <div className={`${styles.chartPanel} ${styles.ivRankPanel}`}>
            <TradfiIvRankPanel />
          </div>
          <div className={styles.chartPanel}>
            <RealizedVsImplied market="tradfi" />
          </div>
        </div>
        <TradfiSkewPanel />
        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <VolSmile market="tradfi" />
          </div>
          <div className={styles.chartPanel}>
            <AtmTermStructure market="tradfi" />
          </div>
        </div>
      </div>
    </div>
  );
}
