import type { TradfiVolHistoryResponse } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import type { CandleSource } from '../runtime/candles.js';
import { buildVolHistory, IV_INDEX } from '../runtime/vol-history.js';

const CACHE_TTL_MS = 5 * 60_000;
// DXLink keeps ~3 years of daily candles, and its oldest retained week is not split-adjusted
// (NVDA 4.61 instead of ~46), so stop two weeks short of it.
const HISTORY_MS = 1_080 * 86_400_000;

async function load(
  client: CandleSource,
  underlying: string,
  nowMs: number,
): Promise<TradfiVolHistoryResponse | null> {
  const from = nowMs - HISTORY_MS;
  const indexSymbol = IV_INDEX[underlying];
  const [bars, indexBars] = await Promise.all([
    client.getCandles(underlying, 'd', from),
    indexSymbol != null ? client.getCandles(indexSymbol, 'd', from) : Promise.resolve([]),
  ]);
  return buildVolHistory(
    underlying,
    bars,
    indexSymbol != null ? { symbol: indexSymbol, bars: indexBars } : undefined,
  );
}

export function volHistoryRoute(deps: TradfiDeps) {
  const cache = new Map<string, { at: number; response: Promise<TradfiVolHistoryResponse | null> }>();

  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>('/vol-history', async (req, reply) => {
      const underlying = req.query.underlying?.toUpperCase();
      if (!underlying) {
        return reply.status(400).send({ error: 'underlying query param required' });
      }
      const client = deps.candleClient;
      if (client == null || !client.isReady()) {
        return reply.status(503).send({ error: 'candle feed not ready' });
      }
      const now = Date.now();
      let hit = cache.get(underlying);
      if (hit == null || now - hit.at >= CACHE_TTL_MS) {
        // Only listed underlyings reach the cache, so arbitrary query strings can't grow it.
        if (deps.store.listExpiries(underlying).length === 0) {
          return reply.status(404).send({ error: `unknown underlying ${underlying}` });
        }
        hit = { at: now, response: load(client, underlying, now) };
        cache.set(underlying, hit);
      }
      const body = await hit.response.catch(() => null);
      if (body == null) {
        cache.delete(underlying);
        return reply.status(404).send({ error: `no daily history for ${underlying}` });
      }
      return body;
    });
  };
}
