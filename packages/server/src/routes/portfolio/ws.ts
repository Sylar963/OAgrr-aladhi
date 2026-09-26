import type { FastifyInstance } from 'fastify';
import type { PortfolioWsServerMessage } from '@oggregator/protocol';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { PortfolioSourceSchema } from '@oggregator/protocol';

import {
  bootstrapPortfolioForAccount,
  getOrCreatePortfolioRuntime,
} from '../../portfolio-services.js';
import { derivePositionStore } from '../../derive-position-store.js';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { paperTradingStore } from '../../trading-services.js';
import { consumeWebSocketTicket } from '../../websocket-ticket-service.js';
import { protectWebSocket, registerPrivateWebSocket } from '../../websocket-security.js';
import { portfolioEvents } from './events.js';

const WS_OPEN = 1;

function send(
  socket: { readyState: number; send: (data: string) => void },
  msg: PortfolioWsServerMessage,
): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export async function portfolioWsRoute(app: FastifyInstance) {
  app.get('/ws/portfolio', { websocket: true }, async (socket, req) => {
    if (!protectWebSocket(socket, req.ip)) return;
    let disposed = false;
    let offRuntime: (() => void) | null = null;
    let offBus: (() => void) | null = null;
    let releasePrivateConnection: (() => void) | null = null;

    socket.on('close', () => {
      disposed = true;
      offRuntime?.();
      offBus?.();
      releasePrivateConnection?.();
    });

    try {
      const url = new URL(req.url, 'http://localhost');
      const ticket = url.searchParams.get('ticket');

      let accountId: string;
      if (paperTradingStore.enabled) {
        if (!ticket) {
          send(socket, {
            type: 'error',
            code: 'unauthorized',
            message: 'ticket query parameter required',
          });
          socket.close(1008, 'Unauthorized');
          return;
        }
        const user = consumeWebSocketTicket(ticket);
        if (!user) {
          send(socket, {
            type: 'error',
            code: 'unauthorized',
            message: 'Invalid or expired WebSocket ticket',
          });
          socket.close(1008, 'Unauthorized');
          return;
        }
        accountId = user.accountId;
        registerPrivateWebSocket(user.id, socket);
      } else {
        accountId = DEFAULT_ACCOUNT_ID;
      }

      const sourceParsed = PortfolioSourceSchema.safeParse(url.searchParams.get('source'));
      const source = sourceParsed.success ? sourceParsed.data : 'manual';
      const underlyingRaw = url.searchParams.get('underlying')?.trim();
      const underlying = underlyingRaw && underlyingRaw.length > 0 ? underlyingRaw : undefined;

      if (source === 'derive') {
        derivePositionStore.retain(accountId);
        releasePrivateConnection = () => derivePositionStore.release(accountId);
      } else if (source === 'thalex') {
        thalexPositionStore.retain(accountId);
        releasePrivateConnection = () => thalexPositionStore.release(accountId);
      }

      req.log.info({ accountId, source, underlying }, 'portfolio ws: connected');
      send(socket, {
        type: 'hello',
        accountId,
        serverTime: Date.now(),
      });

      try {
        await bootstrapPortfolioForAccount(accountId, source, underlying);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.warn(
          { err: message, accountId, source, underlying },
          'portfolio ws: bootstrap failed',
        );
        send(socket, { type: 'error', code: 'bootstrap_failed', message });
      }
      if (disposed) return;

      const runtime = getOrCreatePortfolioRuntime(accountId, source, underlying);

      const initial = runtime.getSnapshot();
      if (initial != null) {
        req.log.info(
          { accountId, source, seq: initial.seq, positions: initial.positions.length },
          'portfolio ws: sending initial snapshot',
        );
        send(socket, {
          type: 'snapshot',
          seq: initial.seq,
          metrics: initial.metrics,
          positions: initial.positions,
        });
      } else {
        req.log.warn({ accountId, source }, 'portfolio ws: no initial snapshot available');
      }

      offRuntime = runtime.subscribe({
        onEvent: (event) => {
          if (disposed) return;
          if (event.type === 'snapshot') {
            send(socket, {
              type: 'snapshot',
              seq: event.seq,
              metrics: event.metrics,
              positions: event.positions,
            });
          } else if (event.type === 'delta') {
            send(socket, {
              type: 'delta',
              seq: event.seq,
              metrics: event.metrics,
              changedLegIds: event.changedLegIds,
            });
          } else if (event.type === 'error') {
            send(socket, { type: 'error', code: event.code, message: event.message });
          }
        },
      });

      offBus = portfolioEvents.subscribe(accountId, (msg) => {
        if (disposed) return;
        send(socket, msg);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err: message }, 'portfolio ws: handler crashed');
      send(socket, { type: 'error', code: 'handler_crashed', message });
    }
  });
}
