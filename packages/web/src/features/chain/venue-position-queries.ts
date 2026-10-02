import { fetchPositions, venueStatus } from '@features/portfolio';
import type { ExchangePortfolioVenue } from '@oggregator/protocol';

const STATUS_REFRESH_MS = 15_000;
const POSITIONS_REFRESH_MS = 10_000;

export function venueStatusQuery(accountId: string, venue: ExchangePortfolioVenue, enabled: boolean) {
  return {
    queryKey: ['account', accountId, 'portfolio', 'venue-status', venue] as const,
    queryFn: () => venueStatus(venue),
    enabled,
    retry: false,
    refetchInterval: STATUS_REFRESH_MS,
  };
}

export function venuePositionsQuery(
  accountId: string,
  venue: ExchangePortfolioVenue,
  underlying: string,
  enabled: boolean,
) {
  return {
    queryKey: ['account', accountId, 'portfolio', 'positions', venue, underlying] as const,
    queryFn: () => fetchPositions(venue, underlying),
    enabled,
    retry: false,
    refetchInterval: POSITIONS_REFRESH_MS,
  };
}
