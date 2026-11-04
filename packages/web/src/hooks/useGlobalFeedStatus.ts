import { useEffect, useMemo } from 'react';

import { useExpiries } from '@features/chain/queries';
import { useAppStore, useMarket } from '@stores/app-store';

import { useChainWs } from './useChainWs';

export function useGlobalFeedStatus(enabled = true) {
  const underlying = useMarket((m) => m.underlying);
  const expiry = useMarket((m) => m.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useMarket((m) => m.activeVenues);
  const setFeedStatus = useAppStore((s) => s.setFeedStatus);

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { connectionState, staleMs, venueLagMs, failedVenues, venueStates } = useChainWs({
    underlying,
    expiry,
    venues: activeVenues,
    enabled,
  });

  const failedVenueIds = useMemo(() => failedVenues.map((venue) => venue.venue), [failedVenues]);

  useEffect(() => {
    if (expiries.length > 0 && !expiry) {
      setExpiry(expiries[0]!);
    }
  }, [expiries, expiry, setExpiry]);

  useEffect(() => {
    if (!enabled) return;

    setFeedStatus({
      connectionState,
      failedVenueCount: failedVenueIds.length,
      failedVenueIds,
      failedVenues,
      venueStates,
      staleMs,
      venueLagMs,
      lastUpdateMs: connectionState === 'live' && staleMs != null ? Date.now() - staleMs : null,
    });
  }, [
    enabled,
    connectionState,
    failedVenueIds,
    failedVenues,
    venueStates,
    staleMs,
    venueLagMs,
    setFeedStatus,
  ]);
}
