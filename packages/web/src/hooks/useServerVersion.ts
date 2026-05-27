import { parseAnnouncement } from '@lib/system-status';
import { useAppStore } from '@stores/app-store';
import {
  VENUE_IDS,
  type VenueFailure,
  type VenueId,
  type WsConnectionState,
} from '@oggregator/protocol';
import { useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const POLL_INTERVAL_MS = 30_000;

interface HealthResponse {
  bootTime?: number;
  version?: string;
  announcement?: unknown;
  feeds?: {
    summary?: {
      totalVenues?: number;
      connectedVenues?: number;
      lastAnyMessageAgeMs?: number;
    };
    venues?: Array<{
      venue: string;
      connected: boolean;
      lastMessageAgeMs?: number;
    }>;
  };
}

function mapFeedHealth(body: HealthResponse): {
  connectionState: WsConnectionState;
  failedVenues: VenueFailure[];
  failedVenueIds: VenueId[];
  venueStates: Record<string, WsConnectionState>;
  staleMs: number | null;
} | null {
  const summary = body.feeds?.summary;
  const venues = body.feeds?.venues;
  if (summary == null || venues == null) return null;

  const totalVenues = summary.totalVenues ?? venues.length;
  const connectedVenues =
    summary.connectedVenues ?? venues.filter((venue) => venue.connected).length;
  const failedVenueIds = venues
    .filter((venue) => !venue.connected && VENUE_IDS.includes(venue.venue as VenueId))
    .map((venue) => venue.venue as VenueId);
  const failedVenues = failedVenueIds.map((venue) => ({
    venue,
    reason: 'venue feed disconnected',
  }));
  const venueStates = Object.fromEntries(
    venues.map((venue) => [venue.venue, venue.connected ? 'live' : 'error']),
  ) as Record<string, WsConnectionState>;

  const connectionState: WsConnectionState =
    totalVenues > 0 && connectedVenues === totalVenues
      ? 'live'
      : connectedVenues > 0
        ? 'reconnecting'
        : 'error';

  return {
    connectionState,
    failedVenues,
    failedVenueIds,
    venueStates,
    staleMs: summary.lastAnyMessageAgeMs ?? null,
  };
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Polls /api/health and raises a 'server-updated' session notice when the
 * server's bootTime changes after the first successful observation. A bootTime
 * change means the server restarted and may be running new code — the client
 * bundle could be stale.
 */
export function useServerVersion() {
  const setSessionNotice = useAppStore((s) => s.setSessionNotice);
  const currentNoticeKind = useAppStore((s) => s.sessionNotice?.kind);
  const setAnnouncement = useAppStore((s) => s.setAnnouncement);
  const setFeedStatus = useAppStore((s) => s.setFeedStatus);
  const activeTab = useAppStore((s) => s.activeTab);
  const initialBootRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const { signal, cleanup } = createTimeoutSignal(5000);
      try {
        const res = await fetch(`${API_BASE}/health`, {
          signal,
        });
        if (!res.ok) throw new Error(`health ${res.status}`);
        const body = (await res.json()) as HealthResponse;
        if (cancelled) return;

        if (typeof body.bootTime === 'number') {
          if (initialBootRef.current === null) {
            initialBootRef.current = body.bootTime;
          } else if (
            body.bootTime !== initialBootRef.current &&
            currentNoticeKind !== 'server-updated'
          ) {
            setSessionNotice({ kind: 'server-updated' });
          }
        }

        setAnnouncement(parseAnnouncement(body.announcement));
        const feedHealth = mapFeedHealth(body);
        if (feedHealth != null && activeTab !== 'chain') {
          setFeedStatus({
            connectionState: feedHealth.connectionState,
            failedVenueCount: feedHealth.failedVenues.length,
            failedVenueIds: feedHealth.failedVenueIds,
            failedVenues: feedHealth.failedVenues,
            venueStates: feedHealth.venueStates,
            staleMs: feedHealth.staleMs,
            lastUpdateMs:
              feedHealth.connectionState === 'live' && feedHealth.staleMs != null
                ? Date.now() - feedHealth.staleMs
                : null,
          });
        }
      } catch {
        // Silent — transient network errors during server restart are expected.
      } finally {
        cleanup();
        if (!cancelled) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [setSessionNotice, currentNoticeKind, setAnnouncement, setFeedStatus, activeTab]);
}
