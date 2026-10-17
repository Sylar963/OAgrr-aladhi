import { useOpenPalette } from '@components/layout/palette-context';
import { useChainQuery, useExpiries, usePrefetchChain } from '@features/chain';
import { useTradfiChain, useTradfiSelection } from '@features/tradfi';
import { VENUE_IDS } from '@oggregator/protocol';
import type { VenueId } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useMemo } from 'react';

export type AlphaMarket = 'crypto' | 'tradfi';

// The TradFi service widens 'tastytrade' into the crypto VenueId union at its boundary.
const TRADFI_VENUES: VenueId[] = ['tastytrade' as VenueId];

/** Underlying, expiry and chain for Alpha, sourced from the crypto server or the TradFi service. */
export function useAlphaMarketData(market: AlphaMarket) {
  const tradfi = market === 'tradfi';
  const openPalette = useOpenPalette();
  const cryptoUnderlying = useAppStore((s) => s.underlying);
  const cryptoExpiry = useAppStore((s) => s.expiry);
  const setCryptoExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setTradfiPage = useAppStore((s) => s.setTradfiPage);
  const expiriesQuery = useExpiries(tradfi ? '' : cryptoUnderlying);
  const cryptoExpiries = expiriesQuery.data?.expiries;
  // Placeholder data is the previous ticker's listing; filtering by it would hide the new ticker's venues.
  const listing = expiriesQuery.isPlaceholderData ? undefined : expiriesQuery.data?.byVenue;
  const cryptoVenues = useMemo(() => {
    const listed =
      listing == null
        ? null
        : new Set(listing.filter((row) => row.expiries.length > 0).map((row) => row.venue));
    return VENUE_IDS.filter(
      (venue) => activeVenues.includes(venue) && (listed == null || listed.has(venue)),
    );
  }, [activeVenues, listing]);
  const prefetchCrypto = usePrefetchChain(cryptoUnderlying, activeVenues);
  const cryptoChain = useChainQuery(cryptoUnderlying, cryptoExpiry, activeVenues, {
    enabled: !tradfi,
  });

  const selection = useTradfiSelection(tradfi);
  const tradfiChain = useTradfiChain(tradfi ? selection.underlying : '', selection.expiry);

  if (tradfi) {
    return {
      underlying: selection.underlying,
      expiry: selection.expiry,
      setExpiry: selection.setExpiry,
      expiries: selection.expiries,
      venues: TRADFI_VENUES,
      chainQuery: tradfiChain,
      changeAsset: selection.cycleUnderlying,
      prefetch: undefined,
      showBuilder: () => setTradfiPage('builder'),
    };
  }
  return {
    underlying: cryptoUnderlying,
    expiry: cryptoExpiry,
    setExpiry: setCryptoExpiry,
    expiries: cryptoExpiries ?? [],
    venues: cryptoVenues,
    chainQuery: cryptoChain,
    changeAsset: openPalette,
    prefetch: prefetchCrypto,
    showBuilder: () => setActiveTab('architect'),
  };
}
