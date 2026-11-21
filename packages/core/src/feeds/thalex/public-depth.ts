import { z } from 'zod';
import { THALEX_REST_URL } from '../shared/endpoints.js';
import { DepthPairsSchema, depthPairs, type PublicDepthFetcher } from '../shared/public-depth.js';
const Schema = z.object({
  result: z.object({
    bids: DepthPairsSchema,
    asks: DepthPairsSchema,
    time: z.number().finite().nonnegative(),
  }),
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${THALEX_REST_URL}/public/book?${new URLSearchParams({ instrument_name: symbol })}`,
    ),
  ).result;
  return {
    bids: depthPairs(data.bids),
    asks: depthPairs(data.asks),
    exchangeTs: Math.round(data.time * 1000),
    lastChangeAt: Math.round(data.time * 1000),
    sequence: null,
    sourceMaxLevels: 5,
    priceCurrency: 'USD',
    exchangeTimestampBasis: 'last-change',
  };
};
