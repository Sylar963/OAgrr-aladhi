import type { WsConnectionState } from '@oggregator/protocol';
import { VENUE_LIST } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';

import FreshnessLabel from './FreshnessLabel';
import styles from './VenueHealth.module.css';

type VenueState = 'live' | 'reconnecting' | 'failed' | 'inactive';
export type HealthLevel = 'ok' | 'warn' | 'bad';

export const STALE_WARN_MS = 5_000;
export const STALE_BAD_MS = 30_000;

const STATE_TEXT: Record<VenueState, string> = {
  live: 'live',
  reconnecting: 'reconnecting',
  failed: 'disconnected',
  inactive: 'off',
};

interface HealthInput {
  connectionState: WsConnectionState;
  staleMs: number | null;
  liveCount: number;
  activeCount: number;
}

export function healthLevel({ connectionState, staleMs, liveCount, activeCount }: HealthInput): HealthLevel {
  if (connectionState === 'error') return 'bad';
  if (activeCount > 0 && liveCount === 0) return 'bad';
  if (connectionState === 'live' && staleMs != null && staleMs >= STALE_BAD_MS) return 'bad';
  if (connectionState !== 'live' || liveCount < activeCount) return 'warn';
  if (staleMs != null && staleMs >= STALE_WARN_MS) return 'warn';
  return 'ok';
}

export default function VenueHealth() {
  const activeVenues = useAppStore((s) => s.activeVenues);
  const failedVenueIds = useAppStore((s) => s.feedStatus.failedVenueIds);
  const connectionState = useAppStore((s) => s.feedStatus.connectionState);
  const venueStates = useAppStore((s) => s.feedStatus.venueStates);
  const staleMs = useAppStore((s) => s.feedStatus.staleMs);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const activeSet = new Set(activeVenues);
  const failedSet = new Set(failedVenueIds);
  const feedIsLive = connectionState === 'live';

  const venues = VENUE_LIST.map((venue) => {
    const live = venueStates[venue.id];
    // Live status event wins. When undefined (no status received yet),
    // fall through to the subscribe-time failure list / global feed state.
    const state: VenueState = !activeSet.has(venue.id)
      ? 'inactive'
      : live === 'live'
        ? 'live'
        : live === 'reconnecting'
          ? 'reconnecting'
          : live === 'stale' || live === 'error'
            ? 'failed'
            : failedSet.has(venue.id) || !feedIsLive
              ? 'failed'
              : 'live';
    return { id: venue.id, label: venue.label, state };
  });

  const activeCount = venues.filter((v) => v.state !== 'inactive').length;
  const liveCount = venues.filter((v) => v.state === 'live').length;
  const level = healthLevel({ connectionState, staleMs, liveCount, activeCount });

  return (
    <div className={styles.wrap} ref={wrapRef} data-tour="venue-status">
      <button
        type="button"
        className={styles.pill}
        data-level={level}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Feed health: ${liveCount} of ${activeCount} venues live`}
      >
        <span className={styles.dot} />
        <span className={styles.count}>
          {liveCount}/{activeCount}
        </span>
        <span className={styles.sep}>·</span>
        <span className={styles.freshness}>
          <FreshnessLabel />
        </span>
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label="Venue feed status">
          <div className={styles.header}>
            Venue feeds
            <span className={styles.headerLatency}>
              <FreshnessLabel />
            </span>
          </div>
          {venues.map((venue) => (
            <div key={venue.id} className={styles.row} data-state={venue.state}>
              <span className={styles.rowDot} />
              <span className={styles.rowLabel}>{venue.label}</span>
              <span className={styles.rowState}>{STATE_TEXT[venue.state]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
