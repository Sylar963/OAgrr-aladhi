import { Spinner } from '@components/ui';
import { useAppStore } from '@stores/app-store';
import { lazy, Suspense } from 'react';
import { useTradfiUnderlyings } from './queries';
import TradfiChainView from './TradfiChainView';
import TradfiGexView from './TradfiGexView';
import styles from './TradfiApp.module.css';

const ArchitectView = lazy(() =>
  import('@features/architect').then((module) => ({ default: module.ArchitectView })),
);

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
          <button
            type="button"
            className={styles.pageTab}
            data-active={page === 'chain' || undefined}
            onClick={() => setPage('chain')}
          >
            Chain
          </button>
          <button
            type="button"
            className={styles.pageTab}
            data-active={page === 'builder' || undefined}
            onClick={() => setPage('builder')}
          >
            Builder
          </button>
          <button
            type="button"
            className={styles.pageTab}
            data-active={page === 'gex' || undefined}
            onClick={() => setPage('gex')}
          >
            GEX
          </button>
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
        ) : (
          <TradfiChainView />
        )}
      </main>
    </div>
  );
}
