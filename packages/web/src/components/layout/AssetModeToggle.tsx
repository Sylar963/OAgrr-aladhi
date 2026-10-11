import { useAppStore } from '@stores/app-store';

import styles from './AssetModeToggle.module.css';

const MODES = [
  { id: 'crypto', label: 'Crypto', title: 'Crypto options' },
  { id: 'tradfi', label: 'TradFi', title: 'TradFi (TastyTrade)' },
] as const;

export default function AssetModeToggle() {
  const assetMode = useAppStore((s) => s.assetMode);
  const setAssetMode = useAppStore((s) => s.setAssetMode);

  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Market">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          role="radio"
          className={styles.option}
          data-mode={mode.id}
          aria-checked={assetMode === mode.id}
          title={mode.title}
          onClick={() => setAssetMode(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
