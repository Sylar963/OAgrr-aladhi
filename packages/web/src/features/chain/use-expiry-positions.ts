import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  ExchangePortfolioVenueSchema,
  PRIVATE_ADAPTER_SPECS,
  VENUE_IDS,
  type ExchangePortfolioVenue,
} from '@oggregator/protocol';
import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { summarizeExpiryPositions, type ExpiryPositionBadge } from './expiry-positions.js';
import { venuePositionsQuery, venueStatusQuery } from './venue-position-queries.js';

const PRIVATE_VENUES: readonly ExchangePortfolioVenue[] = VENUE_IDS.flatMap((v) => {
  const parsed = ExchangePortfolioVenueSchema.safeParse(v);
  return parsed.success && PRIVATE_ADAPTER_SPECS[v].status === 'available' ? [parsed.data] : [];
});

export function useExpiryPositions(
  underlying: string,
  activeVenues: readonly string[],
): ReadonlyMap<string, ExpiryPositionBadge> {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  const ready = session.status === 'ready';
  const venues = PRIVATE_VENUES.filter((v) => activeVenues.includes(v));

  const statuses = useQueries({
    queries: venues.map((venue) => venueStatusQuery(accountId, venue, ready)),
  });
  const connected = venues.filter((_, i) => statuses[i]?.data?.connected === true);
  const positions = useQueries({
    queries: connected.map((venue) => venuePositionsQuery(accountId, venue, underlying, ready)),
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
