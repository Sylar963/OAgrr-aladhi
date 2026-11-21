import { z } from 'zod';
import { DERIBIT_REST_BASE_URL } from '../shared/endpoints.js';
import {
  DepthPairsSchema,
  DepthSequenceSchema,
  depthPairs,
  type PublicDepthFetcher,
} from '../shared/public-depth.js';
const Schema = z.object({
  result: z.object({
    instrument_name: z.string(),
    bids: DepthPairsSchema,
    asks: DepthPairsSchema,
    timestamp: z.number().int().nonnegative(),
    change_id: DepthSequenceSchema,
    index_price: z.number().finite().positive().optional(),
  }),
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${DERIBIT_REST_BASE_URL}/api/v2/public/get_order_book?${new URLSearchParams({ instrument_name: symbol, depth: '20' })}`,
    ),
  ).result;
  if (data.instrument_name !== symbol) throw new Error('Depth symbol mismatch');
  return {
    bids: depthPairs(data.bids),
    asks: depthPairs(data.asks),
    exchangeTs: data.timestamp,
    lastChangeAt: data.timestamp,
    sequence: data.change_id,
    sourceMaxLevels: 20,
    exchangeTimestampBasis: 'last-change',
    ...(data.index_price ? { referencePriceUsd: data.index_price } : {}),
  };
};
