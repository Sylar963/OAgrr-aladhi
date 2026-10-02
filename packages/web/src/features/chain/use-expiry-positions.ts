import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { PRIVATE_ADAPTER_SPECS, VENUE_IDS, type VenueId } from '@oggregator/protocol';
import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { fetchPositions, venueStatus } from '@features/portfolio/api';
import { summarizeExpiryPositions, type ExpiryPositionBadge } from './expiry-positions.js';

const PRIVATE_VENUES: readonly VenueId[] = VENUE_IDS.filter(
  (v) => PRIVATE_ADAPTER_SPECS[v].status === 'available',
);
const STATUS_REFRESH_MS = 15_000;
const POSITIONS_REFRESH_MS = 10_000;

export function useExpiryPositions(
  underlying: string,
  activeVenues: readonly string[],
): ReadonlyMap<string, ExpiryPositionBadge> {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  const ready = session.status === 'ready';
  const venues = PRIVATE_VENUES.filter((v) => activeVenues.includes(v));

  const statuses = useQueries({
    queries: venues.map((venue) => ({
      queryKey: ['account', accountId, 'portfolio', 'venue-status', venue],
      queryFn: () => venueStatus(venue),
      enabled: ready,
      retry: false,
      refetchInterval: STATUS_REFRESH_MS,
    })),
  });

  const connected = venues.filter((_, i) => statuses[i]?.data?.connected === true);

  const positions = useQueries({
    queries: connected.map((venue) => ({
      queryKey: ['account', accountId, 'portfolio', 'positions', venue, underlying],
      queryFn: () => fetchPositions(venue, underlying),
      enabled: ready,
      retry: false,
      refetchInterval: POSITIONS_REFRESH_MS,
    })),
  });

  const connectedKey = connected.join(',');
  const dataStamp = positions.map((p) => p.dataUpdatedAt).join(',');
  return useMemo(
    () =>
      summarizeExpiryPositions(
        connected.map((venue, i) => ({ venue, legs: positions[i]?.data?.positions ?? [] })),
        underlying,
      ),
    // positions/connected are fresh arrays every render; key on their content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectedKey, dataStamp, underlying],
  );
}
