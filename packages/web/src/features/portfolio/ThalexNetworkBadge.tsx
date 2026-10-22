import { defineMessages, useT } from '@lib/i18n';

import { useThalexKeySlots } from './hooks/queries';
import styles from './ThalexNetworkBadge.module.css';

const messages = defineMessages(
  {
    testnetTitle:
      'Showing your Thalex testnet account. Switch networks under Account → Connect venue.',
    mainnetTitle: 'Showing your Thalex mainnet account (read-only key).',
    testnet: 'Testnet',
    mainnet: 'Mainnet',
    offline: ' · offline',
  },
  {
    testnetTitle:
      'Mostrando tu cuenta testnet de Thalex. Cambia de red en Cuenta → Conectar exchange.',
    mainnetTitle: 'Mostrando tu cuenta mainnet de Thalex (clave de solo lectura).',
    testnet: 'Testnet',
    mainnet: 'Mainnet',
    offline: ' · sin conexión',
  },
);

/** Which Thalex network the portfolio is reading. Renders nothing until a key is in use. */
export default function ThalexNetworkBadge() {
  const t = useT(messages);
  const { data } = useThalexKeySlots();
  const active = data?.slots.find((slot) => slot.active);
  if (active == null) return null;
  const testnet = active.environment === 'test';
  return (
    <span
      className={styles.badge}
      data-network={active.environment}
      title={
        testnet
          ? t('testnetTitle')
          : t('mainnetTitle')
      }
    >
      {testnet ? t('testnet') : t('mainnet')}
      {!active.connected && <span className={styles.offline}>{t('offline')}</span>}
    </span>
  );
}
