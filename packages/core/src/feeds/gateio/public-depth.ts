import { z } from 'zod';
import { GATEIO_REST_BASE_URL, GATEIO_OPTIONS_ORDER_BOOK } from '../shared/endpoints.js';
import {
  DepthNumberSchema,
  DepthSequenceSchema,
  type PublicDepthFetcher,
} from '../shared/public-depth.js';
const Levels = z.array(z.object({ p: DepthNumberSchema, s: DepthNumberSchema })).max(1000);
const Schema = z.object({
  bids: Levels,
  asks: Levels,
  current: z.number().finite().nonnegative(),
  update: z.number().finite().nonnegative().optional(),
  id: DepthSequenceSchema.optional(),
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${GATEIO_REST_BASE_URL}${GATEIO_OPTIONS_ORDER_BOOK}?${new URLSearchParams({ contract: symbol, limit: '20', with_id: 'true' })}`,
    ),
  );
  return {
    bids: data.bids.map((level) => [level.p, level.s]),
    asks: data.asks.map((level) => [level.p, level.s]),
    exchangeTs: Math.round(data.current * 1000),
    lastChangeAt: data.update == null ? null : Math.round(data.update * 1000),
    sequence: data.id ?? null,
    sourceMaxLevels: 20,
    exchangeTimestampBasis: 'generation',
  };
};
