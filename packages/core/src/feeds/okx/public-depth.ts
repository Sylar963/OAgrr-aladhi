import { z } from 'zod';
import { OKX_REST_BASE_URL } from '../shared/endpoints.js';
import {
  DepthNumberSchema,
  DepthPairsSchema,
  DepthSequenceSchema,
  depthPairs,
  type PublicDepthFetcher,
} from '../shared/public-depth.js';
const Schema = z.object({
  code: z.literal('0'),
  data: z
    .array(
      z.object({
        bids: DepthPairsSchema,
        asks: DepthPairsSchema,
        ts: DepthNumberSchema,
        seqId: DepthSequenceSchema.optional(),
      }),
    )
    .length(1),
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${OKX_REST_BASE_URL}/api/v5/market/books?${new URLSearchParams({ instId: symbol, sz: '20' })}`,
    ),
  ).data[0]!;
  return {
    bids: depthPairs(data.bids),
    asks: depthPairs(data.asks),
    exchangeTs: data.ts,
    lastChangeAt: null,
    sequence: data.seqId ?? null,
    sourceMaxLevels: 20,
    exchangeTimestampBasis: 'generation',
  };
};
