import { Spinner } from '@components/ui';
import { type TradfiPage, useAppStore } from '@stores/app-store';
import { lazy, Suspense } from 'react';
import { useTradfiUnderlyings } from './queries';
import TradfiChainView from './TradfiChainView';
import TradfiGexView from './TradfiGexView';
import styles from './TradfiApp.module.css';

const ArchitectView = lazy(() =>
  import('@features/architect').then((module) => ({ default: module.ArchitectView })),
);
const AlphaView = lazy(() =>
  import('@features/alpha').then((module) => ({ default: module.AlphaView })),
);

const PAGES: ReadonlyArray<[TradfiPage, string]> = [
  ['chain', 'Chain'],
  ['builder', 'Builder'],
  ['gex', 'GEX'],
  ['alpha', 'Alpha'],
];

export default function TradfiApp() {
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const page = useAppStore((s) => s.tradfiPage);
  const setPage = useAppStore((s) => s.setTradfiPage);
  const { data } = useTradfiUnderlyings();
  const underlyings = data?.underlyings ?? [];

  return (
    <div className={styles.root} data-mode="tradfi">
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => setAssetMode('crypto')}>
          ← oggregator
        </button>
        <span className={styles.brand}>TRADFI</span>
        <nav className={styles.pageNav}>
          {PAGES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={styles.pageTab}
              data-active={page === id || undefined}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <select
          className={styles.select}
          value={underlying}
          onChange={(e) => setUnderlying(e.target.value)}
        >
          {underlyings.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <span className={styles.delayed}>15-min delayed</span>
      </header>
      <main className={styles.main}>
        {page === 'builder' ? (
          <Suspense fallback={<Spinner size="lg" label="Loading TradFi Builder…" />}>
            <ArchitectView market="tradfi" />
          </Suspense>
        ) : page === 'gex' ? (
          <TradfiGexView />
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
