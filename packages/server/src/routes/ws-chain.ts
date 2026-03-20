import type { FastifyInstance } from 'fastify';
import {
  getAllAdapters,
  getAdapter,
  buildComparisonChain,
  buildEnrichedChain,
  type VenueId,
  type VenueDelta,
  type VenueStatus,
  type StreamHandlers,
  VENUE_IDS,
} from '@oggregator/core';
import { isReady } from '../app.js';

// Venue feeds fire hundreds of deltas/sec. Browser doesn't need sub-200ms
// granularity for an options chain — throttle to 5 pushes/sec max.
const PUSH_INTERVAL_MS = 200;

function parseVenues(raw: unknown): VenueId[] {
  if (!Array.isArray(raw)) return getAllAdapters().map((a) => a.venue);
  return raw.filter((v): v is VenueId => typeof v === 'string' && VENUE_IDS.includes(v as VenueId));
}

export async function wsChainRoute(app: FastifyInstance) {
  app.get('/ws/chain', { websocket: true }, (socket, req) => {
    const log = req.log.child({ route: 'ws-chain' });

    if (!isReady()) {
      socket.send(JSON.stringify({ type: 'error', message: 'Server bootstrapping' }));
      socket.close(1013, 'Try again later');
      return;
    }

    let underlying = '';
    let expiry = '';
    let venues: VenueId[] = [];
    let pushTimer: ReturnType<typeof setInterval> | null = null;
    let dirty = false;
    // Track handlers so we can remove them on disconnect without killing venue subscriptions.
    // Venue WS connections are shared — other clients and REST endpoints use them too.
    const activeHandlers = new Set<StreamHandlers>();

    function buildAndPush() {
      if (!underlying || !expiry || socket.readyState !== 1) return;

      try {
        const chainPromises = venues.map((venueId) => {
          try { return getAdapter(venueId).fetchOptionChain({ underlying, expiry, venues }); }
          catch { return null; }
        });

        // fetchOptionChain resolves synchronously from in-memory QuoteStore
        Promise.all(chainPromises).then((results) => {
          const chains = results.filter((r) => r != null);
          const comparison = buildComparisonChain(underlying, expiry, chains);
          const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, chains);

          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'snapshot', data: enriched }));
          }
        }).catch((err: unknown) => {
          log.warn({ err: String(err) }, 'chain build failed');
        });
      } catch (err: unknown) {
        log.warn({ err: String(err) }, 'chain build failed');
      }
    }

    function startPushLoop() {
      if (pushTimer) return;
      pushTimer = setInterval(() => {
        if (dirty) {
          dirty = false;
          buildAndPush();
        }
      }, PUSH_INTERVAL_MS);
    }

    function stopPushLoop() {
      if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    }

    async function doSubscribe(u: string, e: string, v: VenueId[]) {
      doCleanup();

      underlying = u;
      expiry = e;
      venues = v.length > 0 ? v : getAllAdapters().map((a) => a.venue);

      const handlers: StreamHandlers = {
        onDelta: (_deltas: VenueDelta[]) => { dirty = true; },
        onStatus: (status: VenueStatus) => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'status', data: status }));
          }
        },
      };
      activeHandlers.add(handlers);

      for (const venueId of venues) {
        try {
          const adapter = getAdapter(venueId);
          if (!adapter.subscribe) continue;
          // Don't store unsub — venue connections are shared across clients
          await adapter.subscribe({ underlying, expiry }, handlers);
        } catch (err: unknown) {
          log.warn({ venue: venueId, err: String(err) }, 'venue subscribe failed');
        }
      }

      buildAndPush();
      startPushLoop();
      log.info({ underlying, expiry, venues: venues.length }, 'client subscribed');
    }

    function doCleanup() {
      stopPushLoop();
      for (const handlers of activeHandlers) {
        for (const adapter of getAllAdapters()) {
          adapter.removeDeltaHandler?.(handlers);
        }
      }
      activeHandlers.clear();
    }

    // ── Client messages ───────────────────────────────────────────

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

        if (msg['type'] === 'subscribe') {
          const u = typeof msg['underlying'] === 'string' ? msg['underlying'] : '';
          const e = typeof msg['expiry'] === 'string' ? msg['expiry'] : '';
          const v = parseVenues(msg['venues']);

          if (!u || !e) {
            socket.send(JSON.stringify({ type: 'error', message: 'underlying and expiry required' }));
            return;
          }

          doSubscribe(u, e, v).catch((err: unknown) => {
            log.error({ err: String(err) }, 'subscribe failed');
          });
          return;
        }

        if (msg['type'] === 'unsubscribe') {
          doCleanup();
        }
      } catch {
        log.debug('malformed ws message from client');
      }
    });

    socket.on('close', () => {
      doCleanup();
      log.info('client disconnected');
    });
  });
}
