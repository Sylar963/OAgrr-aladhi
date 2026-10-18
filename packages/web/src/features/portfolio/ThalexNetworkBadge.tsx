import { useThalexKeySlots } from './hooks/queries';
import styles from './ThalexNetworkBadge.module.css';

/** Which Thalex network the portfolio is reading. Renders nothing until a key is in use. */
export default function ThalexNetworkBadge() {
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
          ? 'Showing your Thalex testnet account. Switch networks under Account → Connect venue.'
          : 'Showing your Thalex mainnet account (read-only key).'
      }
    >
      {testnet ? 'Testnet' : 'Mainnet'}
      {!active.connected && <span className={styles.offline}> · offline</span>}
    </span>
  );
}
