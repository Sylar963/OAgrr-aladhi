import { Spinner } from '@components/ui';
import { useAppStore } from '@stores/app-store';
import { lazy, Suspense } from 'react';
import TradfiChainView from './TradfiChainView';
import TradfiGexView from './TradfiGexView';
import TradfiSectorsView from './TradfiSectorsView';
import TradfiTopBar from './TradfiTopBar';
import styles from './TradfiApp.module.css';

const ArchitectView = lazy(() =>
  import('@features/architect').then((module) => ({ default: module.ArchitectView })),
);
const AlphaView = lazy(() =>
  import('@features/alpha').then((module) => ({ default: module.AlphaView })),
);
const TradfiSurfaceView = lazy(() =>
  import('@features/surface').then((module) => ({ default: module.TradfiSurfaceView })),
);

export default function TradfiApp() {
  const page = useAppStore((s) => s.tradfiPage);

  return (
    <div className={styles.root} data-mode="tradfi">
      <TradfiTopBar />
      <main className={styles.main}>
        {page === 'builder' ? (
          <Suspense fallback={<Spinner size="lg" label="Loading TradFi Builder…" />}>
            <ArchitectView market="tradfi" />
          </Suspense>
        ) : page === 'gex' ? (
          <TradfiGexView />
        ) : page === 'sectors' ? (
          <TradfiSectorsView />
        ) : page === 'vol' ? (
          <Suspense fallback={<Spinner size="lg" label="Loading TradFi Volatility…" />}>
            <TradfiSurfaceView />
          </Suspense>
        ) : page === 'alpha' ? (
          <Suspense fallback={<Spinner size="lg" label="Loading TradFi Alpha…" />}>
            <AlphaView market="tradfi" />
          </Suspense>
        ) : (
          <TradfiChainView />
        )}
      </main>
    </div>
  );
}
