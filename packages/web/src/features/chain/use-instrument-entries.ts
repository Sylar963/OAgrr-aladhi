import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExchangePortfolioVenueSchema } from '@oggregator/protocol';
import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { fetchExchangeTrades } from '@features/portfolio/api';
import { useFills } from '@features/trading/hooks/queries';
import {
  exchangeTradeEntries,
  paperFillEntries,
  type InstrumentEntry,
  type InstrumentKey,
} from './entry-markers.js';

const PAPER_FILL_LIMIT = 500;
const EXCHANGE_TRADES_REFRESH_MS = 30_000;

export function useInstrumentEntries(key: InstrumentKey): InstrumentEntry[] {
  const session = useAccountSession();
  const fills = useFills(PAPER_FILL_LIMIT);

  const exchangeVenue = ExchangePortfolioVenueSchema.safeParse(key.venue);
  const venue = exchangeVenue.success ? exchangeVenue.data : null;
  const trades = useQuery({
    queryKey: [
      'account',
      session.accountId ?? 'unresolved',
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
    enabled: session.status === 'ready' && venue != null,
    refetchInterval: EXCHANGE_TRADES_REFRESH_MS,
  });

  const { venue: keyVenue, underlying, expiry, strike, type } = key;
  return useMemo(() => {
    const k = { venue: keyVenue, underlying, expiry, strike, type };
    return [
      ...paperFillEntries(fills.data?.fills ?? [], k),
      ...exchangeTradeEntries(trades.data?.trades ?? [], k),
    ];
  }, [fills.data, trades.data, keyVenue, underlying, expiry, strike, type]);
}
