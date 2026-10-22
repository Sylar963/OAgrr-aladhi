import { useAppStore } from '@stores/app-store';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import styles from './VenueIndicator.module.css';

const messages = defineMessages(
  { all: 'All venues', count: '{n} venues' },
  { all: 'Todos los exchanges', count: '{n} exchanges' },
);

export default function VenueIndicator() {
  const t = useT(messages);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const allActive = activeVenues.length >= 5;

  return (
    <span className={styles.wrap}>
      {activeVenues.map((v) => {
        const meta = VENUES[v];
        return meta?.logo ? (
          <img
            key={v}
            src={meta.logo}
            alt={meta.shortLabel}
            className={styles.logo}
            title={meta.label}
          />
        ) : (
          <span key={v} className={styles.tag}>
            {meta?.shortLabel ?? v}
          </span>
        );
      })}
      <span className={styles.label}>
        {allActive ? t('all') : t('count', { n: activeVenues.length })}
      </span>
    </span>
  );
}
