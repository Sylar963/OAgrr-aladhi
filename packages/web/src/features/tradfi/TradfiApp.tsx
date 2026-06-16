import { useAppStore } from '@stores/app-store';
import { useTradfiUnderlyings } from './queries';
import TradfiChainView from './TradfiChainView';
import TradfiGexView from './TradfiGexView';
import styles from './TradfiApp.module.css';

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
      <main className={styles.main}>{page === 'gex' ? <TradfiGexView /> : <TradfiChainView />}</main>
    </div>
  );
}
