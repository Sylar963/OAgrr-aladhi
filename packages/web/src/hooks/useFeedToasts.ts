import { useEffect, useRef } from 'react';

import { useAppStore } from '@stores/app-store';

const DEGRADED_DELAY_MS = 8000;

/**
 * Read-only consumer of the feedStatus store slice. Emits transient toasts
 * for reconnect/recovery and flips `feedDegraded` after a sustained outage.
 * Never touches WS transport — it only observes state others write.
 */
export function useFeedToasts() {
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const failedVenueIds = useAppStore((s) => s.feedStatus.failedVenueIds);
  const pushToast = useAppStore((s) => s.pushToast);
  const setFeedDegraded = useAppStore((s) => s.setFeedDegraded);

  const prevTroubleRef = useRef(false);
  // Whether trouble was actually surfaced to the user (toast shown or degraded flag set).
  const surfacedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allVenuesFailed =
    activeVenues.length > 0 && activeVenues.every((v) => failedVenueIds.includes(v));
  const inTrouble = connectionState !== 'live' || allVenuesFailed;

  useEffect(() => {
    const wasInTrouble = prevTroubleRef.current;

    if (inTrouble && !wasInTrouble) {
      // Trouble just started — push an immediate toast for reconnecting states.
      if (connectionState === 'reconnecting' || connectionState === 'connecting') {
        pushToast({ tone: 'warning', icon: '↻', text: 'Reconnecting to feed…' });
        surfacedRef.current = true;
      }
      // Schedule degraded flag after sustained outage.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setFeedDegraded(true);
        surfacedRef.current = true;
      }, DEGRADED_DELAY_MS);
    }

    if (!inTrouble && wasInTrouble) {
      // Trouble cleared — cancel any pending degraded timer.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setFeedDegraded(false);
      // Only show "restored" if trouble was visible to the user.
      if (surfacedRef.current) {
        pushToast({ tone: 'success', icon: '✓', text: 'Feed restored' });
      }
      surfacedRef.current = false;
    }

    prevTroubleRef.current = inTrouble;
    // connectionState stays in deps: the entering-trouble branch reads it directly
    // (reconnecting/connecting → toast), not just the derived `inTrouble` boolean.
  }, [inTrouble, connectionState, pushToast, setFeedDegraded]);

  // Cleanup timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
}
