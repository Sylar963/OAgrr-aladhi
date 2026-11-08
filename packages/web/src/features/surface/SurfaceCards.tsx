import { Spinner } from '@components/ui';
import { useMarket } from '@stores/app-store';
import { lazy, type ReactNode, Suspense } from 'react';

import AtmTermStructure from './AtmTermStructure';
import IvRankPanel from './IvRankPanel';
import RealizedVsImplied from './RealizedVsImplied';
import SkewHistory from './SkewHistory';
import styles from './SurfaceCards.module.css';
import VolSmile from './VolSmile';

const VolSurface3D = lazy(() => import('./VolSurface3D'));

function Card({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

// These panels keep their own ticker picker, seeded once from their default, so a new tab ticker
// has to remount them.
export function VolSmileWidget({ underlying: pinned }: { underlying?: string } = {}) {
  const selected = useMarket((m) => m.underlying);
  const underlying = pinned ?? selected;
  return (
    <Card>
      <VolSmile key={underlying} defaultUnderlying={underlying} />
    </Card>
  );
}

export function AtmTermWidget({ underlying: pinned }: { underlying?: string } = {}) {
  const selected = useMarket((m) => m.underlying);
  const underlying = pinned ?? selected;
  return (
    <Card>
      <AtmTermStructure key={underlying} defaultUnderlying={underlying} />
    </Card>
  );
}

export function RealizedVsImpliedWidget({ underlying: pinned }: { underlying?: string } = {}) {
  const selected = useMarket((m) => m.underlying);
  const underlying = pinned ?? selected;
  return (
    <Card>
      <RealizedVsImplied key={underlying} defaultUnderlying={underlying} />
    </Card>
  );
}

export function Surface3DWidget({ underlying: pinned }: { underlying?: string } = {}) {
  const selected = useMarket((m) => m.underlying);
  const underlying = pinned ?? selected;
  return (
    <Card>
      <Suspense fallback={<Spinner size="md" />}>
        <VolSurface3D key={underlying} defaultUnderlying={underlying} />
      </Suspense>
    </Card>
  );
}

export function IvRankWidget({ underlying: pinned }: { underlying?: string } = {}) {
  const selected = useMarket((m) => m.underlying);
  const underlying = pinned ?? selected;
  return (
    <Card>
      <IvRankPanel underlying={underlying} />
    </Card>
  );
}

export function SkewHistoryWidget({ underlying: pinned }: { underlying?: string } = {}) {
  const selected = useMarket((m) => m.underlying);
  const underlying = pinned ?? selected;
  return (
    <Card>
      <SkewHistory underlying={underlying} />
    </Card>
  );
}
