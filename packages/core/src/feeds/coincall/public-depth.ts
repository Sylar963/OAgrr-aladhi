import { z } from 'zod';
import { COINCALL_REST_BASE_URL } from '../shared/endpoints.js';
import { DepthNumberSchema, type PublicDepthFetcher } from '../shared/public-depth.js';
const Levels = z.array(z.object({ price: DepthNumberSchema, size: DepthNumberSchema })).max(1000);
const Schema = z.object({
  code: z.literal(0),
  data: z.object({
    symbol: z.string().optional(),
    optionName: z.string().optional(),
    bids: Levels,
    asks: Levels,
  }),
});
export const fetchPublicDepth: PublicDepthFetcher = async (symbol, read) => {
  const data = Schema.parse(
    await read(
      `${COINCALL_REST_BASE_URL}/open/option/order/orderbook/v1/${encodeURIComponent(symbol)}`,
    ),
  ).data;
  if ((data.symbol ?? data.optionName) !== symbol) throw new Error('Depth symbol mismatch');
  return {
    bids: data.bids.map((level) => [level.price, level.size]),
    asks: data.asks.map((level) => [level.price, level.size]),
    exchangeTs: null,
    lastChangeAt: null,
    sequence: null,
    sourceMaxLevels: 100,
    priceCurrency: 'USD',
    exchangeTimestampBasis: 'not-provided',
  };
};
