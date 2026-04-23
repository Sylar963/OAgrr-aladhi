import { Suspense, lazy } from 'react';

import { Spinner } from '@components/ui';
import VolSmile from './VolSmile';
import AtmTermStructure from './AtmTermStructure';
import RealizedVsImplied from './RealizedVsImplied';
import IvRankPanel from './IvRankPanel';
import SkewHistory from './SkewHistory';
import styles from './SurfaceView.module.css';

const VolSurface3D = lazy(() => import('./VolSurface3D'));

export default function SurfaceView() {
  return (
    <div className={styles.view}>
      <div className={styles.body}>
        <div className={styles.surfaceRow}>
          <div className={styles.surfacePanel}>
            <Suspense fallback={<Spinner size="md" label="Loading 3D surface..." />}>
              <VolSurface3D defaultUnderlying="BTC" />
            </Suspense>
          </div>
          <div className={styles.surfacePanel}>
            <Suspense fallback={<Spinner size="md" label="Loading 3D surface..." />}>
              <VolSurface3D defaultUnderlying="ETH" />
            </Suspense>
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <IvRankPanel underlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <IvRankPanel underlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <SkewHistory underlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <SkewHistory underlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <VolSmile defaultUnderlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <VolSmile defaultUnderlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <AtmTermStructure defaultUnderlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <AtmTermStructure defaultUnderlying="ETH" />
          </div>
        </div>

        <div className={styles.chartsRow}>
          <div className={styles.chartPanel}>
            <RealizedVsImplied defaultUnderlying="BTC" />
          </div>
          <div className={styles.chartPanel}>
            <RealizedVsImplied defaultUnderlying="ETH" />
          </div>
        </div>
      </div>
    </div>
  );
}
