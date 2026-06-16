import { combineGex, type GexStrike } from '@oggregator/core';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';

export interface TradfiAllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export function gexAllExpiriesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>(
      '/gex-all-expiries',
      async (req, reply) => {
        const { underlying } = req.query;
        if (!underlying) {
          return reply.status(400).send({ error: 'underlying query param required' });
        }

        const r = deps.feed.readiness();
        if (!r.catalogLoaded) {
          return reply.status(503).send({ error: 'catalog not loaded' });
        }

        const expiries = deps.store.listExpiries(underlying);
        if (expiries.length === 0) {
          return { underlying, expiries: [], spotPrice: null, gex: [] };
        }

        const snapshots = expiries.map((expiry) => {
          deps.feed.ensureChainSubscribed(underlying, expiry);
          return buildChain(deps.store, underlying, expiry, 'ws', deps.flowBook);
        });

        const gex = combineGex(snapshots.map((s) => s.gex));
        const first = snapshots[0];
        const spotPrice =
          first != null ? (first.stats.indexPriceUsd ?? first.stats.forwardPriceUsd) : null;

        return { underlying, expiries, spotPrice, gex };
      },
    );
  };
}
