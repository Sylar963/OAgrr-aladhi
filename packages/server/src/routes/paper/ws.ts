import type { PaperWsServerMessage } from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import {
  paperTradingStore,
  pnlService,
  positionRepository,
  quoteProvider,
} from '../../trading-services.js';
import { getUserByToken } from '../../user-service.js';
import { paperEvents } from './events.js';
import { pnlToDto, positionToDto } from './mappers.js';

const WS_OPEN = 1;
const PUSH_INTERVAL_MS = 1000;

function send(
  socket: { readyState: number; send: (data: string) => void },
  msg: PaperWsServerMessage,
): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export async function paperWsRoute(app: FastifyInstance) {
  app.get('/ws/paper', { websocket: true }, async (socket, req) => {
    let disposed = false;

    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    let accountId: string;
    if (paperTradingStore.enabled) {
      if (!token) {
        send(socket, {
          type: 'error',
          code: 'unauthorized',
          message: 'token query parameter required',
        });
        socket.close(1008, 'Unauthorized');
        return;
      }
      const user = await getUserByToken(token);
      if (!user) {
        send(socket, { type: 'error', code: 'unauthorized', message: 'Invalid token' });
        socket.close(1008, 'Unauthorized');
        return;
      }
      accountId = user.accountId;
    } else {
      accountId = DEFAULT_ACCOUNT_ID;
    }

    send(socket, {
      type: 'hello',
      accountId,
      serverTime: Date.now(),
    });

    void pushSnapshot();

    const offEvent = paperEvents.subscribe((msg) => send(socket, msg));
    const timer = setInterval(() => {
      if (disposed) return;
      void pushSnapshot();
    }, PUSH_INTERVAL_MS);

    socket.on('close', () => {
      disposed = true;
      clearInterval(timer);
      offEvent();
    });

    async function pushSnapshot(): Promise<void> {
      try {
        const positions = await positionRepository.listPositions(accountId);
        const open = positions.filter((p) => p.netQuantity !== 0);
        const marks = await Promise.all(
          open.map(async (p) =>
            quoteProvider.getMark({
              underlying: p.key.underlying,
              expiry: p.key.expiry,
              strike: p.key.strike,
              optionRight: p.key.optionRight,
            }),
          ),
        );
        send(socket, {
          type: 'positions',
          positions: open.map((pos, i) => positionToDto(pos, marks[i] ?? null)),
        });
        const pnl = await pnlService.snapshot(accountId);
        send(socket, { type: 'pnl', pnl: pnlToDto(pnl) });
      } catch {}
    }
  });
}
