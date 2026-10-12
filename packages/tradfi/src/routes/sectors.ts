import type { TradfiSectorsResponse } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { SECTOR_BASKETS, SECTOR_TAPE } from '../sectors/baskets.js';
import { buildSectorBoard } from '../sectors/board.js';

const CACHE_MS = 2_000;

export function sectorsRoute(deps: TradfiDeps) {
  return async (app: FastifyInstance) => {
    let cached: { at: number; body: TradfiSectorsResponse } | null = null;

    app.get('/sectors', async () => {
      const now = Date.now();
      if (cached == null || now - cached.at > CACHE_MS) {
        cached = {
          at: now,
          body: buildSectorBoard({ store: deps.store, tape: SECTOR_TAPE, baskets: SECTOR_BASKETS }),
        };
      }
      return cached.body;
    });
  };
}
