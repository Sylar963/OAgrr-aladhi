import { getAllAdapters, type PerpTickerSnapshot } from '@oggregator/core';
import type { CryptoSectorsResponse } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { SECTOR_BASKETS, SECTOR_TAPE } from '../sectors/baskets.js';
import { buildSectorBoard } from '../sectors/board.js';
import { perpTickerService } from '../services.js';

const CACHE_MS = 2_000;

export async function sectorsRoute(app: FastifyInstance) {
  let cached: { at: number; body: CryptoSectorsResponse } | null = null;

  app.get('/sectors', async (req, reply) => {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;

    let snapshot: PerpTickerSnapshot;
    try {
      snapshot = await perpTickerService.getSnapshot();
    } catch (err: unknown) {
      req.log.warn({ err: String(err) }, 'sectors: no Bybit tickers yet');
      return reply.status(503).send({ error: 'unavailable', message: 'Bybit tickers unavailable' });
    }

    const venueUnderlyings = await Promise.all(
      getAllAdapters().map(async (adapter) => ({
        venue: adapter.venue,
        underlyings: await adapter.listUnderlyings(),
      })),
    );

    const body = buildSectorBoard({
      snapshot,
      venueUnderlyings,
      tape: SECTOR_TAPE,
      baskets: SECTOR_BASKETS,
    });
    cached = { at: Date.now(), body };
    return body;
  });
}
