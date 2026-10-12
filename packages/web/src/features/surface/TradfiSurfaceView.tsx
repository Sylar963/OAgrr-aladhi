import { Suspense, lazy } from 'react';

import { Spinner } from '@components/ui';
import AtmTermStructure from './AtmTermStructure';
import RealizedVsImplied from './RealizedVsImplied';
import TradfiIvRankPanel from './TradfiIvRankPanel';
import VolSmile from './VolSmile';
import styles from './SurfaceView.module.css';

const VolSurface3D = lazy(() => import('./VolSurface3D'));

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
