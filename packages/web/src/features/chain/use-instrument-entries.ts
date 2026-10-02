import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExchangePortfolioVenueSchema } from '@oggregator/protocol';
import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { fetchExchangeTrades } from '@features/portfolio';
import { useFills } from '@features/trading';
import {
  exchangeTradeEntries,
  paperFillEntries,
  type InstrumentEntry,
  type InstrumentKey,
  type VenuePositionLeg,
} from './entry-markers.js';
import { venuePositionsQuery, venueStatusQuery } from './venue-position-queries.js';

const PAPER_FILL_LIMIT = 500;
const EXCHANGE_TRADES_REFRESH_MS = 30_000;

export interface InstrumentEntriesResult {
  entries: InstrumentEntry[];
  // undefined: venue has no private feed or isn't connected; null: connected and flat.
  venueLeg: VenuePositionLeg | null | undefined;
}

export function useInstrumentEntries(key: InstrumentKey): InstrumentEntriesResult {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  const ready = session.status === 'ready';
  const fills = useFills(PAPER_FILL_LIMIT);

  const exchangeVenue = ExchangePortfolioVenueSchema.safeParse(key.venue);
  const venue = exchangeVenue.success ? exchangeVenue.data : null;
  const trades = useQuery({
    queryKey: [
      'account',
      accountId,
      'portfolio',
      'exchange-trades',
      venue,
      key.underlying,
      key.expiry,
      key.strike,
      key.type,
    ],
    queryFn: () =>
      fetchExchangeTrades({
        venue: venue!,
        underlying: key.underlying,
        expiry: key.expiry,
        strike: key.strike,
        right: key.type,
      }),
    enabled: ready && venue != null,
    refetchInterval: EXCHANGE_TRADES_REFRESH_MS,
  });

  const status = useQuery(venueStatusQuery(accountId, venue ?? 'derive', ready && venue != null));
  const connected = venue != null && status.data?.connected === true;
  const positions = useQuery(
    venuePositionsQuery(accountId, venue ?? 'derive', key.underlying, ready && connected),
  );

  const { venue: keyVenue, underlying, expiry, strike, type } = key;
  const entries = useMemo(() => {
    const k = { venue: keyVenue, underlying, expiry, strike, type };
    return [
      ...paperFillEntries(fills.data?.fills ?? [], k),
      ...exchangeTradeEntries(trades.data?.trades ?? [], k),
    ];
  }, [fills.data, trades.data, keyVenue, underlying, expiry, strike, type]);

  const venueLeg = useMemo((): VenuePositionLeg | null | undefined => {
    if (!connected || positions.data == null) return undefined;
    let size = 0;
    let cost = 0;
    for (const leg of positions.data.positions) {
      if (leg.expiry !== expiry || leg.strike !== strike || leg.optionRight !== type) continue;
      size += leg.size;
      cost += leg.size * leg.entryPriceUsd;
    }
    return size === 0 ? null : { size, entryPriceUsd: cost / size };
  }, [connected, positions.data, expiry, strike, type]);

  return { entries, venueLeg };
}
