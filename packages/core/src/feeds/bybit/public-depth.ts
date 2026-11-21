import { z } from 'zod';
import { BYBIT_REST_BASE_URL } from '../shared/endpoints.js';
import {
  DepthPairsSchema,
  DepthSequenceSchema,
  depthPairs,
  type PublicDepthFetcher,
} from '../shared/public-depth.js';
const Schema = z.object({
  retCode: z.literal(0),
  result: z.object({
    s: z.string(),
    b: DepthPairsSchema,
    a: DepthPairsSchema,
    ts: z.number().int().nonnegative(),
    cts: z.number().int().nonnegative().optional(),
    u: DepthSequenceSchema,
  }),
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${BYBIT_REST_BASE_URL}/v5/market/orderbook?${new URLSearchParams({ category: 'option', symbol, limit: '20' })}`,
    ),
  ).result;
  if (data.s !== symbol) throw new Error('Depth symbol mismatch');
  return {
    bids: depthPairs(data.b),
    asks: depthPairs(data.a),
    exchangeTs: data.ts,
    lastChangeAt: data.cts ?? null,
    sequence: data.u,
    sourceMaxLevels: 20,
    exchangeTimestampBasis: 'generation',
  };
};
