import { defineMessages, useT } from '@lib/i18n';
import { useParadexKeySlots } from './hooks/queries';
import styles from './ThalexNetworkBadge.module.css';

const messages = defineMessages(
  { prod: 'Mainnet', test: 'Testnet', offline: ' · offline' },
  { prod: 'Mainnet', test: 'Testnet', offline: ' · sin conexión' },
);

export default function ParadexNetworkBadge() {
  const t = useT(messages);
  const { data } = useParadexKeySlots();
  const active = data?.slots.find((slot) => slot.active);
  if (active == null) return null;
  return <span className={styles.badge} data-network={active.environment}>
    {t(active.environment)}{!active.connected && <span className={styles.offline}>{t('offline')}</span>}
  </span>;
}
