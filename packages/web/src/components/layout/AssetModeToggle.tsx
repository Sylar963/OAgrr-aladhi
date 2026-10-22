import { defineMessages, useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';

import styles from './AssetModeToggle.module.css';

const messages = defineMessages(
  { market: 'Market', cryptoTitle: 'Crypto options', tradfiTitle: 'TradFi (TastyTrade)' },
  { market: 'Mercado', cryptoTitle: 'Opciones cripto', tradfiTitle: 'TradFi (TastyTrade)' },
);

const MODES = [
  { id: 'crypto', label: 'Crypto', titleKey: 'cryptoTitle' },
  { id: 'tradfi', label: 'TradFi', titleKey: 'tradfiTitle' },
] as const;

export default function AssetModeToggle() {
  const assetMode = useAppStore((s) => s.assetMode);
  const setAssetMode = useAppStore((s) => s.setAssetMode);
  const t = useT(messages);

  return (
    <div className={styles.toggle} role="radiogroup" aria-label={t('market')}>
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          role="radio"
          className={styles.option}
          data-mode={mode.id}
          aria-checked={assetMode === mode.id}
          title={t(mode.titleKey)}
          onClick={() => setAssetMode(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
