import { Spinner } from '@components/ui';
import { useMarket } from '@stores/app-store';
import { lazy, type ReactNode, Suspense } from 'react';

import AtmTermStructure from './AtmTermStructure';
import IvRankPanel from './IvRankPanel';
import RealizedVsImplied from './RealizedVsImplied';
import SkewHistory from './SkewHistory';
import VolSmile from './VolSmile';

import styles from './SurfaceCards.module.css';

const VolSurface3D = lazy(() => import('./VolSurface3D'));

function Card({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

// These panels keep their own ticker picker, seeded once from their default, so a new tab ticker
// has to remount them.
export function VolSmileWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <Card>
      <VolSmile key={underlying} defaultUnderlying={underlying} />
    </Card>
  );
}

export function AtmTermWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <Card>
      <AtmTermStructure key={underlying} defaultUnderlying={underlying} />
    </Card>
  );
}

export function RealizedVsImpliedWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <Card>
      <RealizedVsImplied key={underlying} defaultUnderlying={underlying} />
    </Card>
  );
}

export function Surface3DWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <Card>
      <Suspense fallback={<Spinner size="md" />}>
        <VolSurface3D key={underlying} defaultUnderlying={underlying} />
      </Suspense>
    </Card>
  );
}

export function IvRankWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <Card>
      <IvRankPanel underlying={underlying} />
    </Card>
  );
}

export function SkewHistoryWidget() {
  const underlying = useMarket((m) => m.underlying);
  return (
    <Card>
      <SkewHistory underlying={underlying} />
    </Card>
  );
}
