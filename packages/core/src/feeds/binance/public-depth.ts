import { z } from 'zod';
import { BINANCE_REST_BASE_URL } from '../shared/endpoints.js';
import {
  DepthPairsSchema,
  DepthSequenceSchema,
  depthPairs,
  type PublicDepthFetcher,
} from '../shared/public-depth.js';
const Schema = z.object({
  bids: DepthPairsSchema,
  asks: DepthPairsSchema,
  T: z.number().int().nonnegative(),
  lastUpdateId: DepthSequenceSchema,
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${BINANCE_REST_BASE_URL}/eapi/v1/depth?${new URLSearchParams({ symbol, limit: '20' })}`,
    ),
  );
  return {
    bids: depthPairs(data.bids),
    asks: depthPairs(data.asks),
    exchangeTs: data.T,
    lastChangeAt: data.T,
    sequence: data.lastUpdateId,
    sourceMaxLevels: 20,
    exchangeTimestampBasis: 'last-change',
  };
};
