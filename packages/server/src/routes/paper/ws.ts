import type { PaperWsServerMessage } from '@oggregator/protocol';
import { computeSnapshot, DEFAULT_ACCOUNT_ID, type Position } from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import { fundedStore } from '../../funded-services.js';
import { paperTradingStore, positionRepository, quoteProvider } from '../../trading-services.js';
import { getUserByToken } from '../../user-service.js';
import { paperEvents } from './events.js';
import { pnlToDto, positionToDto } from './mappers.js';

const WS_OPEN = 1;
const PUSH_INTERVAL_MS = 1000;
const REFRESH_RETRY_MS = 60_000;

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
    let positions: Position[] = [];
    let cashBalance = 0;
    let accountStateLoaded = false;
    let refreshPromise: Promise<void> | null = null;
    let refreshQueued = false;
    let pushing = false;
    let refreshRetryAt = 0;

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

      const requested = new URL(req.url, 'http://localhost').searchParams.get('accountId');
      if (requested && requested !== user.accountId) {
        const owned =
          fundedStore.enabled &&
          (await fundedStore.listRunsForUser(user.id)).some((r) => r.paperAccountId === requested);
        if (owned) {
          accountId = requested;
        } else {
          send(socket, { type: 'error', code: 'forbidden', message: 'Account not authorized' });
          socket.close(1008, 'Forbidden');
          return;
        }
      }
    } else {
      accountId = DEFAULT_ACCOUNT_ID;
    }

    send(socket, {
      type: 'hello',
      accountId,
      serverTime: Date.now(),
    });

    void refreshAndPush().catch(() => {});

    const offEvent = paperEvents.subscribe((eventAccountId, msg) => {
      if (eventAccountId !== accountId) return;
      send(socket, msg);
      void refreshAndPush().catch(() => {});
    });
    const timer = setInterval(() => {
      if (disposed) return;
      if (!accountStateLoaded) {
        if (refreshPromise == null && Date.now() >= refreshRetryAt) {
          void refreshAndPush().catch(() => {});
        }
        return;
      }
      void pushSnapshot();
    }, PUSH_INTERVAL_MS);

    socket.on('close', () => {
      disposed = true;
      clearInterval(timer);
      offEvent();
    });

    async function refreshAndPush(): Promise<void> {
      refreshQueued = true;
      if (refreshPromise == null) {
        refreshPromise = (async () => {
          try {
            while (refreshQueued && !disposed) {
              refreshQueued = false;
              const [nextPositions, nextCashBalance] = await Promise.all([
                positionRepository.listPositions(accountId),
                positionRepository.getCashBalance(accountId),
              ]);
              positions = nextPositions;
              cashBalance = nextCashBalance;
              accountStateLoaded = true;
              refreshRetryAt = 0;
            }
          } catch (err) {
            refreshRetryAt = Date.now() + REFRESH_RETRY_MS;
            throw err;
          }
        })().finally(() => {
          refreshPromise = null;
        });
      }
      await refreshPromise;
      if (!disposed) await pushSnapshot();
    }

    async function pushSnapshot(): Promise<void> {
      if (pushing) return;
      pushing = true;
      const snapshotPositions = positions;
      const snapshotCashBalance = cashBalance;
      try {
        const open = snapshotPositions.filter((p) => p.netQuantity !== 0);
        const markValues = await Promise.all(
          open.map(async (p) =>
            quoteProvider.getMark({
              underlying: p.key.underlying,
              expiry: p.key.expiry,
              strike: p.key.strike,
              optionRight: p.key.optionRight,
            }),
          ),
        );
        const marks = new Map<string, number | null>();
        for (const [index, position] of open.entries()) {
          marks.set(positionKey(position), markValues[index] ?? null);
        }
        send(socket, {
          type: 'positions',
          positions: open.map((position) =>
            positionToDto(position, marks.get(positionKey(position)) ?? null),
          ),
        });
        const pnl = computeSnapshot(snapshotPositions, marks, snapshotCashBalance, new Date());
        send(socket, { type: 'pnl', pnl: pnlToDto(pnl) });
      } catch {
      } finally {
        pushing = false;
      }
    }
  });
}

function positionKey(position: Position): string {
  return `${position.key.underlying}|${position.key.expiry}|${position.key.strike}|${position.key.optionRight}`;
}
