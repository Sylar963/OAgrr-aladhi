import { VENUES } from '@lib/venue-meta';
import type { SocialVenue } from '@oggregator/protocol';

import styles from './VenueTag.module.css';

export function venueLabel(venue: SocialVenue): string {
  return VENUES[venue]?.label ?? venue;
}

export default function VenueTag({ venue }: { venue: SocialVenue }) {
  const meta = VENUES[venue];
  return (
    <span className={styles.tag}>
      {meta && <img className={styles.logo} src={meta.logo} alt="" />}
      {venueLabel(venue)}
    </span>
  );
}
