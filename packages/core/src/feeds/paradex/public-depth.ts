import { z } from 'zod';
import { PARADEX_REST_BASE_URL } from '../shared/endpoints.js';
import {
  DepthPairsSchema,
  DepthSequenceSchema,
  depthPairs,
  type PublicDepthFetcher,
} from '../shared/public-depth.js';
const Schema = z.object({
  market: z.string(),
  bids: DepthPairsSchema,
  asks: DepthPairsSchema,
  last_updated_at: z.number().int().nonnegative(),
  seq_no: DepthSequenceSchema,
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read, access) => {
  const data = Schema.parse(
    await read(
      `${PARADEX_REST_BASE_URL}/orderbook/${encodeURIComponent(symbol)}${access === 'interactive' ? '/interactive' : ''}?depth=20`,
    ),
  );
  if (data.market !== symbol) throw new Error('Depth symbol mismatch');
  return {
    bids: depthPairs(data.bids),
    asks: depthPairs(data.asks),
    exchangeTs: data.last_updated_at,
    lastChangeAt: data.last_updated_at,
    sequence: data.seq_no,
    sourceMaxLevels: 20,
    priceCurrency: 'USD',
    exchangeTimestampBasis: 'last-change',
  };
};
