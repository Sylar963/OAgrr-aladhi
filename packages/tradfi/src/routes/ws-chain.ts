import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import type { TradfiStore } from '../runtime/store.js';
import { buildChain } from '../runtime/chain.js';

const PUSH_INTERVAL_MS = 200;

export class ChainPusher {
  private disposed = false;
  constructor(
    private readonly store: TradfiStore,
    private readonly send: (data: string) => void,
    private readonly underlying: string,
    private readonly expiry: string,
  ) {}

  tick(): void {
    if (this.disposed) return;
    this.send(JSON.stringify(buildChain(this.store, this.underlying, this.expiry, 'ws')));
  }

  dispose(): void {
    this.disposed = true;
  }
}

export function wsChainRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; expiry?: string } }>(
      '/ws/chain',
      { websocket: true },
      (socket, req) => {
        const { underlying, expiry } = req.query;
        if (!underlying || !expiry) {
          socket.send(JSON.stringify({ type: 'error', message: 'underlying and expiry required' }));
          socket.close();
          return;
        }
        const pusher = new ChainPusher(deps.store, (d) => socket.send(d), underlying, expiry);
        const timer = setInterval(() => pusher.tick(), PUSH_INTERVAL_MS);
        pusher.tick();
        socket.on('close', () => {
          clearInterval(timer);
          pusher.dispose();
        });
      },
    );
  };
}
