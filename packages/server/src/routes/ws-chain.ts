import type { FastifyInstance } from 'fastify';
import {
  ClientWsMessageSchema,
  type ServerWsMessage,
  type WsSubscriptionRequest,
} from '@oggregator/core';
import { isReady } from '../app.js';
import { ChainStreamSession } from '../chain-stream-session.js';
import { chainEngines } from '../chain-engines.js';

// WebSocket.OPEN is 1 per RFC 6455 — duck-typed socket interface doesn't carry the constant
const WS_OPEN = 1;

function send(socket: { readyState: number; send: (data: string) => void }, msg: ServerWsMessage) {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function requestKey(request: WsSubscriptionRequest): string {
  return `${request.underlying}\u0000${request.expiry}\u0000${[...request.venues].sort().join(',')}`;
}

export async function wsChainRoute(app: FastifyInstance) {
  chainEngines.start();

  app.get('/ws/chain', { websocket: true }, (socket, req) => {
    const log = req.log.child({ route: 'ws-chain' });

    if (!isReady()) {
      send(socket, {
        type: 'error',
        subscriptionId: null,
        code: 'NOT_READY',
        message: 'Server bootstrapping',
        retryable: true,
      });
      socket.close(1013, 'Try again later');
      return;
    }

    let session: ChainStreamSession | null = null;
    let subscribeVersion = 0;
    let activeRequestKey: string | null = null;

    async function disposeSession(current: ChainStreamSession | null): Promise<void> {
      if (current == null) return;
      await current.dispose();
    }

    async function handleSubscribe(subscriptionId: string, request: WsSubscriptionRequest) {
      const nextRequestKey = requestKey(request);
      if (session != null && activeRequestKey === nextRequestKey) {
        session.replaceSubscription(subscriptionId);
        return;
      }

      const version = ++subscribeVersion;
      const previous = session;
      session = null;
      activeRequestKey = null;
      await disposeSession(previous);

      if (version !== subscribeVersion) return;

      const nextSession = new ChainStreamSession(socket, subscriptionId, request, log);
      session = nextSession;
      await nextSession.subscribe();

      if (version !== subscribeVersion) {
        await nextSession.dispose();
        if (session === nextSession) session = null;
        return;
      }

      log.info(
        {
          subscriptionId,
          underlying: request.underlying,
          expiry: request.expiry,
          venues: request.venues.length,
        },
        'subscribed',
      );
      activeRequestKey = nextRequestKey;
    }

    // ── Client messages ───────────────────────────────────────────

    socket.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        log.debug('malformed JSON from client');
        return;
      }

      const parsed = ClientWsMessageSchema.safeParse(json);
      if (!parsed.success) {
        send(socket, {
          type: 'error',
          subscriptionId: null,
          code: 'INVALID_MESSAGE',
          message: parsed.error.message,
          retryable: false,
        });
        return;
      }

      const msg = parsed.data;

      if (msg.type === 'subscribe') {
        handleSubscribe(msg.subscriptionId, msg.request).catch((err: unknown) => {
          log.error({ err: String(err) }, 'subscribe failed');
        });
        return;
      }

      if (msg.type === 'unsubscribe') {
        subscribeVersion += 1;
        void disposeSession(session);
        session = null;
        activeRequestKey = null;
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      subscribeVersion += 1;
      void disposeSession(session);
      session = null;
      activeRequestKey = null;
      log.info(
        {
          closeCode: code,
          closeReason: reason.length > 0 ? reason.toString() : undefined,
        },
        'client disconnected',
      );
    });
  });
}
